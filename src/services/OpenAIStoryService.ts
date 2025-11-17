import OpenAI from 'openai';
import { Story, Scene, ArchetypeName, Mood } from '../story/types';
import { logger } from '../utils/logger';
import { ARCHETYPES, getRandomArchetype } from '../story/archetypes';

/**
 * OpenAIStoryService generates dynamic cat stories using OpenAI's GPT models
 */
export class OpenAIStoryService {
  private client: OpenAI;
  private model: string;
  private targetDuration: number;

  constructor(apiKey: string, model: string = 'gpt-4o', targetDuration: number = 55) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.targetDuration = targetDuration;

    logger.info('OpenAIStoryService initialized', {
      model: this.model,
      targetDuration: this.targetDuration,
    });
  }

  /**
   * Generate a complete story using OpenAI
   * Can optionally specify an archetype for inspiration
   */
  public async generateStory(archetypeName?: ArchetypeName): Promise<Story> {
    logger.info('Generating story with OpenAI', {
      archetype: archetypeName || 'random',
      model: this.model,
    });

    const archetype = archetypeName
      ? ARCHETYPES.find((a) => a.name === archetypeName) || getRandomArchetype()
      : getRandomArchetype();

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(archetype.name, this.targetDuration);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.9, // High creativity
        max_tokens: 4000,
      });

      const content = response.choices[0].message.content;
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      const generatedStory = JSON.parse(content);
      const story = this.parseAndValidateStory(generatedStory, archetype.name);

      logger.info('Story generated successfully with OpenAI', {
        archetype: story.archetype,
        title: story.title,
        sceneCount: story.scenes.length,
        totalDuration: story.totalDurationSeconds,
      });

      return story;
    } catch (error) {
      logger.error('Failed to generate story with OpenAI', {
        error: error instanceof Error ? error.message : String(error),
        archetype: archetype.name,
      });
      throw new Error(`OpenAI story generation failed: ${error}`);
    }
  }

  /**
   * Build the system prompt that defines the AI's role
   */
  private buildSystemPrompt(): string {
    return `You are a creative storyteller specializing in viral TikTok-style video stories about a fat orange cat.

CRITICAL REQUIREMENTS:
- Stories MUST be designed for VERTICAL 9:16 TikTok format
- Target duration: 50-60 seconds total (approximately 1 minute)
- 6-10 SHORT SCENES (each ~5-8 seconds of screen time)
- Each scene must be visually distinct and easily visualizable
- Include clear subtitle text that will be overlaid ON the video itself

THE ORANGE CAT CHARACTER:
- Extremely chubby orange tabby with a prominent belly
- Big shiny, expressive eyes (often teary or sparkling for emotion)
- Bright orange and white striped fur
- Endearing personality - can be grumpy, sweet, dramatic, or mischievous
- Very food-motivated
- Adorable waddle when walking

STORY STRUCTURE (6-10 scenes, ~5-8 seconds each):
Scene 1: HOOK - Strong emotional or funny visual that grabs attention
Scene 2-3: ESTABLISH PROBLEM - Show the pain or conflict
Scene 4-5: ESCALATION - Things get worse or more dramatic
Scene 6-7: TURNING POINT - Rescue, opportunity, glow-up moment
Scene 8-9: PAYOFF - New life, success, love, or ironic twist
Scene 10 (optional): CLOSING - Close-up of cat looking into camera with strong emotion

Each scene MUST be visually distinct (different setting or pose) and clearly describable.

VISUAL REQUIREMENTS FOR EACH SCENE:
- Specific lighting (soft cinematic, neon, golden afternoon, dramatic)
- Clear environment details (alley, apartment, street, shelter, etc.)
- Specific cat action and pose
- Camera motion (slow zoom, close-up, wide shot, tracking)
- Anime-style or cinematic visual style when appropriate
- Clear subtitle placement (bottom of screen, meme-style)

MUSIC STYLE (describe generically):
- "emotional piano with soft synth pads"
- "upbeat electronic with playful beats"
- "melancholic acoustic guitar"
- "dramatic orchestral build"
- "sad violin with gentle crescendo"
DO NOT specify specific songs or artists, only royalty-free-style descriptions.

SUBTITLE TEXT RULES:
- Short, punchy, meme-friendly
- 1-2 sentences max per scene
- Emotionally resonant (e.g., "No one loved me…", "Then someone chose me…", "Now I am safe")
- Use ellipses for dramatic effect
- Can use emojis sparingly if it fits the mood

Output must be valid JSON matching this exact structure:
{
  "archetype": "archetypeName",
  "title": "Story Title",
  "narrative": "One sentence story summary",
  "totalDurationSeconds": 55,
  "overallMood": "heartwarming|funny|dramatic|sad|hopeful|epic",
  "musicStyle": "Generic description of royalty-free style music",
  "scenes": [
    {
      "description": "Detailed visual description of the scene",
      "durationSeconds": 10,
      "subtitleText": "Short meme-style text to overlay",
      "mood": "sad|hopeful|funny|dramatic|heartwarming|epic",
      "environment": "Specific setting with lighting and atmosphere details",
      "catAction": "Exact action and pose of the cat",
      "cameraMotion": "Specific camera movement (slow zoom, close-up, etc.)"
    }
  ]
}

MAKE IT VIRAL-WORTHY: Think about what makes people stop scrolling and watch!`;
  }

  /**
   * Build the user prompt requesting a specific story
   */
  private buildUserPrompt(archetypeName: ArchetypeName, duration: number): string {
    const archetypeDescriptions: Record<ArchetypeName, string> = {
      RagsToRiches: 'Stray alley cat → adopted → spoiled indoor chonk (classic transformation)',
      FromShelterToHome: 'Alone at the shelter for months → finally adopted → loved (heartwarming)',
      StreamerCatGlowUp: 'Ignored background cat → starts streaming → becomes rich and famous (comedy)',
      VillainArcButSoft: 'Bullied by other cats → becomes powerful and stylish "villain" → actually just wants snacks (comedy)',
      ChonkToBestFriend: 'Lonely, grumpy cat → reluctantly meets new friend → becomes inseparable (friendship)',
      OfficeHeroJourney: 'Regular office cat → accidentally saves the day → becomes workplace legend (heroic)',
    };

    const sceneExamples = {
      RagsToRiches: `
Example structure:
Scene 1 (sad): Skinny orange kitten shivering in rainy alley at night, trash bags, neon lights. Subtitle: "No one wanted me..."
Scene 2 (conflict): Thin cat ignored on busy street, slow zoom on sad face. Subtitle: "I almost gave up..."
Scene 3 (turning point): Same cat being gently picked up by kind human, wrapped in blanket. Subtitle: "Then someone chose me..."
Scene 4 (resolution): Now very fat cat in cozy apartment, huge food bowl, toys, golden sunlight. Subtitle: "Now I am safe."
Scene 5 (emotional): Close-up of fat cat staring into camera with teary sparkling eyes, tiny proud smile.`,

      FromShelterToHome: `
Example structure:
Scene 1: Orange cat in shelter cage, day 156, watching other cats get adopted. Subtitle: "Day 156... still waiting"
Scene 2: Cat alone at night in empty shelter, curled up. Subtitle: "Maybe no one will choose me..."
Scene 3: Person stops at cage, makes eye contact, cat's ears perk up. Subtitle: "Wait... they see me?"
Scene 4: Signing adoption papers, cat in carrier watching. Subtitle: "Is this really happening?"
Scene 5: Cat in new home, cuddled with owner on couch. Subtitle: "Finally found my person."`,

      StreamerCatGlowUp: `
Example structure:
Scene 1: Cat walks across keyboard during Zoom, everyone laughing. Subtitle: "Just a regular workday..."
Scene 2: Owner sets up tiny gaming chair for cat. Subtitle: "Maybe this could work?"
Scene 3: Cat on stream, chat going wild, viewer count climbing. Subtitle: "THE CHONK IS LIVE"
Scene 4: 100K subscribers celebration, cat with tiny headset. Subtitle: "I'm... famous?"`,
    };

    const exampleForArchetype = sceneExamples[archetypeName as keyof typeof sceneExamples] || '';

    return `Generate a UNIQUE and CREATIVE ${duration}-second TikTok story about a fat orange cat.

ARCHETYPE: "${archetypeName}"
Description: ${archetypeDescriptions[archetypeName]}
${exampleForArchetype}

CRITICAL REQUIREMENTS:
- 6-10 SHORT SCENES (each ~5-8 seconds of screen time)
- Scene durations MUST sum to approximately ${duration} seconds
- Follow emotional arc: Hook → Establish Problem → Escalation → Turning Point → Payoff → (Optional) Close
- Each scene must be visually DISTINCT (different setting, pose, or angle)
- SPECIFIC visual details (lighting, environment, cat pose, camera motion)
- Meme-style subtitle text (short, punchy, emotional)
- Anime-style or cinematic visual descriptions where appropriate

VISUAL DETAILS TO INCLUDE:
- Lighting: "soft cinematic", "neon lights", "golden afternoon sunlight", "dramatic spotlight"
- Environment: Be specific! "rainy alley with trash bags", "modern apartment with cat toys", "busy city street"
- Cat action: Exact pose and emotion - "shivering and curled up", "staring with teary eyes", "waddling proudly"
- Camera: "slow zoom on face", "close-up of eyes", "wide shot revealing surroundings", "tracking the chonk"

SUBTITLE TEXT GUIDELINES:
- Use ellipses for drama: "No one wanted me...", "Then someone chose me..."
- Keep it short: 1-2 sentences max
- Make it emotional and relatable
- Think viral TikTok captions

MUSIC STYLE (generic descriptions only):
- "Emotional piano with soft synth pads, royalty-free style"
- "Upbeat electronic beats with playful energy"
- "Melancholic acoustic guitar building to hopeful"
- "Dramatic orchestral with crescendo"

Make this story UNIQUE - add specific details, personality quirks, memorable visual moments that will make people STOP SCROLLING.

Return ONLY valid JSON, no other text.`;
  }

  /**
   * Parse and validate the OpenAI response into a Story object
   */
  private parseAndValidateStory(generated: any, archetypeName: ArchetypeName): Story {
    // Validate required fields
    if (!generated.title || !generated.narrative || !generated.scenes) {
      throw new Error('Invalid story structure from OpenAI');
    }

    if (!Array.isArray(generated.scenes) || generated.scenes.length === 0) {
      throw new Error('No scenes in generated story');
    }

    // Parse scenes
    const scenes: Scene[] = generated.scenes.map((scene: any, index: number) => {
      if (!scene.description || !scene.subtitleText || !scene.environment || !scene.catAction) {
        throw new Error(`Invalid scene structure at index ${index}`);
      }

      return {
        description: String(scene.description),
        durationSeconds: Number(scene.durationSeconds) || 6,
        subtitleText: String(scene.subtitleText),
        mood: (scene.mood as Mood) || 'heartwarming',
        environment: String(scene.environment),
        catAction: String(scene.catAction),
        cameraMotion: String(scene.cameraMotion) || 'steady shot',
      };
    });

    // Calculate total duration
    const totalDuration = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);

    // Adjust scene durations if total is way off target
    if (Math.abs(totalDuration - this.targetDuration) > 10) {
      logger.warn('Adjusting scene durations to match target', {
        original: totalDuration,
        target: this.targetDuration,
      });
      this.adjustSceneDurations(scenes, this.targetDuration);
    }

    const story: Story = {
      archetype: archetypeName,
      title: String(generated.title),
      narrative: String(generated.narrative),
      totalDurationSeconds: scenes.reduce((sum, s) => sum + s.durationSeconds, 0),
      scenes,
      overallMood: (generated.overallMood as Mood) || 'heartwarming',
      musicStyle: String(generated.musicStyle) || 'emotional piano, royalty-free style',
    };

    return story;
  }

  /**
   * Adjust scene durations to match target total
   */
  private adjustSceneDurations(scenes: Scene[], targetDuration: number): void {
    const currentTotal = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
    const ratio = targetDuration / currentTotal;

    let adjustedTotal = 0;

    for (let i = 0; i < scenes.length - 1; i++) {
      const newDuration = Math.max(4, Math.round(scenes[i].durationSeconds * ratio));
      scenes[i].durationSeconds = newDuration;
      adjustedTotal += newDuration;
    }

    // Last scene gets whatever is left
    scenes[scenes.length - 1].durationSeconds = Math.max(4, targetDuration - adjustedTotal);
  }

  /**
   * Generate multiple story variations in parallel
   */
  public async generateMultipleStories(
    count: number,
    archetypeName?: ArchetypeName
  ): Promise<Story[]> {
    logger.info(`Generating ${count} stories with OpenAI`);

    const promises = Array.from({ length: count }, () => this.generateStory(archetypeName));

    try {
      const stories = await Promise.all(promises);
      logger.info(`Successfully generated ${stories.length} stories`);
      return stories;
    } catch (error) {
      logger.error('Failed to generate multiple stories', { error });
      throw error;
    }
  }

  /**
   * Generate story with retry logic
   */
  public async generateStoryWithRetry(
    archetypeName?: ArchetypeName,
    maxRetries: number = 3
  ): Promise<Story> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Attempting story generation (attempt ${attempt}/${maxRetries})`);
        return await this.generateStory(archetypeName);
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Story generation attempt ${attempt} failed`, {
          error: lastError.message,
          willRetry: attempt < maxRetries,
        });

        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError || new Error('Story generation failed after retries');
  }

  /**
   * Test the OpenAI connection
   */
  public async testConnection(): Promise<boolean> {
    try {
      logger.info('Testing OpenAI connection');

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: 'Say "test successful" in JSON format.' }],
        max_tokens: 50,
      });

      const success = !!response.choices[0]?.message?.content;
      logger.info('OpenAI connection test result', { success });

      return success;
    } catch (error) {
      logger.error('OpenAI connection test failed', { error });
      return false;
    }
  }
}
