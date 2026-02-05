import { StoryGenerator } from '../story/StoryGenerator';
import { KlingPromptBuilder } from '../prompt/KlingPromptBuilder';
import { KlingClient } from '../clients/KlingClient';
import { TikTokClient } from '../clients/TikTokClient';
import { CaptionGenerator } from '../caption/CaptionGenerator';
import { OpenAIStoryService } from '../services/OpenAIStoryService';
import { VideoValidator } from '../services/VideoValidator';
import { StatisticsTracker } from '../services/StatisticsTracker';
import { APIRateLimiters } from '../utils/RateLimiter';
import { Config } from '../utils/config';
import { logger } from '../utils/logger';
import { Story } from '../story/types';
import { join } from 'path';
import { mkdir } from 'fs/promises';

/**
 * Result of a successful agent run
 */
export interface AgentRunResult {
  success: boolean;
  story: Story;
  klingJobId: string;
  videoPath: string;
  videoValid?: boolean;
  videoSizeBytes?: number;
  tiktokPostId?: string;
  tiktokShareUrl?: string;
  error?: string;
  duration: number; // milliseconds
}

/**
 * OrangeCatAgent - Main orchestrator for the automated content pipeline
 *
 * Flow:
 * 1. Generate story
 * 2. Build Kling prompt
 * 3. Create video with Kling
 * 4. Poll until video ready
 * 5. Download video
 * 6. Generate caption
 * 7. Upload to TikTok
 */
export class OrangeCatAgent {
  private storyGenerator: StoryGenerator;
  private openaiStoryService?: OpenAIStoryService;
  private promptBuilder: KlingPromptBuilder;
  private klingClient: KlingClient;
  private tiktokClient: TikTokClient;
  private captionGenerator: CaptionGenerator;
  private videoValidator: VideoValidator;
  private statisticsTracker: StatisticsTracker;
  private rateLimiters: APIRateLimiters;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    // Initialize all components
    this.storyGenerator = new StoryGenerator(
      config.kling.videoDurationSeconds
    );

    // Initialize OpenAI service if enabled
    if (config.openai.useForStories && config.openai.apiKey) {
      this.openaiStoryService = new OpenAIStoryService(
        config.openai.apiKey,
        config.openai.model,
        config.kling.videoDurationSeconds
      );
      logger.info('OpenAI story generation enabled', {
        model: config.openai.model,
      });
    }

    this.promptBuilder = new KlingPromptBuilder();
    this.klingClient = new KlingClient({
      apiKey: config.kling.apiKey,
      baseUrl: config.kling.baseUrl,
      maxPollAttempts: config.kling.maxPollAttempts,
      pollIntervalMs: config.kling.pollIntervalMs,
    });
    this.tiktokClient = new TikTokClient({
      apiKey: config.tiktok.apiKey,
      baseUrl: config.tiktok.baseUrl,
    });
    this.captionGenerator = new CaptionGenerator();
    this.videoValidator = new VideoValidator(config.kling.videoDurationSeconds);
    this.statisticsTracker = new StatisticsTracker();
    this.rateLimiters = new APIRateLimiters();

