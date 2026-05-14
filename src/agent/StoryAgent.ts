import { join } from 'path';
import { mkdir, readdir, stat } from 'fs/promises';
import { StoryService } from '../llm/StoryService';
import { EvalService } from '../llm/EvalService';
import { CaptionGenerator } from '../caption/CaptionGenerator';
import { TikTokClient } from '../clients/TikTokClient';
import { OpenRouterImageClient } from '../clients/OpenRouterImageClient';
import { OpenRouterVideoClient } from '../clients/OpenRouterVideoClient';
import { OpenRouterTTSClient } from '../clients/OpenRouterTTSClient';
import { OpenRouterMusicClient } from '../clients/OpenRouterMusicClient';
import { BrandRegistry } from '../brand/BrandRegistry';
import { CharacterReferenceCache } from '../services/CharacterReferenceCache';
import { VideoValidator } from '../services/VideoValidator';
import { ImageService, SceneKeyframeResult } from '../media/ImageService';
import { VideoClipService, SceneClipResult } from '../media/VideoClipService';
import {
  NarrationService,
  SceneNarrationResult,
} from '../media/NarrationService';
import { MusicService } from '../media/MusicService';
import { Compositor } from '../media/Compositor';
import { StatisticsTracker } from '../services/StatisticsTracker';
import { APIRateLimiters } from '../utils/RateLimiter';
import { Config } from '../utils/config';
import { atomicWrite, isCachedFile, readJson } from '../utils/io';
import { logger } from '../utils/logger';
import { PipelineEventBus } from '../pipeline/events';
import { Story } from '../story/types';
import { Brand } from '../brand/types';

export interface RunOnceOptions {
  /** Resume a previously-started run from this directory. */
  resumeFromRunDir?: string;
  /** Optional event bus for streaming progress to the HTTP server / UI. */
  events?: PipelineEventBus;
  /** Brand id for a fresh run. Required unless resuming. */
  brandId?: string;
  /** Optional archetype slug; randomly chosen from the brand if absent. */
  archetypeId?: string;
  /** Optional free-text creative seed injected into the LLM story prompt. */
  seed?: string;
}

export interface AgentRunResult {
  success: boolean;
  story: Story;
  runDir: string;
  keyframes?: SceneKeyframeResult[];
  clips?: SceneClipResult[];
  narrations?: SceneNarrationResult[];
  videoPath?: string;
  videoSizeBytes?: number;
  tiktokPostId?: string;
  tiktokShareUrl?: string;
  error?: string;
  duration: number;
}

/**
 * StoryAgent — orchestrates the per-scene generation pipeline for any
 * registered brand. The brand is a per-run choice (loaded from the
 * BrandRegistry at the top of `runOnce`) and threaded through every
 * service call as an explicit argument — no service holds a brand
 * reference across runs.
 */
export class StoryAgent {
  private storyService: StoryService;
  private imageClient: OpenRouterImageClient;
  private videoClient: OpenRouterVideoClient;
  private ttsClient: OpenRouterTTSClient;
  private characterCache: CharacterReferenceCache;
  private imageService: ImageService;
  private videoClipService: VideoClipService;
  private narrationService: NarrationService;
  private musicService: MusicService;
  private compositor: Compositor;
  private videoValidator: VideoValidator;
  private captionGenerator: CaptionGenerator;
  private tiktokClient: TikTokClient;
  private statisticsTracker: StatisticsTracker;
  private rateLimiters: APIRateLimiters;
  private brandRegistry: BrandRegistry;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.brandRegistry = new BrandRegistry(config.pipeline.brandsDir);

