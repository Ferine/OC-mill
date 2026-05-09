import { join } from 'path';
import { readFile } from 'fs/promises';
import { OpenRouterVideoClient } from '../clients/OpenRouterVideoClient';
import { runWithConcurrency } from '../pipeline/concurrency';
import { Story, Scene } from '../story/types';
import { SceneKeyframeResult } from './ImageService';
import { logger } from '../utils/logger';

export interface SceneClipResult {
  sceneIndex: number;
  path: string;
  bytes: number;
  durationSeconds: number;
}

export class VideoClipService {
  constructor(
    private client: OpenRouterVideoClient,
    private model: string
  ) {}

  /**
   * Generate one image-to-video clip for a single scene. The scene's keyframe
   * is passed as `first_frame` so the clip starts on the rendered keyframe and
   * preserves character continuity end-to-end.
   */
  public async generateClip(opts: {
    scene: Scene;
    sceneIndex: number;
    keyframePath: string;
    outputDir: string;
  }): Promise<SceneClipResult> {
    const firstFrame = await readFile(opts.keyframePath);
    const prompt = buildClipPrompt(opts.scene);

    const jobId = await this.client.createJob({
      model: this.model,
      prompt,
      aspectRatio: '9:16',
      durationSeconds: opts.scene.durationSeconds,
      generateAudio: false,
      firstFrame,
    });
    const job = await this.client.pollUntilComplete(jobId);

    const path = join(
      opts.outputDir,
      `scene-${String(opts.sceneIndex).padStart(2, '0')}-clip.mp4`
    );
    const bytes = await this.client.downloadVideo(job.videoUrl!, path);

    logger.info('Scene clip ready', {
      sceneIndex: opts.sceneIndex,
      path,
      bytes,
      durationSeconds: opts.scene.durationSeconds,
    });

    return {
      sceneIndex: opts.sceneIndex,
      path,
      bytes,
      durationSeconds: opts.scene.durationSeconds,
    };
  }

  public async generateAllClips(opts: {
    story: Story;
    keyframes: SceneKeyframeResult[];
    outputDir: string;
    concurrency: number;
  }): Promise<SceneClipResult[]> {
    logger.info('Generating clips for all scenes', {
      sceneCount: opts.story.scenes.length,
      outputDir: opts.outputDir,
      concurrency: opts.concurrency,
    });

    const tasks = opts.story.scenes.map((scene, sceneIndex) => () => {
      const keyframe = opts.keyframes.find((k) => k.sceneIndex === sceneIndex);
      if (!keyframe) {
        throw new Error(`Missing keyframe for scene ${sceneIndex}`);
      }
      return this.generateClip({
        scene,
        sceneIndex,
        keyframePath: keyframe.path,
        outputDir: opts.outputDir,
      });
    });

    return runWithConcurrency(tasks, opts.concurrency);
  }
}

function buildClipPrompt(scene: Scene): string {
  return `Vertical 9:16 cinematic video clip, ${scene.durationSeconds} seconds.

Scene description: ${scene.description}
Environment: ${scene.environment}
Cat action and motion: ${scene.catAction}
Camera movement: ${scene.cameraMotion}
Mood: ${scene.mood}

Animate naturally from the provided first frame. Preserve the cat's exact appearance throughout the clip — same chubby orange tabby, same fur, same eyes. No text overlays, no captions, no UI.`;
}
