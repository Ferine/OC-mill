import { OpenRouterConfig } from '../utils/config';
import { logger } from '../utils/logger';

export interface MusicGenerateOptions {
  model: string;
  prompt: string;
}

export interface MusicResult {
  /** Raw audio bytes — typically MP3 from Lyria 3. */
  audio: Buffer;
  /** Format hint pulled from the response ("mp3" / "wav"), or undefined. */
  format?: string;
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      audio?: { data?: string; format?: string };
    };
    message?: {
      audio?: { data?: string; format?: string };
    };
  }>;
}

/**
 * OpenRouter music generation client (Lyria family).
 *
 * Wire format: POST /chat/completions with `modalities: ["audio", "text"]`
 * and `stream: true` (audio output is streaming-only per OpenRouter — the
 * non-stream variant 400s with "Audio output requires stream: true"). The
 * SSE stream carries base64-encoded MP3 chunks in `choices[0].delta.audio.data`;
 * we accumulate them and decode once at the end.
 *
 * Lyria 3 Pro generates full-length 48 kHz stereo MP3 tracks (~$0.08/song).
 * We trim/fade to fit the target video duration downstream in the compositor.
 */
export class OpenRouterMusicClient {
  private maxRetries: number;

  constructor(
    private cfg: OpenRouterConfig,
    opts: { maxRetries?: number } = {}
  ) {
    this.maxRetries = opts.maxRetries ?? 3;
  }

  public async generate(opts: MusicGenerateOptions): Promise<MusicResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.generateOnce(opts);
      } catch (err) {
        lastError = err;
        const transient = isTransient(err);
        logger.warn('Music generation attempt failed', {
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
      : new Error('Music generation failed');
  }

  private async generateOnce(opts: MusicGenerateOptions): Promise<MusicResult> {
    logger.info('Generating music', {
      model: opts.model,
      promptChars: opts.prompt.length,
    });

    const response = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'HTTP-Referer': this.cfg.appUrl,
        'X-Title': this.cfg.appName,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: 'user', content: opts.prompt }],
        // Audio-only modality. Including "text" lets Lyria pick text output,
        // which it does by default — returning section markers like
        // "[[A0]]\n[[B1]]" (lyrics/structure tokens) instead of audio.
        modalities: ['audio'],
        audio: { format: 'mp3' },
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new MusicGenError(
        `OpenRouter music generation failed: ${response.status} ${response.statusText} — ${errText.slice(0, 500)}`,
        response.status >= 500 || response.status === 429
      );
    }

    if (!response.body) {
      throw new MusicGenError(
        'OpenRouter returned no response body for music stream',
        true
      );
    }

    const { audioChunks, format, samplePayload } = await consumeSse(response.body);

    if (audioChunks.length === 0) {
      throw new MusicGenError(
        `No audio chunks found in OpenRouter SSE stream. Sample chunk: ${samplePayload.slice(0, 800)}`,
        false
      );
    }

    // Each delta is a base64-encoded MP3 fragment; concatenating the
    // *decoded* bytes is the standard pattern (OpenAI matches this).
    const audio = Buffer.concat(
      audioChunks.map((c) => Buffer.from(c, 'base64'))
    );
    if (audio.length === 0) {
      throw new MusicGenError(
        'OpenRouter music chunks decoded to 0 bytes',
        true
      );
    }

    logger.info('Music generated', {
      bytes: audio.length,
      chunks: audioChunks.length,
      format,
    });
    return { audio, format };
  }
}

class MusicGenError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
    this.name = 'MusicGenError';
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof MusicGenError) return err.retryable;
  if (err instanceof TypeError) return true;
  if (
    err instanceof Error &&
    /fetch failed|ECONN|ETIMEDOUT|socket hang up/i.test(err.message)
  ) {
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read an SSE stream of chat-completions chunks and collect every audio
 * fragment we find. Tracks the first sample payload to surface in error
 * messages if no audio is found.
 */
async function consumeSse(
  stream: ReadableStream<Uint8Array>
): Promise<{ audioChunks: string[]; format?: string; samplePayload: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const audioChunks: string[] = [];
  let format: string | undefined;
  let samplePayload = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line. Handle CRLF and LF.
      let sepIndex: number;
      while (
        (sepIndex = indexOfDoubleNewline(buffer)) !== -1
      ) {
        const event = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex).replace(/^(\r?\n){2}/, '');
        const payload = parseSseEventPayload(event);
        if (!payload) continue;
        if (payload === '[DONE]') return { audioChunks, format, samplePayload };
        if (!samplePayload) samplePayload = payload;

        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(payload) as StreamChunk;
        } catch {
          continue;
        }
        const choice = chunk.choices?.[0];
        const audio = choice?.delta?.audio ?? choice?.message?.audio;
        if (audio?.data) audioChunks.push(audio.data);
        if (audio?.format && !format) format = audio.format;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { audioChunks, format, samplePayload };
}

function indexOfDoubleNewline(s: string): number {
  const a = s.indexOf('\n\n');
  const b = s.indexOf('\r\n\r\n');
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function parseSseEventPayload(event: string): string | undefined {
  // An event may contain multiple "data:" lines; concatenate them.
  const dataLines = event
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).replace(/^ /, ''));
  if (dataLines.length === 0) return undefined;
  return dataLines.join('\n');
}
