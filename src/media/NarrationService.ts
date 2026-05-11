import { join } from 'path';
import { mkdir, stat } from 'fs/promises';
import { OpenRouterTTSClient } from '../clients/OpenRouterTTSClient';
import { runWithConcurrency } from '../pipeline/concurrency';
import { PipelineEventBus } from '../pipeline/events';
import { Story, Mood } from '../story/types';
import { TTSConfig } from '../utils/config';
import { atomicWrite, isCachedFile } from '../utils/io';
import { logger } from '../utils/logger';

export interface SceneNarrationResult {
  sceneIndex: number;
  path: string;
  bytes: number;
  fromCache?: boolean;
}

/**
 * Gemini 3.1 Flash TTS emits raw 24 kHz / 16-bit mono PCM. ffmpeg can read
 * raw PCM but only when told the layout up front — wrapping the bytes in a
 * WAV header at save time makes the file self-describing and lets the
 * compositor (and any audio player) consume it without extra flags.
 */
const PCM_SAMPLE_RATE = 24000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;

export class NarrationService {
  private format: TTSConfig['format'];

  constructor(
    private client: OpenRouterTTSClient,
    private voicesByMood: Record<string, string>,
    format: TTSConfig['format'] = 'pcm'
  ) {
    this.format = format;
  }

  public async generateAll(opts: {
    story: Story;
    outputDir: string;
    concurrency: number;
    events?: PipelineEventBus;
  }): Promise<SceneNarrationResult[]> {
    logger.info('Generating narration for all scenes', {
      sceneCount: opts.story.scenes.length,
      outputDir: opts.outputDir,
      format: this.format,
    });

    await mkdir(opts.outputDir, { recursive: true });
    const ext = this.fileExtension();

    const tasks = opts.story.scenes.map((scene, sceneIndex) => async () => {
      const path = join(
        opts.outputDir,
        `scene-${String(sceneIndex).padStart(2, '0')}-narration.${ext}`
      );

      if (await isCachedFile(path, 1024)) {
        const s = await stat(path);
        logger.info('Narration cache hit (resume)', {
          sceneIndex,
          path,
          bytes: s.size,
        });
        opts.events?.publish({
          type: 'scene.narration.ready',
          sceneIndex,
          path,
          bytes: s.size,
          fromCache: true,
        });
        return { sceneIndex, path, bytes: s.size, fromCache: true };
      }

      opts.events?.publish({ type: 'scene.narration.start', sceneIndex });

      const voice = this.pickVoice(scene.mood, opts.story.overallMood);
      const raw = await this.client.synthesize({
        voice,
        text: scene.subtitleText,
        format: this.format,
      });
      const audio = this.format === 'pcm' ? wrapPcmAsWav(raw) : raw;
      await atomicWrite(path, audio);
      logger.info('Narration generated', {
        sceneIndex,
        voice,
        path,
        bytes: audio.length,
      });
      opts.events?.publish({
        type: 'scene.narration.ready',
        sceneIndex,
        path,
        bytes: audio.length,
      });
      return { sceneIndex, path, bytes: audio.length };
    });

    return runWithConcurrency(tasks, opts.concurrency);
  }

  private fileExtension(): string {
    // PCM bytes get wrapped into a WAV container — save with .wav so the
    // file is self-describing on disk.
    if (this.format === 'pcm') return 'wav';
    return this.format;
  }

  private pickVoice(sceneMood: Mood, fallbackMood: Mood): string {
    return (
      this.voicesByMood[sceneMood] ||
      this.voicesByMood[fallbackMood] ||
      Object.values(this.voicesByMood)[0]
    );
  }
}

/**
 * Wrap raw 16-bit signed little-endian mono PCM (24 kHz, as emitted by
 * Gemini TTS) in a minimal 44-byte WAV header.
 */
function wrapPcmAsWav(pcm: Buffer): Buffer {
  const sampleRate = PCM_SAMPLE_RATE;
  const channels = PCM_CHANNELS;
  const bitsPerSample = PCM_BITS_PER_SAMPLE;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const riffChunkSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(riffChunkSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // AudioFormat = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}
