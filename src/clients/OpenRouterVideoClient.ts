import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { OpenRouterConfig } from '../utils/config';
import { logger } from '../utils/logger';

export interface VideoJobOptions {
  model: string;
  prompt: string;
  aspectRatio?: '9:16' | '16:9' | '1:1' | 'adaptive';
  /** Clip duration in seconds. Pass -1 to let the model decide. */
  durationSeconds?: number;
  generateAudio?: boolean;
  /** First-frame image (image-to-video). Highest priority for continuity. */
  firstFrame?: Buffer;
  /** Last-frame image (image-to-video). Used by Seedance for first/last control. */
  lastFrame?: Buffer;
  /** Style/content reference images (different from frame_images). */
  referenceImages?: Buffer[];
  /** Provider-specific passthrough config. */
  provider?: Record<string, unknown>;
}

export type VideoJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | string;

export interface VideoJob {
  id: string;
  status: VideoJobStatus;
  videoUrl?: string;
  errorMessage?: string;
  progress?: number;
}

export interface OpenRouterVideoClientOptions {
  maxPollAttempts?: number;
  pollIntervalMs?: number;
}

/**
 * Client for OpenRouter's async video generation API.
 *
 * Endpoints:
 *   POST   /api/v1/videos          → submit a job, returns { id, status }
 *   GET    /api/v1/videos/:jobId   → status + content URLs when completed
 *
 * Reference: https://openrouter.ai/docs/guides/overview/multimodal/video-generation
 */
export class OpenRouterVideoClient {
  private maxPollAttempts: number;
  private pollIntervalMs: number;

  constructor(
    private cfg: OpenRouterConfig,
    opts: OpenRouterVideoClientOptions = {}
  ) {
    this.maxPollAttempts = opts.maxPollAttempts ?? 120;
    this.pollIntervalMs = opts.pollIntervalMs ?? 10000;
  }

  public async createJob(opts: VideoJobOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: opts.model,
      prompt: opts.prompt,
    };
    if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
    if (opts.durationSeconds !== undefined) body.duration = opts.durationSeconds;
    if (opts.generateAudio !== undefined) body.generate_audio = opts.generateAudio;

    const frameImages: Array<Record<string, unknown>> = [];
    if (opts.firstFrame) {
      frameImages.push({
        frame_type: 'first_frame',
        image_url: { url: bufferToDataUrl(opts.firstFrame) },
      });
    }
    if (opts.lastFrame) {
      frameImages.push({
        frame_type: 'last_frame',
        image_url: { url: bufferToDataUrl(opts.lastFrame) },
      });
    }
    if (frameImages.length > 0) body.frame_images = frameImages;

    if (opts.referenceImages && opts.referenceImages.length > 0) {
      body.input_references = opts.referenceImages.map((buf) => ({
        image_url: { url: bufferToDataUrl(buf) },
      }));
    }

    if (opts.provider) body.provider = opts.provider;

    logger.info('Creating video job', {
      model: opts.model,
      promptChars: opts.prompt.length,
      aspectRatio: opts.aspectRatio,
      durationSeconds: opts.durationSeconds,
      hasFirstFrame: !!opts.firstFrame,
      hasLastFrame: !!opts.lastFrame,
      refCount: opts.referenceImages?.length ?? 0,
    });

