import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { OpenRouterImageClient } from '../clients/OpenRouterImageClient';
import { CharacterReferenceCache } from '../services/CharacterReferenceCache';
import { EvalService } from '../llm/EvalService';
import { runWithConcurrency } from '../pipeline/concurrency';
import { Story, Scene } from '../story/types';
import { logger } from '../utils/logger';

export interface SceneKeyframeResult {
  sceneIndex: number;
  path: string;
  bytes: number;
  evalAttempts: number;
  evalPassed: boolean;
}

export interface ImageServiceOptions {
  /** Optional VLM eval gate. When provided, each keyframe is QA'd. */
  evalService?: EvalService;
  /** Max regenerations on eval failure (in addition to the initial attempt). */
  evalRetriesPerScene?: number;
}

export class ImageService {
  private evalService?: EvalService;
  private evalRetries: number;

  constructor(
    private client: OpenRouterImageClient,
    private characterCache: CharacterReferenceCache,
    private model: string,
    opts: ImageServiceOptions = {}
  ) {
    this.evalService = opts.evalService;
    this.evalRetries = opts.evalRetriesPerScene ?? 0;
  }

  /**
   * Generate one keyframe with optional VLM eval gating + retry.
   *
   * On eval failure, the failure feedback is appended to the image prompt
   * for the next attempt so the model can correct the specific issue.
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
    await mkdir(opts.outputDir, { recursive: true });
    const path = join(
      opts.outputDir,
      `scene-${String(opts.sceneIndex).padStart(2, '0')}-keyframe.png`
    );

    let attempt = 0;
    let feedback: string | undefined;
    const maxAttempts = 1 + (this.evalService ? this.evalRetries : 0);

    while (attempt < maxAttempts) {
      attempt++;
      const prompt = this.buildKeyframePrompt(opts.scene, feedback);

      const buffer = await this.client.generate({
        model: this.model,
        prompt,
        referenceImages: [characterRef],
        aspectRatio: '9:16',
      });
      await writeFile(path, buffer);

      logger.info('Keyframe generated', {
        sceneIndex: opts.sceneIndex,
        attempt,
        path,
        bytes: buffer.length,
      });

      if (!this.evalService) {
        return {
          sceneIndex: opts.sceneIndex,
          path,
          bytes: buffer.length,
          evalAttempts: attempt,
          evalPassed: true,
        };
      }

      const evalResult = await this.evalService.evaluateKeyframe({
        image: buffer,
        scene: opts.scene,
      });

      if (evalResult.pass) {
        return {
          sceneIndex: opts.sceneIndex,
          path,
          bytes: buffer.length,
          evalAttempts: attempt,
          evalPassed: true,
        };
      }

      feedback = evalResult.feedback;
      logger.warn('Keyframe eval failed — will retry if budget remains', {
        sceneIndex: opts.sceneIndex,
        attempt,
        retriesRemaining: maxAttempts - attempt,
        feedback: feedback.slice(0, 200),
      });
    }

    // Budget exhausted: keep the last keyframe so the run can still proceed,
    // but flag it as a failed eval in the result for stats.
    const lastBuffer = await readFile(path);
    logger.error('Keyframe eval budget exhausted — proceeding with last attempt', {
      sceneIndex: opts.sceneIndex,
    });
    return {
      sceneIndex: opts.sceneIndex,
      path,
      bytes: lastBuffer.length,
      evalAttempts: attempt,
      evalPassed: false,
    };
  }

  public async generateAllKeyframes(opts: {
    story: Story;
    outputDir: string;
    concurrency: number;
  }): Promise<SceneKeyframeResult[]> {
    logger.info('Generating keyframes for all scenes', {
      sceneCount: opts.story.scenes.length,
      outputDir: opts.outputDir,
      concurrency: opts.concurrency,
      evalGate: !!this.evalService,
      evalRetries: this.evalRetries,
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

  private buildKeyframePrompt(scene: Scene, feedback?: string): string {
    const base = `Vertical 9:16 TikTok keyframe, cinematic photorealistic style.

Scene description: ${scene.description}
Environment: ${scene.environment}
Cat action and pose: ${scene.catAction}
Camera framing: ${scene.cameraMotion}
Mood: ${scene.mood}

CRITICAL: The cat MUST match the provided reference image exactly — same chubby orange tabby, same fur pattern, same eyes, same body shape. Do not invent a new cat. Maintain perfect character continuity.

No text overlays, no captions, no UI, no other animals or humans unless the scene description requires them. High detail, professional lighting.`;

    if (!feedback) return base;
    return `${base}\n\nPREVIOUS ATTEMPT FAILED QA. Reviewer feedback: ${feedback}\nFix this specific issue while keeping the scene description otherwise intact.`;
  }
}
