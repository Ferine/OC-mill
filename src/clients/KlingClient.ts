import fetch from 'node-fetch';
import { writeFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { logger } from '../utils/logger';

/**
 * Kling API request/response type definitions
 *
 * PLACEHOLDER API STRUCTURE - Update based on actual Kling API documentation
 *
 * Expected endpoints:
 * POST https://api.kling.ai/v1/videos - Create video job
 * GET https://api.kling.ai/v1/videos/:jobId - Check video status
 */

export interface KlingVideoRequest {
  prompt: string;
  aspectRatio: '9:16' | '16:9' | '1:1';
  durationSeconds: number;
  quality?: 'standard' | 'high' | 'ultra';
  negativePrompt?: string;
}

export interface KlingVideoResponse {
  jobId: string;
  status: 'queued' | 'processing';
  message?: string;
  estimatedTimeSeconds?: number;
}

export interface KlingVideoStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number; // 0-100
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface KlingClientConfig {
  apiKey: string;
  baseUrl: string;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
}

/**
 * KlingClient handles all interactions with Kling AI text-to-video API
 */
export class KlingClient {
  private apiKey: string;
  private baseUrl: string;
  private maxPollAttempts: number;
  private pollIntervalMs: number;

  constructor(config: KlingClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.maxPollAttempts = config.maxPollAttempts || 60;
    this.pollIntervalMs = config.pollIntervalMs || 10000;

    logger.info('KlingClient initialized', {
      baseUrl: this.baseUrl,
      maxPollAttempts: this.maxPollAttempts,
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  /**
   * Create a new video generation job
   *
   * API Endpoint: POST /v1/videos
   * Request body: { prompt, aspectRatio, durationSeconds, quality?, negativePrompt? }
   * Response: { jobId, status, estimatedTimeSeconds? }
   */
  public async createVideo(
    prompt: string,
    options: {
      aspectRatio: '9:16' | '16:9' | '1:1';
      durationSeconds: number;
      quality?: 'standard' | 'high' | 'ultra';
    }
  ): Promise<string> {
    logger.info('Creating video generation job', {
      aspectRatio: options.aspectRatio,
      duration: options.durationSeconds,
      promptLength: prompt.length,
    });

    const requestBody: KlingVideoRequest = {
      prompt,
      aspectRatio: options.aspectRatio,
      durationSeconds: options.durationSeconds,
      quality: options.quality || 'high',
    };

    try {
      const response = await fetch(`${this.baseUrl}/v1/videos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Kling API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as KlingVideoResponse;

      logger.info('Video job created successfully', {
        jobId: data.jobId,
        status: data.status,
        estimatedTime: data.estimatedTimeSeconds,
      });

      return data.jobId;
    } catch (error) {
      logger.error('Failed to create video job', { error });
      throw new Error(`Failed to create video: ${error}`);
    }
  }

  /**
   * Get the status of a video generation job
   *
   * API Endpoint: GET /v1/videos/:jobId
   * Response: { jobId, status, progress?, videoUrl?, errorMessage? }
   */
  public async getVideoStatus(jobId: string): Promise<KlingVideoStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/videos/${jobId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Kling API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const status = (await response.json()) as KlingVideoStatus;

      logger.debug('Video status retrieved', {
        jobId,
        status: status.status,
        progress: status.progress,
      });

      return status;
    } catch (error) {
      logger.error('Failed to get video status', { jobId, error });
      throw new Error(`Failed to get video status: ${error}`);
    }
  }

  /**
   * Poll for video completion with exponential backoff
   * Returns the video URL when ready
   */
  public async waitForCompletion(jobId: string): Promise<string> {
    logger.info('Starting to poll for video completion', {
      jobId,
      maxAttempts: this.maxPollAttempts,
    });

    let attempt = 0;
    let currentInterval = this.pollIntervalMs;

    while (attempt < this.maxPollAttempts) {
      attempt++;

      const status = await this.getVideoStatus(jobId);

      logger.info('Polling video status', {
        jobId,
        attempt,
        status: status.status,
        progress: status.progress,
      });

      if (status.status === 'completed' && status.videoUrl) {
        logger.info('Video generation completed', {
          jobId,
          videoUrl: status.videoUrl,
          attempts: attempt,
        });
        return status.videoUrl;
      }

      if (status.status === 'failed') {
        const errorMsg = status.errorMessage || 'Unknown error';
        logger.error('Video generation failed', {
          jobId,
          error: errorMsg,
        });
        throw new Error(`Video generation failed: ${errorMsg}`);
      }

      // Still processing, wait before next poll
      logger.debug('Video still processing, waiting...', {
        waitMs: currentInterval,
        attempt,
      });

      await this.sleep(currentInterval);

      // Exponential backoff with cap
      currentInterval = Math.min(currentInterval * 1.2, 30000);
    }

    throw new Error(
      `Video generation timed out after ${this.maxPollAttempts} attempts`
    );
  }

  /**
   * Download video from URL to local file
   */
  public async downloadVideo(
    videoUrl: string,
    targetPath: string
  ): Promise<void> {
    logger.info('Downloading video', { videoUrl, targetPath });

    try {
      // Ensure directory exists
      await mkdir(dirname(targetPath), { recursive: true });

      const response = await fetch(videoUrl);

      if (!response.ok) {
        throw new Error(
          `Failed to download video: ${response.status} ${response.statusText}`
        );
      }

      const buffer = await response.buffer();
      await writeFile(targetPath, buffer);

      logger.info('Video downloaded successfully', {
        targetPath,
        sizeBytes: buffer.length,
      });
    } catch (error) {
      logger.error('Failed to download video', { videoUrl, targetPath, error });
      throw new Error(`Failed to download video: ${error}`);
    }
  }

  /**
   * Complete video generation flow: create, wait, download
   */
  public async generateAndDownload(
    prompt: string,
    options: {
      aspectRatio: '9:16' | '16:9' | '1:1';
      durationSeconds: number;
      quality?: 'standard' | 'high' | 'ultra';
    },
    downloadPath: string
  ): Promise<{ jobId: string; videoPath: string }> {
    logger.info('Starting complete video generation flow');

    // Step 1: Create video job
    const jobId = await this.createVideo(prompt, options);

    // Step 2: Wait for completion
    const videoUrl = await this.waitForCompletion(jobId);

    // Step 3: Download video
    await this.downloadVideo(videoUrl, downloadPath);

    logger.info('Video generation flow completed', { jobId, downloadPath });

    return { jobId, videoPath: downloadPath };
  }

  /**
   * Utility: Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cancel a video generation job (if API supports it)
   *
   * API Endpoint: DELETE /v1/videos/:jobId
   */
  public async cancelVideo(jobId: string): Promise<void> {
    logger.info('Cancelling video job', { jobId });

    try {
      const response = await fetch(`${this.baseUrl}/v1/videos/${jobId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn('Failed to cancel video job', {
          jobId,
          status: response.status,
          error: errorText,
        });
      } else {
        logger.info('Video job cancelled successfully', { jobId });
      }
    } catch (error) {
      logger.error('Error cancelling video job', { jobId, error });
    }
  }
}
