import { join } from 'path';
import { mkdir, readFile } from 'fs/promises';
import { OpenRouterImageClient } from '../clients/OpenRouterImageClient';
import { CharacterReferenceCache } from '../services/CharacterReferenceCache';
import { EvalService } from '../llm/EvalService';
import { runWithConcurrency } from '../pipeline/concurrency';
import { PipelineEventBus } from '../pipeline/events';
import { Story, Scene } from '../story/types';
import { atomicWrite, isCachedFile, readJson } from '../utils/io';
import { logger } from '../utils/logger';

export interface SceneKeyframeResult {
  sceneIndex: number;
  path: string;
  bytes: number;
  evalAttempts: number;
  evalPassed: boolean;
  /** True when the result came from a cached file (resume path). */
  fromCache?: boolean;
}

interface CachedKeyframeMeta {
  sceneIndex: number;
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
    events?: PipelineEventBus;
  }): Promise<SceneKeyframeResult> {
    await mkdir(opts.outputDir, { recursive: true });
    const path = join(
      opts.outputDir,
      `scene-${String(opts.sceneIndex).padStart(2, '0')}-keyframe.png`
    );
    const metaPath = `${path}.meta.json`;

    // Resume path: if the keyframe (and its eval metadata) already exists
    // and previously passed, return it without re-spending image/VLM tokens.
    if (await isCachedFile(path, 1024)) {
      try {
        const meta = await readJson<CachedKeyframeMeta>(metaPath);
        if (meta.evalPassed) {
          logger.info('Keyframe cache hit (resume)', {
            sceneIndex: opts.sceneIndex,
            path,
            evalAttempts: meta.evalAttempts,
          });
          opts.events?.publish({
            type: 'scene.keyframe.ready',
            sceneIndex: opts.sceneIndex,
            path,
            bytes: meta.bytes,
            evalAttempts: meta.evalAttempts,
            evalPassed: true,
            fromCache: true,
          });
          return {
            sceneIndex: opts.sceneIndex,
            path,
            bytes: meta.bytes,
            evalAttempts: meta.evalAttempts,
            evalPassed: true,
            fromCache: true,
          };
        }
        logger.info('Keyframe cached but did not pass eval — regenerating', {
          sceneIndex: opts.sceneIndex,
        });
      } catch {
        logger.info('Keyframe present but metadata missing — regenerating', {
          sceneIndex: opts.sceneIndex,
        });
      }
    }

    const characterRef = await this.characterCache.getReference(
      opts.story.archetype
    );

    let attempt = 0;
    let feedback: string | undefined;
    const maxAttempts = 1 + (this.evalService ? this.evalRetries : 0);

    while (attempt < maxAttempts) {
      attempt++;
      opts.events?.publish({
        type: 'scene.keyframe.start',
        sceneIndex: opts.sceneIndex,
        attempt,
      });
      const prompt = this.buildKeyframePrompt(opts.scene, feedback);

      const buffer = await this.client.generate({
        model: this.model,
        prompt,
        referenceImages: [characterRef],
        aspectRatio: '9:16',
      });
      await atomicWrite(path, buffer);

      logger.info('Keyframe generated', {
        sceneIndex: opts.sceneIndex,
        attempt,
        path,
        bytes: buffer.length,
      });

      const writeMeta = async (evalPassed: boolean) => {
        const meta: CachedKeyframeMeta = {
          sceneIndex: opts.sceneIndex,
          bytes: buffer.length,
          evalAttempts: attempt,
          evalPassed,
        };
        await atomicWrite(metaPath, JSON.stringify(meta, null, 2));
      };

      if (!this.evalService) {
        await writeMeta(true);
        opts.events?.publish({
          type: 'scene.keyframe.ready',
          sceneIndex: opts.sceneIndex,
          path,
          bytes: buffer.length,
          evalAttempts: attempt,
          evalPassed: true,
        });
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
        await writeMeta(true);
        opts.events?.publish({
          type: 'scene.keyframe.ready',
          sceneIndex: opts.sceneIndex,
          path,
          bytes: buffer.length,
          evalAttempts: attempt,
          evalPassed: true,
        });
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
      opts.events?.publish({
        type: 'scene.keyframe.evalFail',
        sceneIndex: opts.sceneIndex,
        attempt,
        feedback,
      });
    }

    // Budget exhausted: keep the last keyframe so the run can still proceed,
    // but flag it as a failed eval in the result for stats.
    const lastBuffer = await readFile(path);
    const meta: CachedKeyframeMeta = {
      sceneIndex: opts.sceneIndex,
      bytes: lastBuffer.length,
      evalAttempts: attempt,
      evalPassed: false,
    };
    await atomicWrite(metaPath, JSON.stringify(meta, null, 2));
    logger.error('Keyframe eval budget exhausted — proceeding with last attempt', {
      sceneIndex: opts.sceneIndex,
    });
    opts.events?.publish({
      type: 'scene.keyframe.ready',
      sceneIndex: opts.sceneIndex,
      path,
      bytes: lastBuffer.length,
      evalAttempts: attempt,
      evalPassed: false,
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
    events?: PipelineEventBus;
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
          events: opts.events,
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
