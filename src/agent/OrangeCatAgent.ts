import { join } from 'path';
import { StoryService } from '../llm/StoryService';
import { CaptionGenerator } from '../caption/CaptionGenerator';
import { TikTokClient } from '../clients/TikTokClient';
import { OpenRouterImageClient } from '../clients/OpenRouterImageClient';
import { OpenRouterVideoClient } from '../clients/OpenRouterVideoClient';
import { CharacterReferenceCache } from '../services/CharacterReferenceCache';
import { ImageService, SceneKeyframeResult } from '../media/ImageService';
import { VideoClipService, SceneClipResult } from '../media/VideoClipService';
import { StatisticsTracker } from '../services/StatisticsTracker';
import { APIRateLimiters } from '../utils/RateLimiter';
import { Config } from '../utils/config';
import { logger } from '../utils/logger';
import { Story } from '../story/types';

export interface AgentRunResult {
  success: boolean;
  story: Story;
  keyframes?: SceneKeyframeResult[];
  clips?: SceneClipResult[];
  videoPath?: string;
  videoSizeBytes?: number;
  tiktokPostId?: string;
  tiktokShareUrl?: string;
  error?: string;
  duration: number;
}

/**
 * OrangeCatAgent — orchestrates the per-scene generation pipeline.
 *
 * Pipeline (target end-state):
 *   Story (LLM)
 *     └─► Character reference image                      [Phase 2]
 *     └─► For each scene (parallel, p-limited):
 *           1. Keyframe image (text+ref → image)         [Phase 2]
 *           2. Video clip   (image-to-video, OpenRouter) [Phase 3]
 *           3. TTS narration (ElevenLabs)                [Phase 4]
 *           4. VLM eval gate (1 retry)                   [Phase 5]
 *     └─► Compositor (ffmpeg concat + audio mix + ASS)   [Phase 4]
 *     └─► TikTok upload                                  [implemented]
 *     └─► Statistics                                     [implemented]
 *
 * Currently implemented stages: story generation, caption generation,
 * statistics, TikTok upload (preserved). Video / image / narration /
 * eval / compositing are stubbed and throw NotImplementedError until
 * the corresponding phase lands.
 */
export class OrangeCatAgent {
  private storyService: StoryService;
  private imageClient: OpenRouterImageClient;
  private videoClient: OpenRouterVideoClient;
  private characterCache: CharacterReferenceCache;
  private imageService: ImageService;
  private videoClipService: VideoClipService;
  private captionGenerator: CaptionGenerator;
  private tiktokClient: TikTokClient;
  private statisticsTracker: StatisticsTracker;
  private rateLimiters: APIRateLimiters;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    this.storyService = new StoryService(config.openrouter, {
      targetDurationSeconds: config.pipeline.videoDurationSeconds,
    });
    this.imageClient = new OpenRouterImageClient(config.openrouter);
    this.videoClient = new OpenRouterVideoClient(config.openrouter, {
      maxPollAttempts: config.pipeline.maxPollAttempts,
      pollIntervalMs: config.pipeline.pollIntervalMs,
    });
    this.characterCache = new CharacterReferenceCache(
      this.imageClient,
      config.openrouter.imageModel,
      config.pipeline.characterRefDir
    );
    this.imageService = new ImageService(
      this.imageClient,
      this.characterCache,
      config.openrouter.imageModel
    );
    this.videoClipService = new VideoClipService(
      this.videoClient,
      config.openrouter.videoModel
    );
    this.captionGenerator = new CaptionGenerator();
    this.tiktokClient = new TikTokClient({
      apiKey: config.tiktok.apiKey,
      baseUrl: config.tiktok.baseUrl,
    });
    this.statisticsTracker = new StatisticsTracker();
    this.rateLimiters = new APIRateLimiters();

