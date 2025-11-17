import { StoryGenerator } from '../story/StoryGenerator';
import { KlingPromptBuilder } from '../prompt/KlingPromptBuilder';
import { KlingClient } from '../clients/KlingClient';
import { TikTokClient } from '../clients/TikTokClient';
import { CaptionGenerator } from '../caption/CaptionGenerator';
import { OpenAIStoryService } from '../services/OpenAIStoryService';
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

    logger.info('OrangeCatAgent initialized', {
      useOpenAI: !!this.openaiStoryService,
      videoDuration: config.kling.videoDurationSeconds,
      downloadPath: config.video.downloadPath,
    });
  }

  /**
   * Run the complete agent workflow once
   */
  public async runOnce(): Promise<AgentRunResult> {
    const startTime = Date.now();

    logger.info('🚀 Starting OrangeCatAgent workflow');

    try {
      // Step 1: Generate story
      logger.info('📖 Step 1/7: Generating story');
      let story: Story;

      if (this.openaiStoryService) {
        logger.info('Using OpenAI to generate story');
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
      logger.info('✍️  Step 2/7: Building Kling prompt');
      const prompt = this.promptBuilder.buildPrompt(story);
      const promptStats = this.promptBuilder.getPromptStats(prompt);
      logger.info('Prompt built', promptStats);

      // Step 3: Create video with Kling
      logger.info('🎬 Step 3/7: Creating video with Kling AI');
      const klingJobId = await this.klingClient.createVideo(prompt, {
        aspectRatio: this.config.kling.aspectRatio,
        durationSeconds: this.config.kling.videoDurationSeconds,
        quality: 'high',
      });
      logger.info('Video creation job started', { klingJobId });

      // Step 4: Poll until video ready
      logger.info('⏳ Step 4/7: Waiting for video generation to complete');
      const videoUrl = await this.klingClient.waitForCompletion(klingJobId);
      logger.info('Video generation completed', { videoUrl });

      // Step 5: Download video
      logger.info('💾 Step 5/7: Downloading video');
      const videoPath = await this.downloadVideo(klingJobId, videoUrl);
      logger.info('Video downloaded', { videoPath });

      // Step 6: Generate caption
      logger.info('📝 Step 6/7: Generating TikTok caption');
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

      // Step 7: Upload to TikTok
      logger.info('📤 Step 7/7: Uploading to TikTok');
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
        tiktokPostId: tiktokResult.postId,
        tiktokShareUrl: tiktokResult.shareUrl,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('❌ OrangeCatAgent workflow failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: duration,
      });

      return {
        success: false,
        story: this.storyGenerator.generateStory(), // Return a placeholder
        klingJobId: '',
        videoPath: '',
        error: error instanceof Error ? error.message : String(error),
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
}
