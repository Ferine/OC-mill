import { OpenRouterConfig } from '../utils/config';
import { logger } from '../utils/logger';

export type TTSFormat = 'mp3' | 'wav' | 'pcm' | 'opus' | 'aac' | 'flac';

export interface TTSSynthesizeOptions {
  voice: string;
  text: string;
  format?: TTSFormat;
}

/**
 * OpenRouter's `/api/v1/audio/speech` endpoint is OpenAI-compatible — POST a
 * JSON body, receive raw audio bytes. Used here with `google/gemini-3.1-flash-tts-preview`
 * (voice names are Gemini-specific: Aoede, Puck, Charon, Kore, Fenrir, …)
 * but works with any TTS model on OpenRouter that accepts this endpoint.
 *
 * Transparent retry on transient failures (5xx, 429, network, empty body).
 */
export class OpenRouterTTSClient {
  private maxRetries: number;

  constructor(
    private cfg: OpenRouterConfig,
    private model: string,
    opts: { maxRetries?: number } = {}
  ) {
    this.maxRetries = opts.maxRetries ?? 3;
  }

  public async synthesize(opts: TTSSynthesizeOptions): Promise<Buffer> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.synthesizeOnce(opts);
      } catch (err) {
        lastError = err;
        const transient =
          err instanceof TTSError
            ? err.retryable
            : err instanceof TypeError ||
              (err instanceof Error &&
                /fetch failed|ECONN|ETIMEDOUT|socket hang up/i.test(err.message));
        logger.warn('TTS attempt failed', {
          attempt,
          willRetry: attempt < this.maxRetries && transient,
          transient,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!transient || attempt >= this.maxRetries) break;
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('TTS failed');
  }

  private async synthesizeOnce(opts: TTSSynthesizeOptions): Promise<Buffer> {
    logger.info('Synthesizing speech', {
      model: this.model,
      voice: opts.voice,
      textChars: opts.text.length,
    });

    const response = await fetch(`${this.cfg.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.cfg.appUrl,
        'X-Title': this.cfg.appName,
      },
      body: JSON.stringify({
        model: this.model,
        input: opts.text,
        voice: opts.voice,
        response_format: opts.format ?? 'mp3',
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const retryable = response.status >= 500 || response.status === 429;
      throw new TTSError(
        `TTS failed: ${response.status} ${response.statusText} — ${body.slice(0, 500)}`,
        retryable
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new TTSError('TTS returned an empty audio body', true);
    }
    logger.info('Speech synthesized', {
      voice: opts.voice,
      bytes: buffer.length,
    });
    return buffer;
  }
}

class TTSError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
    this.name = 'TTSError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