    this.storyService = new StoryService(config.openrouter, {
      targetDurationSeconds: config.pipeline.videoDurationSeconds,
    });
    this.imageClient = new OpenRouterImageClient(config.openrouter);
    this.videoClient = new OpenRouterVideoClient(config.openrouter, {
      maxPollAttempts: config.pipeline.maxPollAttempts,
      pollIntervalMs: config.pipeline.pollIntervalMs,
    });
    this.ttsClient = new OpenRouterTTSClient(
      config.openrouter,
      config.openrouter.ttsModel
    );
    this.characterCache = new CharacterReferenceCache(
      this.imageClient,
      config.openrouter.imageModel,
      config.pipeline.characterRefDir
    );
    const evalService =
      config.pipeline.evalRetriesPerScene > 0
        ? new EvalService(config.openrouter)
        : undefined;
    this.imageService = new ImageService(
      this.imageClient,
      this.characterCache,
      config.openrouter.imageModel,
      {
        evalService,
        evalRetriesPerScene: config.pipeline.evalRetriesPerScene,
      }
    );
    this.videoClipService = new VideoClipService(
      this.videoClient,
      config.openrouter.videoModel
    );
    this.narrationService = new NarrationService(
      this.ttsClient,
      config.tts.voicesByMood,
      config.tts.format
    );
    this.musicService = new MusicService(
      new OpenRouterMusicClient(config.openrouter),
      config.openrouter.musicModel
    );
    this.compositor = new Compositor();
    this.videoValidator = new VideoValidator(
      config.pipeline.videoDurationSeconds
    );
    this.captionGenerator = new CaptionGenerator();
    this.tiktokClient = new TikTokClient({
      apiKey: config.tiktok.apiKey,
      baseUrl: config.tiktok.baseUrl,
    });
    this.statisticsTracker = new StatisticsTracker();
    this.rateLimiters = new APIRateLimiters();

