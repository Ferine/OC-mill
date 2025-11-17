import { Story, Scene } from './types';
import { getRandomArchetype, ArchetypeTemplate } from './archetypes';
import { logger } from '../utils/logger';

/**
 * StoryGenerator creates complete fat orange cat stories
 * Uses predefined archetypes and adds duration timing
 */
export class StoryGenerator {
  private targetDuration: number;

  constructor(targetDurationSeconds: number = 55) {
    this.targetDuration = targetDurationSeconds;
  }

  /**
   * Generate a complete story with proper scene timing
   */
  public generateStory(): Story {
    const archetype = getRandomArchetype();
    logger.info('Generating story', {
      archetype: archetype.name,
      title: archetype.title,
    });

    const scenes = this.createScenesWithTiming(archetype);
    const totalDuration = scenes.reduce(
      (sum, scene) => sum + scene.durationSeconds,
      0
    );

    const story: Story = {
      archetype: archetype.name,
      title: archetype.title,
      narrative: archetype.narrative,
      totalDurationSeconds: totalDuration,
      scenes,
      overallMood: archetype.overallMood,
      musicStyle: archetype.musicStyle,
    };

    logger.info('Story generated successfully', {
      archetype: story.archetype,
      sceneCount: story.scenes.length,
      totalDuration: story.totalDurationSeconds,
    });

    return story;
  }

  /**
   * Create scenes with calculated durations that sum to target
   */
  private createScenesWithTiming(archetype: ArchetypeTemplate): Scene[] {
    const sceneCount = archetype.sceneTemplates.length;

    // Distribute duration across scenes with variation
    const durations = this.distributeDuration(sceneCount, this.targetDuration);

    return archetype.sceneTemplates.map((template, index) => ({
      ...template,
      durationSeconds: durations[index],
    }));
  }

  /**
   * Distribute total duration across scenes with natural variation
   * First and last scenes get slightly more time for dramatic effect
   */
  private distributeDuration(
    sceneCount: number,
    totalDuration: number
  ): number[] {
    const durations: number[] = [];
    const baseDuration = Math.floor(totalDuration / sceneCount);

    let remaining = totalDuration;

    for (let i = 0; i < sceneCount; i++) {
      let duration: number;

      if (i === sceneCount - 1) {
        // Last scene gets whatever is left
        duration = remaining;
      } else if (i === 0 || i === sceneCount - 1) {
        // First and last scenes get a bit more time (climactic moments)
        duration = Math.min(baseDuration + 2, remaining - (sceneCount - i - 1));
      } else {
        // Middle scenes vary slightly
        const variation = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
        duration = Math.max(
          4,
          Math.min(baseDuration + variation, remaining - (sceneCount - i - 1))
        );
      }

      durations.push(duration);
      remaining -= duration;
    }

    return durations;
  }

  /**
   * Generate multiple story options and return them all
   * Useful for batch generation or selection
   */
  public generateMultipleStories(count: number): Story[] {
    logger.info(`Generating ${count} story options`);
    const stories: Story[] = [];

    for (let i = 0; i < count; i++) {
      stories.push(this.generateStory());
    }

    return stories;
  }

  /**
   * Get story summary for logging/debugging
   */
  public getStorySummary(story: Story): string {
    return `${story.title} (${story.archetype}) - ${story.scenes.length} scenes, ${story.totalDurationSeconds}s total`;
  }
}
