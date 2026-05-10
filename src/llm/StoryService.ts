import OpenAI from 'openai';
import { Story } from '../story/types';
import { OpenRouterConfig } from '../utils/config';
import { logger } from '../utils/logger';
import {
  StorySchema,
  STORY_JSON_SCHEMA,
  archetypeNames,
  ArchetypeNameZ,
} from './schemas';

const SYSTEM_PROMPT = `You are a creative storyteller specializing in viral TikTok-style video stories about a fat orange cat.

CRITICAL REQUIREMENTS
- Stories MUST be designed for VERTICAL 9:16 TikTok format.
- Target duration: 50-60 seconds total.
- 6-10 SHORT scenes, each 5-8 seconds. Each scene's durationSeconds must sum to roughly the requested target (within ±10s).
- Each scene must be visually distinct (different setting, pose, or angle) and easily visualizable.
- Each scene's subtitleText is the meme-style caption that will be burned onto the video.

THE ORANGE CAT CHARACTER
- Extremely chubby orange tabby with a prominent belly.
- Big shiny, expressive eyes (often teary or sparkling for emotion).
- Bright orange and white striped fur.
- Personality: can be grumpy, sweet, dramatic, or mischievous. Very food-motivated. Adorable waddle.
- The same physical character should appear consistently in every scene.

STORY STRUCTURE
1. HOOK - emotional/funny visual that grabs attention.
2-3. ESTABLISH PROBLEM.
4-5. ESCALATION.
6-7. TURNING POINT - rescue, opportunity, glow-up.
8-9. PAYOFF - new life, success, love, or ironic twist.
10 (optional). CLOSE - close-up of the cat looking into camera with strong emotion.

VISUAL REQUIREMENTS PER SCENE
- Specific lighting (e.g. "soft cinematic", "neon", "golden afternoon", "dramatic spotlight").
- Specific environment with sensory details.
- Specific cat action and pose.
- Camera motion (slow zoom, close-up, wide, tracking, dolly).

SUBTITLE TEXT RULES
- Short, punchy, meme-friendly. 1-2 sentences max.
- Emotionally resonant. Ellipses encouraged. Sparing emoji ok.

MUSIC STYLE
- Generic royalty-free-style description only. NEVER name songs or artists.

Make it viral-worthy: think about what makes people stop scrolling.

Return your answer as a single JSON object that conforms exactly to the provided schema.`;

const ARCHETYPE_DESCRIPTIONS: Record<ArchetypeNameZ, string> = {
  RagsToRiches:
    'Stray alley cat → adopted → spoiled indoor chonk (classic transformation).',
  FromShelterToHome:
    'Alone at the shelter for months → finally adopted → loved (heartwarming).',
  StreamerCatGlowUp:
    'Ignored background cat → starts streaming → becomes rich and famous (comedy).',
  VillainArcButSoft:
    'Bullied by other cats → becomes powerful and stylish "villain" → actually just wants snacks (comedy).',
  ChonkToBestFriend:
    'Lonely, grumpy cat → reluctantly meets new friend → becomes inseparable (friendship).',
  OfficeHeroJourney:
    'Regular office cat → accidentally saves the day → becomes workplace legend (heroic).',
};

export interface StoryServiceOptions {
  targetDurationSeconds: number;
  maxRetries?: number;
}

export class StoryService {
  private client: OpenAI;
  private model: string;
  private targetDuration: number;
  private maxRetries: number;

  constructor(cfg: OpenRouterConfig, opts: StoryServiceOptions) {
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': cfg.appUrl,
        'X-Title': cfg.appName,
      },
    });
    this.model = cfg.llmModel;
    this.targetDuration = opts.targetDurationSeconds;
    this.maxRetries = opts.maxRetries ?? 3;

    logger.info('StoryService initialized', {
      model: this.model,
      targetDuration: this.targetDuration,
    });
  }

  public async generateStory(archetype?: ArchetypeNameZ): Promise<Story> {
    const chosen =
      archetype ??
      archetypeNames[Math.floor(Math.random() * archetypeNames.length)];

    logger.info('Generating story', { archetype: chosen, model: this.model });

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.generateOnce(chosen);
      } catch (err) {
        lastError = err;
        logger.warn('Story generation attempt failed', {
          attempt,
          willRetry: attempt < this.maxRetries,
          error: err instanceof Error ? err.message : String(err),
        });
        if (attempt < this.maxRetries) {
          await new Promise((r) =>
            setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 5000))
          );
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Story generation failed');
  }

  private async generateOnce(archetype: ArchetypeNameZ): Promise<Story> {
    const userPrompt = this.buildUserPrompt(archetype);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'Story',
          strict: true,
          schema: STORY_JSON_SCHEMA,
        },
      },
      temperature: 0.9,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    const raw = JSON.parse(content);
    const parsed = StorySchema.parse(raw);

    const story = this.normalizeDurations(parsed);

    logger.info('Story generated', {
      archetype: story.archetype,
      title: story.title,
      sceneCount: story.scenes.length,
      totalDuration: story.totalDurationSeconds,
    });

    return story;
  }

  private buildUserPrompt(archetype: ArchetypeNameZ): string {
    return `Generate a UNIQUE, CREATIVE ${this.targetDuration}-second TikTok story about a fat orange cat.

ARCHETYPE: "${archetype}"
${ARCHETYPE_DESCRIPTIONS[archetype]}

Scene durations must sum to approximately ${this.targetDuration} seconds (within ±10s tolerance).
6-10 scenes, each 5-8 seconds.
Make it viral-worthy and visually distinct scene to scene.

Return JSON only.`;
  }

  private normalizeDurations(s: Story): Story {
    const sum = s.scenes.reduce((a, b) => a + b.durationSeconds, 0);
    if (Math.abs(sum - this.targetDuration) <= 10) {
      return { ...s, totalDurationSeconds: sum };
    }

    logger.warn('Adjusting scene durations to match target', {
      original: sum,
      target: this.targetDuration,
    });
    const ratio = this.targetDuration / sum;
    const adjusted = s.scenes.map((scene) => ({
      ...scene,
      durationSeconds: Math.max(4, Math.round(scene.durationSeconds * ratio)),
    }));
    const adjustedSum = adjusted.reduce((a, b) => a + b.durationSeconds, 0);
    return {
      ...s,
      scenes: adjusted,
      totalDurationSeconds: adjustedSum,
    };
  }
}
