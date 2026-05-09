import { ElevenLabsClient as SdkClient } from '@elevenlabs/elevenlabs-js';
import { ElevenLabsConfig } from '../utils/config';
import { logger } from '../utils/logger';

/**
 * Thin wrapper around the ElevenLabs SDK that produces an MP3 buffer for a
 * given voice + text. The SDK returns a ReadableStream — we drain it.
 */
export class ElevenLabsClient {
  private sdk: SdkClient;
  private model: string;

  constructor(cfg: ElevenLabsConfig) {
    this.sdk = new SdkClient({ apiKey: cfg.apiKey });
    this.model = cfg.model;
  }

  public async synthesize(opts: {
    voiceId: string;
    text: string;
  }): Promise<Buffer> {
    logger.info('Synthesizing speech', {
      voiceId: opts.voiceId,
      textChars: opts.text.length,
    });

    const stream = await this.sdk.textToSpeech.convert(opts.voiceId, {
      text: opts.text,
      modelId: this.model,
      outputFormat: 'mp3_44100_128',
    });

    const chunks: Buffer[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    const buffer = Buffer.concat(chunks);
    logger.info('Speech synthesized', {
      voiceId: opts.voiceId,
      bytes: buffer.length,
    });
    return buffer;
  }
}
