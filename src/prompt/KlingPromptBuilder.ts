import { Story } from '../story/types';
import { logger } from '../utils/logger';

/**
 * KlingPromptBuilder converts Story objects into detailed text prompts
 * optimized for Kling AI's text-to-video generation
 */
export class KlingPromptBuilder {
  /**
   * Build a complete Kling-compatible prompt from a story
   * Format optimized for TikTok-style vertical videos with clear scene structure
   */
  public buildPrompt(story: Story): string {
    logger.info('Building Kling prompt', {
      archetype: story.archetype,
      sceneCount: story.scenes.length,
    });

    // Build a compact, example-style prompt similar to successful TikTok video prompts
    const prompt = this.buildCompactPrompt(story);

    logger.debug('Prompt built successfully', {
      promptLength: prompt.length,
      archetype: story.archetype,
    });

    return prompt;
  }

  /**
   * Build a compact, TikTok-optimized prompt
   */
  private buildCompactPrompt(story: Story): string {
    const sceneDescriptions = story.scenes
      .map((scene, index) => {
        return `– Scene ${index + 1} (${scene.durationSeconds}s): ${scene.environment}. ${scene.catAction}. ${scene.cameraMotion}. Subtitle: "${scene.subtitleText}"`;
      })
      .join('\n');

    return `Vertical 9:16 TikTok-style video, ${story.totalDurationSeconds} seconds.

MAIN CHARACTER: Extremely chubby orange tabby cat with big shiny expressive eyes (often teary or sparkling), bright orange and white striped fur, prominent belly, adorable waddle.

STORY: ${story.narrative} (${story.archetype} archetype)

SCENES (${story.scenes.length} total):
${sceneDescriptions}

VISUAL STYLE: Cinematic quality with anime-style or realistic rendering. Soft, warm lighting with dramatic emphasis. Vibrant but natural colors. Smooth transitions between scenes (fades, dissolves, match cuts). Focus on cat's expressive face and body language. Shallow depth of field for emotional scenes.

SUBTITLES: Meme-style text overlays (white text, black outline) positioned at bottom of screen. Short, punchy, emotionally resonant.

AUDIO: ${story.musicStyle}. Audio mixed to support emotional arc with volume changes matching scene transitions.

TECHNICAL: 9:16 vertical aspect ratio, ${story.totalDurationSeconds} seconds duration, 24-30fps, 1080x1920 minimum resolution, MP4 format (H.264), optimized for TikTok. Text overlays burned into video. Consistent cat appearance throughout.`;
  }

  /**
   * Build a shortened prompt (if API has character limits)
   */
  public buildShortPrompt(story: Story): string {
    logger.info('Building short Kling prompt', {
      archetype: story.archetype,
    });

    const sceneList = story.scenes
      .map(
        (scene, i) =>
          `${i + 1}. ${scene.catAction} in ${scene.environment} (${scene.subtitleText})`
      )
      .join('; ');

    return `9:16 vertical TikTok video, ${story.totalDurationSeconds}s: ${story.narrative}. Chubby orange tabby cat. Scenes: ${sceneList}. ${story.musicStyle}. Cinematic, emotional, with meme-style subtitles.`;
  }

  /**
   * Get prompt statistics
   */
  public getPromptStats(prompt: string): {
    length: number;
    wordCount: number;
    lines: number;
  } {
    return {
      length: prompt.length,
      wordCount: prompt.split(/\s+/).length,
      lines: prompt.split('\n').length,
    };
  }
}