    const data = await this.requestJson<{ id?: string; job_id?: string }>(
      'POST',
      `${this.cfg.baseUrl}/videos`,
      body
    );
    const jobId = data.id ?? data.job_id;
    if (!jobId) {
      throw new Error(
        `No job id in OpenRouter response: ${JSON.stringify(data).slice(0, 500)}`
      );
    }
    logger.info('Video job created', { jobId });
    return jobId;
  }

  public async getJob(jobId: string): Promise<VideoJob> {
    const data = await this.requestJson<Record<string, unknown>>(
      'GET',
      `${this.cfg.baseUrl}/videos/${jobId}`
    );
    return normalizeJob(jobId, data);
  }

  /**
   * Issue an OpenRouter request and return parsed JSON, with defensive
   * parsing + retry on transient failures (5xx, 429, network, empty body,
   * invalid JSON). Non-transient errors (4xx other than 429) fail fast.
   */
  private async requestJson<T>(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    maxRetries = 3
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: this.headers(),
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const rawText = await response.text();

        if (!response.ok) {
          const retryable = response.status >= 500 || response.status === 429;
          throw new VideoApiError(
            `OpenRouter video API error: ${response.status} ${response.statusText} — ${rawText.slice(0, 500)}`,
            retryable
          );
        }
        if (!rawText.trim()) {
          throw new VideoApiError(
            'OpenRouter returned an empty response body',
            true
          );
        }
        try {
          return JSON.parse(rawText) as T;
        } catch {
          throw new VideoApiError(
            `Invalid JSON from OpenRouter (${rawText.length} bytes): ${rawText.slice(0, 200)}`,
            true
          );
        }
      } catch (err) {
        lastError = err;
        const transient =
          err instanceof VideoApiError
            ? err.retryable
            : err instanceof TypeError ||
              (err instanceof Error &&
                /fetch failed|ECONN|ETIMEDOUT|socket hang up/i.test(err.message));
        logger.warn('Video API request failed', {
          method,
          url,
          attempt,
          willRetry: attempt < maxRetries && transient,
          transient,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!transient || attempt >= maxRetries) break;
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Video API request failed');
  }

  public async pollUntilComplete(jobId: string): Promise<VideoJob> {
    let attempt = 0;
    let interval = this.pollIntervalMs;
    while (attempt < this.maxPollAttempts) {
      attempt++;
      const job = await this.getJob(jobId);
      logger.info('Video job poll', {
        jobId,
        attempt,
        status: job.status,
        progress: job.progress,
      });

      if (job.status === 'completed') {
        if (!job.videoUrl) {
          throw new Error(`Job ${jobId} completed but has no video URL`);
        }
        return job;
      }
      if (job.status === 'failed') {
        throw new Error(
          `Video job ${jobId} failed: ${job.errorMessage ?? 'unknown error'}`
        );
      }

      await sleep(interval);
      interval = Math.min(interval * 1.2, 30000);
    }
    throw new Error(
      `Video job ${jobId} did not complete after ${this.maxPollAttempts} polls`
    );
  }

  public async downloadVideo(videoUrl: string, targetPath: string): Promise<number> {
    logger.info('Downloading video clip', { videoUrl, targetPath });
    await mkdir(dirname(targetPath), { recursive: true });
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(
        `Video download failed: ${response.status} ${response.statusText}`
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(targetPath, buffer);
    logger.info('Video clip downloaded', { targetPath, bytes: buffer.length });
    return buffer.length;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': this.cfg.appUrl,
      'X-Title': this.cfg.appName,
    };
  }
}

class VideoApiError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
    this.name = 'VideoApiError';
  }
}

function bufferToDataUrl(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenRouter responses vary slightly between providers — completed jobs may
 * surface video URLs as `video_url`, `videos[0].url`, or `output[0].url`.
 * Try each shape.
 */
function normalizeJob(id: string, data: Record<string, unknown>): VideoJob {
  const status = (data.status as string) || 'queued';
  const errorMessage =
    (data.error_message as string) ||
    (data.error as string) ||
    ((data.error as { message?: string } | undefined)?.message as string | undefined);
  const progress = typeof data.progress === 'number' ? data.progress : undefined;

  let videoUrl: string | undefined;
  if (typeof data.video_url === 'string') {
    videoUrl = data.video_url;
  } else if (Array.isArray(data.videos) && data.videos.length > 0) {
    const first = data.videos[0] as { url?: string; video_url?: string };
    videoUrl = first.url ?? first.video_url;
  } else if (Array.isArray(data.output) && data.output.length > 0) {
    const first = data.output[0] as { url?: string; video_url?: string };
    videoUrl = first.url ?? first.video_url;
  }

  return { id, status, videoUrl, errorMessage, progress };
}
