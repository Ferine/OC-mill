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

export class OpenRouterImageClient {
  constructor(private cfg: OpenRouterConfig) {}

  public async generate(opts: ImageGenerateOptions): Promise<Buffer> {
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

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenRouter image generation failed: ${response.status} ${response.statusText} — ${body.slice(0, 500)}`
      );
    }

    const data = (await response.json()) as ChatResponse;
    const dataUrl = extractImageDataUrl(data);
    if (!dataUrl) {
      throw new Error(
        `No image found in OpenRouter response: ${JSON.stringify(data).slice(0, 500)}`
      );
    }
    return dataUrlToBuffer(dataUrl);
  }
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