    logger.info('StoryAgent initialized', {
      llmModel: config.openrouter.llmModel,
      imageModel: config.openrouter.imageModel,
      videoModel: config.openrouter.videoModel,
      videoDurationSeconds: config.pipeline.videoDurationSeconds,
      sceneConcurrency: config.pipeline.sceneConcurrency,
    });
  }

  public async initialize(): Promise<void> {
    await this.statisticsTracker.initialize();
    await this.brandRegistry.initialize();
    logger.info('StoryAgent fully initialized');
  }

  public getBrandRegistry(): BrandRegistry {
    return this.brandRegistry;
  }

  /**
   * One-shot LLM call to produce a creative seed for a brand+archetype.
   * Used by the UI's "✨ Surprise me" button on the new-run form.
   */
  public async suggestSeed(opts: {
    brandId: string;
    archetypeId?: string;
  }): Promise<string> {
    const brand = this.brandRegistry.get(opts.brandId);
    if (!brand) throw new Error(`Unknown brand "${opts.brandId}"`);
    return this.storyService.suggestSeed({
      brand,
      archetypeId: opts.archetypeId,
    });
  }

  public async runOnce(opts: RunOnceOptions = {}): Promise<AgentRunResult> {
    const startTime = Date.now();

    // Resume: derive runDir from caller; otherwise mint a fresh one.
    let runDir: string;
    let resuming = false;
    if (opts.resumeFromRunDir) {
      runDir = opts.resumeFromRunDir;
      resuming = true;
    } else {
      const runId = new Date().toISOString().replace(/[:.]/g, '-');
      runDir = join(this.config.pipeline.videoDownloadPath, `run-${runId}`);
    }
    await mkdir(runDir, { recursive: true });
    const storyPath = join(runDir, 'story.json');
    const events = opts.events;

    let brand: Brand | undefined;
    let story: Story | undefined;
    let keyframes: SceneKeyframeResult[] | undefined;
    let clips: SceneClipResult[] | undefined;
    let narrations: SceneNarrationResult[] | undefined;
    let videoPath: string | undefined;
    let videoSizeBytes: number | undefined;

    try {
      logger.info(resuming ? '↻ Resuming StoryAgent run' : '🚀 Starting StoryAgent run', {
        runDir,
        resuming,
      });
      events?.publish({ type: 'run.start', runDir, resuming });

      // Step 1: Story — load from disk if resuming, else generate + persist.
      logger.info('📖 Step 1/7: Story');
      events?.publish({ type: 'story.start' });
      if (resuming) {
        // Resume MUST find an existing story. Generating a fresh one would
        // mismatch any per-scene outputs already on disk and overwrite them
        // with content for a different story — silently destructive.
        if (!(await isCachedFile(storyPath, 100))) {
          throw new Error(
            `Cannot resume ${runDir}: story.json is missing. ` +
              `This run was likely created by an older build. ` +
              `Start a fresh run instead, or delete the runDir to discard it.`
          );
        }
        story = await readJson<Story>(storyPath);
        if (!story.brandId) {
          throw new Error(
            `Cannot resume ${runDir}: story.json predates the brand pivot ` +
              `(missing brandId). Start a fresh run.`
          );
        }
        brand = this.brandRegistry.get(story.brandId);
        if (!brand) {
          throw new Error(
            `Cannot resume ${runDir}: brand "${story.brandId}" is no longer ` +
              `registered. Restore the brand JSON under brands/ or start a fresh run.`
          );
        }
        logger.info('Story loaded from cache', {
          brandId: story.brandId,
          archetypeId: story.archetypeId,
          title: story.title,
          scenes: story.scenes.length,
        });
        events?.publish({ type: 'story.ready', story, fromCache: true });
      } else {
        const brandId = opts.brandId ?? this.config.pipeline.defaultBrandId;
        brand = this.brandRegistry.get(brandId);
        if (!brand) {
          throw new Error(
            `Unknown brand "${brandId}". Available brands: ${this.brandRegistry
              .list()
              .map((b) => b.id)
              .join(', ') || '(none)'}`
          );
        }
        await this.rateLimiters.openrouterLLM.consume('story-generation');
        story = await this.storyService.generateStory({
          brand,
          archetypeId: opts.archetypeId,
          seed: opts.seed,
        });
        await atomicWrite(storyPath, JSON.stringify(story, null, 2));
        logger.info('Story persisted', { storyPath, brandId: brand.id });
        events?.publish({ type: 'story.ready', story });
      }

      // Step 2: Per-scene keyframes
      // Note: no pre-consume loop — `sceneConcurrency` provides backpressure
      // and the OpenRouter clients handle 429/5xx with retry. The local
      // rate limiter is still wired up for single-call stages (story, upload).
      logger.info('🎨 Step 2/7: Generating scene keyframes');
      events?.publish({ type: 'stage.start', stage: 'keyframes' });
      const keyframeDir = join(runDir, 'keyframes');
      keyframes = await this.imageService.generateAllKeyframes({
        brand,
        story,
        outputDir: keyframeDir,
        concurrency: this.config.pipeline.sceneConcurrency,
        events,
      });
      events?.publish({ type: 'stage.done', stage: 'keyframes' });

      // Step 3: Per-scene video clips (image-to-video, parallel)
      logger.info('🎬 Step 3/7: Generating scene video clips');
      events?.publish({ type: 'stage.start', stage: 'clips' });
      const clipDir = join(runDir, 'clips');
      clips = await this.videoClipService.generateAllClips({
        brand,
        story,
        keyframes,
        outputDir: clipDir,
        concurrency: this.config.pipeline.sceneConcurrency,
        events,
      });
      events?.publish({ type: 'stage.done', stage: 'clips' });

      // Step 4: Narration + music in parallel.
      // Narration is per-scene (~10-30s total); music is one ~30-60s
      // generation that often takes longer. Running them concurrently hides
      // the music latency. Music failure is non-fatal — the run continues
      // with narration only.
      logger.info('🗣️  Step 4/7: Generating narration + music');
      events?.publish({ type: 'stage.start', stage: 'narration' });
      const narrationDir = join(runDir, 'narration');
      const musicDir = join(runDir, 'music');

      const narrationPromise = this.narrationService.generateAll({
        story,
        outputDir: narrationDir,
        concurrency: this.config.pipeline.sceneConcurrency,
        events,
      });

      const musicPromise = this.config.music.enabled
        ? this.musicService
            .generate({ story, outputDir: musicDir })
            .catch((err) => {
              logger.warn('Music generation failed — continuing without it', {
                error: err instanceof Error ? err.message : String(err),
              });
              return undefined;
            })
        : Promise.resolve(undefined);

      const [narrationResult, musicResult] = await Promise.all([
        narrationPromise,
        musicPromise,
      ]);
      narrations = narrationResult;
      events?.publish({ type: 'stage.done', stage: 'narration' });

      // Step 5: Compose final video (ffmpeg) — skip if already on disk.
      logger.info('🎞️  Step 5/7: Composing final video');
      events?.publish({ type: 'stage.start', stage: 'compose' });
      const composeDir = join(runDir, 'compose');
      const finalPath = join(runDir, 'final.mp4');
      if (await isCachedFile(finalPath, 100_000)) {
        const s = await stat(finalPath);
        logger.info('Final composed video already present — skipping compose', {
          finalPath,
          bytes: s.size,
        });
        videoPath = finalPath;
      } else {
        const composeResult = await this.compositor.compose({
          story,
          clips,
          narrations,
          outputDir: composeDir,
          outputPath: finalPath,
          music: musicResult
            ? {
                path: musicResult.path,
                volumeDb: this.config.music.volumeDb,
                fadeInSeconds: this.config.music.fadeInSeconds,
                fadeOutSeconds: this.config.music.fadeOutSeconds,
              }
            : undefined,
        });
        videoPath = composeResult.path;
      }
      events?.publish({ type: 'compose.done', path: videoPath });
      events?.publish({ type: 'stage.done', stage: 'compose' });

      // Step 6: Validate composed output
      logger.info('✔️  Step 6/7: Validating composed video');
      const validation = await this.videoValidator.validateVideo(videoPath);
      videoSizeBytes = validation.metadata.sizeBytes;
      if (!validation.valid) {
        throw new Error(
          `Composed video failed validation: ${validation.errors.join(', ')}`
        );
      }

      // Step 7: Upload to TikTok
      logger.info('📤 Step 7/7: Uploading to TikTok');
      events?.publish({ type: 'stage.start', stage: 'upload' });
      const caption = this.captionGenerator.generateCaption(brand, story);
      await this.rateLimiters.tiktok.consume('video-upload');
      const tiktokResult = await this.tiktokClient.uploadVideo({
        filePath: videoPath,
        caption,
        visibility: this.config.tiktok.visibility,
      });
      events?.publish({
        type: 'upload.done',
        postId: tiktokResult.postId,
        shareUrl: tiktokResult.shareUrl,
      });
      events?.publish({ type: 'stage.done', stage: 'upload' });

      const duration = Date.now() - startTime;

      await this.statisticsTracker.recordRun({
        timestamp: new Date().toISOString(),
        success: true,
        archetype: story.archetypeId,
        storyGenerationMethod: this.config.openrouter.llmModel,
        duration,
        tiktokPostId: tiktokResult.postId,
        tiktokShareUrl: tiktokResult.shareUrl,
        videoSize: videoSizeBytes,
        sceneCount: story.scenes.length,
      });

      logger.info('✅ Run completed successfully', {
        durationMs: duration,
        tiktokPostId: tiktokResult.postId,
      });
      events?.publish({
        type: 'run.success',
        tiktokPostId: tiktokResult.postId,
        tiktokShareUrl: tiktokResult.shareUrl,
      });

      return {
        success: true,
        story,
        runDir,
        keyframes,
        clips,
        narrations,
        videoPath,
        videoSizeBytes,
        tiktokPostId: tiktokResult.postId,
        tiktokShareUrl: tiktokResult.shareUrl,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('❌ StoryAgent run failed', {
        error: errorMessage,
        durationMs: duration,
      });

      if (story) {
        await this.statisticsTracker.recordRun({
          timestamp: new Date().toISOString(),
          success: false,
          archetype: story.archetypeId,
          storyGenerationMethod: this.config.openrouter.llmModel,
          duration,
          error: errorMessage,
          sceneCount: story.scenes.length,
        });
      }

      logger.error(`Run failed. Resume with: pnpm start --resume ${runDir}`);
      events?.publish({ type: 'run.failure', error: errorMessage });

      return {
        success: false,
        story:
          story ??
          ({
            brandId: brand?.id ?? 'unknown',
            archetypeId: 'unknown',
            title: '(no story generated)',
            narrative: '',
            totalDurationSeconds: 0,
            scenes: [],
            overallMood: 'heartwarming',
            musicStyle: '',
          } as Story),
        runDir,
        keyframes,
        clips,
        narrations,
        videoPath,
        videoSizeBytes,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Find the most recently started run directory under videoDownloadPath,
   * if any. Used by `--resume latest`.
   */
  public async findLatestRunDir(): Promise<string | undefined> {
    const root = this.config.pipeline.videoDownloadPath;
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      return undefined;
    }
    const runDirs: Array<{ path: string; mtime: number }> = [];
    for (const name of entries) {
      if (!name.startsWith('run-')) continue;
      const path = join(root, name);
      try {
        const s = await stat(path);
        if (s.isDirectory()) runDirs.push({ path, mtime: s.mtimeMs });
      } catch {
        // skip
      }
    }
    if (runDirs.length === 0) return undefined;
    runDirs.sort((a, b) => b.mtime - a.mtime);
    return runDirs[0].path;
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
   * Regenerate a single scene (keyframe → clip → narration) from a saved story.
   * Useful as a dev loop — fix one bad scene without re-running the full
   * pipeline or paying for re-generations of the other scenes.
   */
  public async regenerateScene(opts: {
    story: Story;
    sceneIndex: number;
    outputDir: string;
  }): Promise<{
    keyframe: SceneKeyframeResult;
    clip: SceneClipResult;
    narration: SceneNarrationResult;
  }> {
    if (opts.sceneIndex < 0 || opts.sceneIndex >= opts.story.scenes.length) {
      throw new Error(
        `sceneIndex ${opts.sceneIndex} out of range (story has ${opts.story.scenes.length} scenes)`
      );
    }
    const brand = this.brandRegistry.get(opts.story.brandId);
    if (!brand) {
      throw new Error(
        `Cannot regenerate scene: brand "${opts.story.brandId}" not registered.`
      );
    }
    const scene = opts.story.scenes[opts.sceneIndex];

    logger.info('Regenerating single scene', {
      brandId: brand.id,
      sceneIndex: opts.sceneIndex,
      outputDir: opts.outputDir,
    });

    await this.rateLimiters.openrouterImage.consume('keyframe');
    const keyframe = await this.imageService.generateKeyframe({
      brand,
      story: opts.story,
      scene,
      sceneIndex: opts.sceneIndex,
      outputDir: join(opts.outputDir, 'keyframes'),
    });

    await this.rateLimiters.openrouterVideo.consume('clip');
    const clip = await this.videoClipService.generateClip({
      brand,
      scene,
      sceneIndex: opts.sceneIndex,
      keyframePath: keyframe.path,
      outputDir: join(opts.outputDir, 'clips'),
    });

    await this.rateLimiters.tts.consume('narration');
    const [narration] = await this.narrationService.generateAll({
      story: { ...opts.story, scenes: [scene] },
      outputDir: join(opts.outputDir, 'narration'),
      concurrency: 1,
    });

    return {
      keyframe,
      clip,
      narration: { ...narration, sceneIndex: opts.sceneIndex },
    };
  }

  /**
   * Dry run — exercises only the LLM stage (story + caption).
   * Useful for validating Phase 1 in isolation before later phases land.
   */
  public async dryRun(opts: {
    brandId?: string;
    archetypeId?: string;
    seed?: string;
  } = {}): Promise<{ story: Story; caption: string }> {
    logger.info('🧪 Running dry run (LLM only)');
    const brandId = opts.brandId ?? this.config.pipeline.defaultBrandId;
    const brand = this.brandRegistry.get(brandId);
    if (!brand) {
      throw new Error(
        `Unknown brand "${brandId}". Available: ${this.brandRegistry
          .list()
          .map((b) => b.id)
          .join(', ') || '(none)'}`
      );
    }
    const story = await this.storyService.generateStory({
      brand,
      archetypeId: opts.archetypeId,
      seed: opts.seed,
    });
    const caption = this.captionGenerator.generateCaption(brand, story);

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

  public shutdown(): void {
    this.rateLimiters.stopAll();
    logger.info('StoryAgent shutdown');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
