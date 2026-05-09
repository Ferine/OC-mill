import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { OpenRouterImageClient } from '../clients/OpenRouterImageClient';
import { CharacterReferenceCache } from '../services/CharacterReferenceCache';
import { runWithConcurrency } from '../pipeline/concurrency';
import { Story, Scene } from '../story/types';
import { logger } from '../utils/logger';

export interface SceneKeyframeResult {
  sceneIndex: number;
  path: string;
  bytes: number;
}

export class ImageService {
  constructor(
    private client: OpenRouterImageClient,
    private characterCache: CharacterReferenceCache,
    private model: string
  ) {}

  /**
   * Generate a single keyframe for a scene, using the cached character
   * reference image to keep the cat visually consistent.
   */
  public async generateKeyframe(opts: {
    story: Story;
    scene: Scene;
    sceneIndex: number;
    outputDir: string;
  }): Promise<SceneKeyframeResult> {
    const characterRef = await this.characterCache.getReference(
      opts.story.archetype
    );
    const prompt = this.buildKeyframePrompt(opts.scene);

    const buffer = await this.client.generate({
      model: this.model,
      prompt,
      referenceImages: [characterRef],
      aspectRatio: '9:16',
    });

    await mkdir(opts.outputDir, { recursive: true });
    const path = join(
      opts.outputDir,
      `scene-${String(opts.sceneIndex).padStart(2, '0')}-keyframe.png`
    );
    await writeFile(path, buffer);

    logger.info('Keyframe generated', {
      sceneIndex: opts.sceneIndex,
      path,
      bytes: buffer.length,
    });

    return { sceneIndex: opts.sceneIndex, path, bytes: buffer.length };
  }

  /**
   * Generate keyframes for every scene in the story with bounded concurrency.
   */
  public async generateAllKeyframes(opts: {
    story: Story;
    outputDir: string;
    concurrency: number;
  }): Promise<SceneKeyframeResult[]> {
    logger.info('Generating keyframes for all scenes', {
      sceneCount: opts.story.scenes.length,
      outputDir: opts.outputDir,
      concurrency: opts.concurrency,
    });

    const tasks = opts.story.scenes.map(
      (scene, sceneIndex) => () =>
        this.generateKeyframe({
          story: opts.story,
          scene,
          sceneIndex,
          outputDir: opts.outputDir,
        })
    );
    return runWithConcurrency(tasks, opts.concurrency);
  }

  private buildKeyframePrompt(scene: Scene): string {
    return `Vertical 9:16 TikTok keyframe, cinematic photorealistic style.

Scene description: ${scene.description}
Environment: ${scene.environment}
Cat action and pose: ${scene.catAction}
Camera framing: ${scene.cameraMotion}
Mood: ${scene.mood}

CRITICAL: The cat MUST match the provided reference image exactly — same chubby orange tabby, same fur pattern, same eyes, same body shape. Do not invent a new cat. Maintain perfect character continuity.

No text overlays, no captions, no UI, no other animals or humans unless the scene description requires them. High detail, professional lighting.`;
  }
}