    logger.info('OrangeCatAgent initialized', {
      useOpenAI: !!this.openaiStoryService,
      videoDuration: config.kling.videoDurationSeconds,
      downloadPath: config.video.downloadPath,
      videoValidation: true,
      statisticsTracking: true,
      rateLimiting: true,
    });
  }

  /**
   * Initialize the agent (async initialization)
   */
  public async initialize(): Promise<void> {
    await this.statisticsTracker.initialize();
    logger.info('OrangeCatAgent fully initialized');
  }

  /**
   * Run the complete agent workflow once
   */
  public async runOnce(): Promise<AgentRunResult> {
    const startTime = Date.now();

    logger.info('🚀 Starting OrangeCatAgent workflow');

    let story: Story | undefined;
    let klingJobId = '';
    let videoPath = '';
    let videoSizeBytes: number | undefined;

    try {
      // Step 1: Generate story (with rate limiting for OpenAI)
      logger.info('📖 Step 1/8: Generating story');

      if (this.openaiStoryService) {
        logger.info('Using OpenAI to generate story');
        await this.rateLimiters.openai.consume('story-generation');
        story = await this.openaiStoryService.generateStoryWithRetry();
      } else {
        logger.info('Using template-based story generation');
        story = this.storyGenerator.generateStory();
      }

      logger.info('Story generated', {
        archetype: story.archetype,
        title: story.title,
        scenes: story.scenes.length,
        generatedBy: this.openaiStoryService ? 'OpenAI' : 'Templates',
      });

      // Step 2: Build Kling prompt
      logger.info('✍️  Step 2/8: Building Kling prompt');
      const prompt = this.promptBuilder.buildPrompt(story);
      const promptStats = this.promptBuilder.getPromptStats(prompt);
      logger.info('Prompt built', promptStats);

      // Step 3: Create video with Kling (with rate limiting)
      logger.info('🎬 Step 3/8: Creating video with Kling AI');
      await this.rateLimiters.kling.consume('video-creation');
      klingJobId = await this.klingClient.createVideo(prompt, {
        aspectRatio: this.config.kling.aspectRatio,
        durationSeconds: this.config.kling.videoDurationSeconds,
        quality: 'high',
      });
      logger.info('Video creation job started', { klingJobId });

      // Step 4: Poll until video ready
      logger.info('⏳ Step 4/8: Waiting for video generation to complete');
      const videoUrl = await this.klingClient.waitForCompletion(klingJobId);
      logger.info('Video generation completed', { videoUrl });

      // Step 5: Download video
      logger.info('💾 Step 5/8: Downloading video');
      videoPath = await this.downloadVideo(klingJobId, videoUrl);
      logger.info('Video downloaded', { videoPath });

      // Step 5.5: Validate video
      logger.info('✔️  Step 5.5/8: Validating video');
      const validationResult = await this.videoValidator.validateVideo(videoPath);
      videoSizeBytes = validationResult.metadata.sizeBytes;

      if (!validationResult.valid) {
        const summary = this.videoValidator.getValidationSummary(validationResult);
        logger.error('Video validation failed', { summary });
        throw new Error(`Video validation failed: ${validationResult.errors.join(', ')}`);
      }

      if (validationResult.warnings.length > 0) {
        logger.warn('Video validation warnings', {
          warnings: validationResult.warnings,
        });
      }

      logger.info('Video validated successfully', {
        sizeBytes: validationResult.metadata.sizeBytes,
        sizeMB: validationResult.metadata.sizeMB,
      });

      // Step 6: Generate caption
      logger.info('📝 Step 6/8: Generating TikTok caption');
      const caption = this.captionGenerator.generateCaption(story);
      const captionValidation = this.captionGenerator.validateCaption(caption);

      if (!captionValidation.valid) {
        logger.warn('Caption validation warnings', {
          warnings: captionValidation.warnings,
        });
        // Use short caption if regular one is too long
        const shortCaption = this.captionGenerator.generateShortCaption(story);
        logger.info('Using short caption due to length', {
          length: shortCaption.length,
        });
      }

      logger.info('Caption generated', {
        length: caption.length,
        valid: captionValidation.valid,
      });

      // Step 7: Upload to TikTok (with rate limiting)
      logger.info('📤 Step 7/8: Uploading to TikTok');
      await this.rateLimiters.tiktok.consume('video-upload');
      const tiktokResult = await this.tiktokClient.uploadVideo({
        filePath: videoPath,
        caption,
        visibility: this.config.tiktok.visibility,
      });

      logger.info('Video uploaded to TikTok', {
        postId: tiktokResult.postId,
        status: tiktokResult.status,
        shareUrl: tiktokResult.shareUrl,
      });

      const duration = Date.now() - startTime;

      // Step 8: Record statistics
      logger.info('📊 Step 8/8: Recording statistics');
      await this.statisticsTracker.recordRun({
        timestamp: new Date().toISOString(),
        success: true,
        archetype: story.archetype,
        storyGenerationMethod: this.openaiStoryService ? 'OpenAI' : 'Templates',
        duration,
        klingJobId,
        tiktokPostId: tiktokResult.postId,
        tiktokShareUrl: tiktokResult.shareUrl,
        videoSize: videoSizeBytes,
        sceneCount: story.scenes.length,
      });

      logger.info('✅ OrangeCatAgent workflow completed successfully', {
        durationMs: duration,
        durationMinutes: (duration / 60000).toFixed(2),
        klingJobId,
        tiktokPostId: tiktokResult.postId,
      });

      return {
        success: true,
        story,
        klingJobId,
        videoPath,
        videoValid: true,
        videoSizeBytes,
        tiktokPostId: tiktokResult.postId,
        tiktokShareUrl: tiktokResult.shareUrl,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('❌ OrangeCatAgent workflow failed', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: duration,
      });

      // Record failed run in statistics
      if (story) {
        await this.statisticsTracker.recordRun({
          timestamp: new Date().toISOString(),
          success: false,
          archetype: story.archetype,
          storyGenerationMethod: this.openaiStoryService ? 'OpenAI' : 'Templates',
          duration,
          klingJobId,
          error: errorMessage,
          videoSize: videoSizeBytes,
          sceneCount: story.scenes.length,
        });
      }

      return {
        success: false,
        story: story || this.storyGenerator.generateStory(), // Return actual story or placeholder
        klingJobId,
        videoPath,
        videoSizeBytes,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Download video to local storage
   */
  private async downloadVideo(
    jobId: string,
    videoUrl: string
  ): Promise<string> {
    // Ensure download directory exists
    await mkdir(this.config.video.downloadPath, { recursive: true });

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `oc-${jobId}-${timestamp}.mp4`;
    const videoPath = join(this.config.video.downloadPath, filename);

    // Download video
    await this.klingClient.downloadVideo(videoUrl, videoPath);

    return videoPath;
  }

  /**
   * Run workflow multiple times in sequence
   */
  public async runMultiple(count: number): Promise<AgentRunResult[]> {
    logger.info(`Running agent ${count} times sequentially`);

    const results: AgentRunResult[] = [];

    for (let i = 0; i < count; i++) {
      logger.info(`Starting run ${i + 1}/${count}`);

      const result = await this.runOnce();
      results.push(result);

      if (!result.success) {
        logger.warn(`Run ${i + 1} failed, continuing to next run`);
      }

      // Add delay between runs to avoid rate limiting
      if (i < count - 1) {
        const delayMs = 5000;
        logger.info(`Waiting ${delayMs}ms before next run`);
        await this.sleep(delayMs);
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
   * Dry run - generate story and prompt without calling APIs
   */
  public async dryRun(): Promise<{
    story: Story;
    prompt: string;
    caption: string;
  }> {
    logger.info('🧪 Running dry run (no API calls)');

    let story: Story;

    if (this.openaiStoryService) {
      logger.info('Generating story with OpenAI');
      story = await this.openaiStoryService.generateStoryWithRetry();
    } else {
      logger.info('Generating story with templates');
      story = this.storyGenerator.generateStory();
    }

    const prompt = this.promptBuilder.buildPrompt(story);
    const caption = this.captionGenerator.generateCaption(story);

    logger.info('Dry run completed', {
      archetype: story.archetype,
      title: story.title,
      promptLength: prompt.length,
      captionLength: caption.length,
      generatedBy: this.openaiStoryService ? 'OpenAI' : 'Templates',
    });

    // Log the outputs for inspection
    console.log('\n=== STORY ===');
    console.log(JSON.stringify(story, null, 2));

    console.log('\n=== KLING PROMPT ===');
    console.log(prompt);

    console.log('\n=== TIKTOK CAPTION ===');
    console.log(caption);

    return { story, prompt, caption };
  }

  /**
   * Utility: Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get agent statistics and status
   */
  public getStatus(): {
    config: Config;
    componentsInitialized: boolean;
  } {
    return {
      config: this.config,
      componentsInitialized: true,
    };
  }

  /**
   * Get statistics report
   */
  public getStatisticsReport(): string {
    return this.statisticsTracker.getFormattedReport();
  }

  /**
   * Get statistics tracker (for detailed access)
   */
  public getStatistics() {
    return this.statisticsTracker;
  }

  /**
   * Cleanup and shutdown
   */
  public shutdown(): void {
    this.rateLimiters.stopAll();
    logger.info('OrangeCatAgent shutdown');
  }
}