    logger.info('OrangeCatAgent initialized', {
      llmModel: config.openrouter.llmModel,
      imageModel: config.openrouter.imageModel,
      videoModel: config.openrouter.videoModel,
      videoDurationSeconds: config.pipeline.videoDurationSeconds,
      sceneConcurrency: config.pipeline.sceneConcurrency,
    });
  }

  public async initialize(): Promise<void> {
    await this.statisticsTracker.initialize();
    logger.info('OrangeCatAgent fully initialized');
  }

  public async runOnce(): Promise<AgentRunResult> {
    const startTime = Date.now();
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = join(this.config.pipeline.videoDownloadPath, `run-${runId}`);
    let story: Story | undefined;
    let keyframes: SceneKeyframeResult[] | undefined;
    let clips: SceneClipResult[] | undefined;

    try {
      logger.info('🚀 Starting OrangeCatAgent run', { runId, runDir });

      // Step 1: Generate story
      logger.info('📖 Step 1: Generating story');
      await this.rateLimiters.openrouterLLM.consume('story-generation');
      story = await this.storyService.generateStory();

      // Step 2: Generate per-scene keyframe images
      logger.info('🎨 Step 2: Generating scene keyframes');
      const keyframeDir = join(runDir, 'keyframes');
      for (let i = 0; i < story.scenes.length; i++) {
        await this.rateLimiters.openrouterImage.consume('keyframe');
      }
      keyframes = await this.imageService.generateAllKeyframes({
        story,
        outputDir: keyframeDir,
        concurrency: this.config.pipeline.sceneConcurrency,
      });

      // Step 3: Generate per-scene video clips (image-to-video)
      logger.info('🎬 Step 3: Generating scene video clips');
      const clipDir = join(runDir, 'clips');
      for (let i = 0; i < story.scenes.length; i++) {
        await this.rateLimiters.openrouterVideo.consume('clip');
      }
      clips = await this.videoClipService.generateAllClips({
        story,
        keyframes,
        outputDir: clipDir,
        concurrency: this.config.pipeline.sceneConcurrency,
      });
      logger.info('Clips ready', { count: clips.length, outputDir: clipDir });

      // Steps 4-7: narration, eval, composition, upload — Phases 4-5.
      throw new NotImplementedError(
        'Narration, eval gate, compositing, and upload are not yet wired up. ' +
          'Phases 4-5 must land before runOnce() can complete end-to-end.'
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('❌ OrangeCatAgent run failed', {
        error: errorMessage,
        durationMs: duration,
      });

      if (story) {
        await this.statisticsTracker.recordRun({
          timestamp: new Date().toISOString(),
          success: false,
          archetype: story.archetype,
          storyGenerationMethod: this.config.openrouter.llmModel,
          duration,
          error: errorMessage,
          sceneCount: story.scenes.length,
        });
      }

      return {
        success: false,
        story:
          story ??
          ({
            archetype: 'RagsToRiches',
            title: '(no story generated)',
            narrative: '',
            totalDurationSeconds: 0,
            scenes: [],
            overallMood: 'heartwarming',
            musicStyle: '',
          } as Story),
        keyframes,
        clips,
        error: errorMessage,
        duration,
      };
    }
  }

  public async runMultiple(count: number): Promise<AgentRunResult[]> {
    logger.info(`Running agent ${count} times sequentially`);
    const results: AgentRunResult[] = [];
    for (let i = 0; i < count; i++) {
      logger.info(`Starting run ${i + 1}/${count}`);
      const result = await this.runOnce();
      results.push(result);
      if (i < count - 1) {
        await this.sleep(5000);
      }
    }
    const successCount = results.filter((r) => r.success).length;
    logger.info(`Completed ${count} runs`, {
      successful: successCount,
      failed: count - successCount,
    });
    return results;
  }

  /**
   * Dry run — exercises only the LLM stage (story + caption).
   * Useful for validating Phase 1 in isolation before later phases land.
   */
  public async dryRun(): Promise<{ story: Story; caption: string }> {
    logger.info('🧪 Running dry run (LLM only)');
    const story = await this.storyService.generateStory();
    const caption = this.captionGenerator.generateCaption(story);

    console.log('\n=== STORY ===');
    console.log(JSON.stringify(story, null, 2));
    console.log('\n=== TIKTOK CAPTION ===');
    console.log(caption);

    return { story, caption };
  }

  public getStatisticsReport(): string {
    return this.statisticsTracker.getFormattedReport();
  }

  public getStatistics() {
    return this.statisticsTracker;
  }

  /** Phase 4 wires this into the publish step. */
  public getTikTokClient(): TikTokClient {
    return this.tiktokClient;
  }

  public shutdown(): void {
    this.rateLimiters.stopAll();
    logger.info('OrangeCatAgent shutdown');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}
