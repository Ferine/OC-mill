import { Story, Scene } from '../story/types';
import { logger } from '../utils/logger';

/**
 * KlingPromptBuilder converts Story objects into detailed text prompts
 * optimized for Kling AI's text-to-video generation
 */
export class KlingPromptBuilder {
  /**
   * Build a complete Kling-compatible prompt from a story
   */
  public buildPrompt(story: Story): string {
    logger.info('Building Kling prompt', {
      archetype: story.archetype,
      sceneCount: story.scenes.length,
    });

    const sections = [
      this.buildHeader(story),
      this.buildCharacterDescription(),
      this.buildSceneSequence(story.scenes),
      this.buildVisualStyle(),
      this.buildAudioDescription(story.musicStyle),
      this.buildTechnicalSpecs(story.totalDurationSeconds),
    ];

    const fullPrompt = sections.filter(Boolean).join('\n\n');

    logger.debug('Prompt built successfully', {
      promptLength: fullPrompt.length,
      archetype: story.archetype,
    });

    return fullPrompt;
  }

  /**
   * Build the prompt header with overall narrative
   */
  private buildHeader(story: Story): string {
    return `Create a vertical 9:16 TikTok-style video story: "${story.title}"

NARRATIVE: ${story.narrative}
OVERALL MOOD: ${story.overallMood}
TARGET DURATION: ${story.totalDurationSeconds} seconds`;
  }

  /**
   * Build detailed character description
   */
  private buildCharacterDescription(): string {
    return `MAIN CHARACTER:
An extremely chubby orange tabby cat with:
- Distinctly fat, round body with prominent belly
- Bright orange and white striped fur
- Large, expressive eyes (amber or green)
- Pink nose and toe beans
- Soft, fluffy appearance
- Endearing, slightly grumpy facial expression
- Notable waddle when walking due to size
- Highly food-motivated personality
- Range of expressions from grumpy to content to mischievous`;
  }

  /**
   * Build the detailed scene sequence
   */
  private buildSceneSequence(scenes: Scene[]): string {
    const sceneDescriptions = scenes
      .map((scene, index) => this.buildSceneDescription(scene, index + 1))
      .join('\n\n');

    return `SCENE SEQUENCE (${scenes.length} scenes):

${sceneDescriptions}`;
  }

  /**
   * Build description for a single scene
   */
  private buildSceneDescription(scene: Scene, sceneNumber: number): string {
    return `Scene ${sceneNumber} (${scene.durationSeconds}s):
SETTING: ${scene.environment}
ACTION: ${scene.catAction}
CAMERA: ${scene.cameraMotion}
MOOD: ${scene.mood}
SUBTITLE: "${scene.subtitleText}"
DESCRIPTION: ${scene.description}`;
  }

  /**
   * Build visual style guidelines
   */
  private buildVisualStyle(): string {
    return `VISUAL STYLE:
- Cinematic quality with soft, warm lighting
- Shallow depth of field for emotional scenes
- Vibrant but natural colors
- Smooth transitions between scenes (fades, dissolves, or match cuts)
- Meme-style text overlays for subtitles (white text, black outline, top or bottom placement)
- Focus on cat's expressive face and body language
- Vertical 9:16 aspect ratio optimized for mobile viewing
- TikTok-friendly framing with subject centered in safe zone`;
  }

  /**
   * Build audio/music description
   */
  private buildAudioDescription(musicStyle: string): string {
    return `AUDIO & MUSIC:
- Background music: ${musicStyle}
- Music should match the emotional arc of the story
- Subtle sound effects where appropriate (purring, meowing, ambient sounds)
- Audio should build emotional engagement
- Volume mixed to support but not overpower the visual narrative`;
  }

  /**
   * Build technical specifications
   */
  private buildTechnicalSpecs(duration: number): string {
    return `TECHNICAL REQUIREMENTS:
- Aspect ratio: 9:16 (vertical/portrait)
- Duration: ${duration} seconds (approximately)
- Frame rate: 24-30 fps
- Resolution: 1080x1920 minimum
- Format: MP4 (H.264)
- Optimized for TikTok upload
- Include text overlays as burned-in subtitles
- Maintain consistent character appearance throughout all scenes`;
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
