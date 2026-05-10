import { OpenRouterConfig } from '../utils/config';
import { logger } from '../utils/logger';

/**
 * Thin client over OpenRouter's image generation route. Image-capable models
 * (e.g. openai/gpt-5.4-image-2) accept a chat-completions request with
 * `modalities: ["image", "text"]` and return base64-encoded images inline
 * in the assistant message.
 *
 * Reference image inputs are passed as `image_url` content parts in the
 * user message — same shape as vision input.
 */
export interface ImageGenerateOptions {
  model: string;
  prompt: string;
  /** Optional reference images (PNG/JPEG buffers) for visual continuity. */
  referenceImages?: Buffer[];
  /** Output aspect ratio hint baked into the prompt — model may or may not honor. */
  aspectRatio?: '9:16' | '16:9' | '1:1';
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ChatContentPart[];
  images?: Array<{ image_url: { url: string } }>;
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface ChatResponse {
  choices: Array<{ message: ChatMessage }>;
}

export interface OpenRouterImageClientOptions {
  maxRetries?: number;
}

export class OpenRouterImageClient {
  private maxRetries: number;

  constructor(private cfg: OpenRouterConfig, opts: OpenRouterImageClientOptions = {}) {
    this.maxRetries = opts.maxRetries ?? 3;
  }

  public async generate(opts: ImageGenerateOptions): Promise<Buffer> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.generateOnce(opts);
      } catch (err) {
        lastError = err;
        const transient = isTransient(err);
        logger.warn('Image generation attempt failed', {
          attempt,
          willRetry: attempt < this.maxRetries && transient,
          transient,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!transient || attempt >= this.maxRetries) break;
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Image generation failed');
  }

  private async generateOnce(opts: ImageGenerateOptions): Promise<Buffer> {
    const userContent: ChatContentPart[] = [
      { type: 'text', text: opts.prompt },
    ];
    for (const ref of opts.referenceImages ?? []) {
      userContent.push({
        type: 'image_url',
        image_url: { url: bufferToDataUrl(ref) },
      });
    }

    logger.info('Generating image', {
      model: opts.model,
      promptChars: opts.prompt.length,
      refCount: opts.referenceImages?.length ?? 0,
    });

    const response = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.cfg.appUrl,
        'X-Title': this.cfg.appName,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: 'user', content: userContent }],
        modalities: ['image', 'text'],
      }),
    });

    const rawText = await response.text();

    if (!response.ok) {
      throw new ImageGenError(
        `OpenRouter image generation failed: ${response.status} ${response.statusText} — ${rawText.slice(0, 500)}`,
        response.status >= 500 || response.status === 429
      );
    }

    if (!rawText.trim()) {
      throw new ImageGenError(
        'OpenRouter returned an empty response body for image generation',
        true
      );
    }

    let data: ChatResponse;
    try {
      data = JSON.parse(rawText) as ChatResponse;
    } catch (err) {
      throw new ImageGenError(
        `Invalid JSON from OpenRouter (${rawText.length} bytes): ${rawText.slice(0, 200)}`,
        true
      );
    }

    const dataUrl = extractImageDataUrl(data);
    if (!dataUrl) {
      throw new ImageGenError(
        `No image found in OpenRouter response: ${rawText.slice(0, 500)}`,
        true
      );
    }
    return dataUrlToBuffer(dataUrl);
  }
}

class ImageGenError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
    this.name = 'ImageGenError';
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof ImageGenError) return err.retryable;
  // Native fetch network errors / aborts — treat as transient.
  if (err instanceof TypeError) return true;
  if (err instanceof Error && /fetch failed|ECONN|ETIMEDOUT|socket hang up/i.test(err.message)) {
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bufferToDataUrl(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
  return Buffer.from(base64, 'base64');
}

/**
 * OpenRouter's image responses can land in either `message.images[].image_url.url`
 * or as an `image_url` part inside `message.content` (depending on the
 * underlying provider). Try both.
 */
function extractImageDataUrl(data: ChatResponse): string | undefined {
  const message = data.choices?.[0]?.message;
  if (!message) return undefined;

  if (message.images && message.images.length > 0) {
    return message.images[0].image_url?.url;
  }
  if (Array.isArray(message.content)) {
    const part = message.content.find(
      (p): p is { type: 'image_url'; image_url: { url: string } } =>
        p.type === 'image_url'
    );
    return part?.image_url.url;
  }
  return undefined;
}
