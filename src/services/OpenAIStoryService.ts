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
    return `You are a creative storyteller specializing in heartwarming, funny, and dramatic short-form video stories about a fat orange cat.

Your stories are designed for TikTok-style vertical videos (9:16 aspect ratio) that are 50-60 seconds long.

Key characteristics of the orange cat:
- Extremely chubby with a prominent belly
- Bright orange and white striped fur
- Large, expressive eyes
- Endearing personality ranging from grumpy to sweet
- Food-motivated
- Memorable waddle when walking

Your stories should:
- Have a clear narrative arc with emotional impact
- Be broken into 6-10 distinct scenes
- Include meme-style subtitle text for each scene
- Specify detailed visual descriptions (environment, cat action, camera motion)
- Build emotional engagement (sad to happy, funny buildup, dramatic reveals)
- Feel authentic and relatable to cat lovers
- Work well as short-form viral content

Output must be valid JSON matching this exact structure:
{
  "archetype": "archetypeName",
  "title": "Story Title",
  "narrative": "One sentence story summary",
  "totalDurationSeconds": 55,
  "overallMood": "heartwarming|funny|dramatic|sad|hopeful|epic",
  "musicStyle": "description of background music style",
  "scenes": [
    {
      "description": "What happens in this scene",
      "durationSeconds": 7,
      "subtitleText": "Short meme-style text",
      "mood": "sad|hopeful|funny|dramatic|heartwarming|epic",
      "environment": "Setting and visual details",
      "catAction": "What the cat is doing",
      "cameraMotion": "Camera movement/angle"
    }
  ]
}`;
  }

  /**
   * Build the user prompt requesting a specific story
   */
  private buildUserPrompt(archetypeName: ArchetypeName, duration: number): string {
    const archetypeDescriptions: Record<ArchetypeName, string> = {
      RagsToRiches: 'A transformation story where the cat goes from struggling to thriving',
      FromShelterToHome: 'A heartwarming adoption story from shelter to forever home',
      StreamerCatGlowUp: 'A funny story about a cat becoming internet famous through gaming/streaming',
      VillainArcButSoft: 'A comedic story where the cat acts like a villain but is actually just soft/silly',
      ChonkToBestFriend: 'A friendship story where the grumpy cat reluctantly bonds with someone',
      OfficeHeroJourney: 'A heroic workplace story where the office cat saves the day',
    };

    return `Generate a unique, creative story about a fat orange cat following the "${archetypeName}" archetype: ${archetypeDescriptions[archetypeName]}.

Requirements:
- Total duration: approximately ${duration} seconds
- 6-10 scenes with varying lengths (4-10 seconds each)
- Scene durations should sum to approximately ${duration} seconds
- Make it emotionally engaging and TikTok-worthy
- Include specific visual details for video generation
- Subtitle text should be punchy and meme-friendly
- Create a satisfying narrative arc

Make this story UNIQUE and CREATIVE - don't just copy generic cat content. Give it personality, specific details, and memorable moments.

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
