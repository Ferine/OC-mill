import OpenAI from 'openai';
import { Story } from '../story/types';
import { Brand } from '../brand/types';
import { OpenRouterConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { StorySchema, STORY_JSON_SCHEMA } from './schemas';

export interface StoryServiceOptions {
  targetDurationSeconds: number;
  maxRetries?: number;
}

export interface GenerateStoryOptions {
  brand: Brand;
  archetypeId?: string;
  seed?: string;
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

  public async generateStory(opts: GenerateStoryOptions): Promise<Story> {
    const { brand } = opts;
    const archetype =
      pickArchetype(brand, opts.archetypeId) ?? brand.archetypes[0];

    logger.info('Generating story', {
      brandId: brand.id,
      archetypeId: archetype.id,
      model: this.model,
      hasSeed: !!opts.seed,
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.generateOnce(brand, archetype.id, opts.seed);
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

  private async generateOnce(
    brand: Brand,
    archetypeId: string,
    seed: string | undefined
  ): Promise<Story> {
    const systemPrompt = buildSystemPrompt(brand);
    const userPrompt = this.buildUserPrompt(brand, archetypeId, seed);

    logger.debug('Story prompt assembled', {
      brandId: brand.id,
      archetypeId,
      systemPromptHead: systemPrompt.slice(0, 160),
      userPromptHead: userPrompt.slice(0, 240),
    });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
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

    const raw = JSON.parse(content) as Record<string, unknown>;
    // Server-side fields: brandId is fixed by the run; archetypeId is
    // validated against the brand and falls back to a known one if the
    // LLM hallucinates a slug.
    const validIds = new Set(brand.archetypes.map((a) => a.id));
    let archetypeOut = String(raw.archetypeId ?? archetypeId);
    if (!validIds.has(archetypeOut)) {
      logger.warn('LLM returned unknown archetypeId — falling back', {
        returned: archetypeOut,
        fallback: archetypeId,
      });
      archetypeOut = archetypeId;
    }
    const parsed = StorySchema.parse({
      ...raw,
      brandId: brand.id,
      archetypeId: archetypeOut,
    });

    const story = this.normalizeDurations(parsed);

    logger.info('Story generated', {
      brandId: story.brandId,
      archetypeId: story.archetypeId,
      title: story.title,
      sceneCount: story.scenes.length,
      totalDuration: story.totalDurationSeconds,
    });

    return story;
  }

  private buildUserPrompt(
    brand: Brand,
    archetypeId: string,
    seed: string | undefined
  ): string {
    const archetype = brand.archetypes.find((a) => a.id === archetypeId)!;
    const allowedIds = brand.archetypes.map((a) => `"${a.id}"`).join(', ');
    const archetypeNames = brand.archetypes
      .map((a) => `- "${a.id}" — ${a.label}${a.guidance ? `: ${a.guidance}` : ''}`)
      .join('\n');

    const seedBlock = seed?.trim()
      ? `\n\nADDITIONAL CREATIVE SEED FROM USER (work this in):\n${seed.trim()}\n`
      : '';

    const musicHint = brand.musicStyleHint?.trim()
      ? `\n\nMUSIC STYLE HINT: ${brand.musicStyleHint.trim()}`
      : '';

    return `Generate a UNIQUE, CREATIVE ${this.targetDuration}-second TikTok story for the brand "${brand.displayName}".

ARCHETYPE: "${archetype.id}" (${archetype.label})
${archetype.guidance ?? ''}

Set the response field "archetypeId" to exactly one of: ${allowedIds}. Pick the one that best matches the story you generate — typically the one requested above.

Available archetypes:
${archetypeNames}
${seedBlock}${musicHint}

Scene durations must sum to approximately ${this.targetDuration} seconds (within ±10s tolerance).
6-10 scenes, each 5-8 seconds.
Make it viral-worthy and visually distinct scene to scene.

Return JSON only.`;
  }

  /**
   * Ask the LLM for a single-sentence creative seed that the user can drop
   * into the "creative seed" field on the new-run form. Cheap, low-tokens,
   * one shot — no retry. Returns a trimmed sentence.
   */
  public async suggestSeed(opts: {
    brand: Brand;
    archetypeId?: string;
  }): Promise<string> {
    const { brand } = opts;
    const archetype = opts.archetypeId
      ? brand.archetypes.find((a) => a.id === opts.archetypeId)
      : undefined;
    const characterHint = brand.prompts.storyCharacter.slice(0, 280);
    const archHint = archetype
      ? `Archetype: ${archetype.label}${archetype.guidance ? ` — ${archetype.guidance}` : ''}`
      : `Any archetype from: ${brand.archetypes.map((a) => a.label).join(', ')}`;

    const system = `You generate single-sentence creative seeds for short-form vertical TikTok video stories.
Output exactly ONE sentence, 8 to 40 words. No quotes, no preamble, no hashtags, no emoji.
The seed should add a specific, vivid premise, location, prop, or twist that a writer could build a 6-9 scene story around.
Keep it punchy and weird.`;

    const user = `Brand: ${brand.displayName}.
Character: ${characterHint}
${archHint}

Write one seed sentence.`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 1.1,
    });
    const message = response.choices[0]?.message;
    const text = message?.content ?? '';
    const cleaned = text
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    if (!cleaned) {
      logger.warn('Seed suggestion empty', {
        brandId: brand.id,
        rawHead: JSON.stringify(message).slice(0, 400),
        finish: response.choices[0]?.finish_reason,
      });
      throw new Error('LLM returned empty seed');
    }
    logger.info('Seed suggested', {
      brandId: brand.id,
      archetypeId: opts.archetypeId,
      chars: cleaned.length,
    });
    return cleaned;
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

function pickArchetype(brand: Brand, preferredId?: string) {
  if (preferredId) {
    const match = brand.archetypes.find((a) => a.id === preferredId);
    if (match) return match;
    logger.warn('Requested archetype not in brand — picking randomly', {
      requested: preferredId,
      brandId: brand.id,
    });
  }
  return brand.archetypes[
    Math.floor(Math.random() * brand.archetypes.length)
  ];
}

function buildSystemPrompt(brand: Brand): string {
  const flavor = brand.prompts.storySystemFlavor?.trim() || brand.displayName;
  return `You are a creative storyteller specializing in viral TikTok-style video stories about ${flavor}.

CRITICAL REQUIREMENTS
- Stories MUST be designed for VERTICAL 9:16 TikTok format.
- Target duration: 50-60 seconds total.
- 6-10 SHORT scenes, each 5-8 seconds. Each scene's durationSeconds must sum to roughly the requested target (within ±10s).
- Each scene must be visually distinct (different setting, pose, or angle) and easily visualizable.
- Each scene's subtitleText is the meme-style caption that will be burned onto the video.

${brand.prompts.storyCharacter}

STORY STRUCTURE
1. HOOK - emotional/funny visual that grabs attention.
2-3. ESTABLISH PROBLEM.
4-5. ESCALATION.
6-7. TURNING POINT - rescue, opportunity, glow-up.
8-9. PAYOFF - new life, success, love, or ironic twist.
10 (optional). CLOSE - close-up of the character looking into camera with strong emotion.

VISUAL REQUIREMENTS PER SCENE
- Specific lighting (e.g. "soft cinematic", "neon", "golden afternoon", "dramatic spotlight").
- Specific environment with sensory details.
- Specific character action and pose.
- Camera motion (slow zoom, close-up, wide, tracking, dolly).

SUBTITLE TEXT RULES
- Short, punchy, meme-friendly. 1-2 sentences max.
- Emotionally resonant. Ellipses encouraged. Sparing emoji ok.

MUSIC STYLE
- Generic royalty-free-style description only. NEVER name songs or artists.

TRADEMARK & COPYRIGHT — STRICT
- Do NOT name any real-world trademarked product, company, mascot, character, song, or media.
- Examples to AVOID: Beanie Babies, Ty, Disney, Pixar, Nike, Apple, Sbarro, Auntie Anne's, Spencer's, Mario, Pokémon, Coca-Cola, McDonald's, Marvel, etc.
- Use generic substitutes: "plush toy", "soft pretzel kiosk", "pop-culture gift shop", "burger chain", "a dancing-mushroom video-game character".
- This rule applies to every field: descriptions, environments, subtitle text, and music style. Downstream image/video models REJECT trademarked references.

Make it viral-worthy: think about what makes people stop scrolling.

Return your answer as a single JSON object that conforms exactly to the provided schema.`;
}
