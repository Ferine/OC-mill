import { join } from 'path';
import { mkdir, stat } from 'fs/promises';
import { OpenRouterMusicClient } from '../clients/OpenRouterMusicClient';
import { Story } from '../story/types';
import { atomicWrite, isCachedFile } from '../utils/io';
import { logger } from '../utils/logger';

export interface MusicResult {
  path: string;
  bytes: number;
  fromCache?: boolean;
}

/**
 * Generates the per-run soundtrack via OpenRouter Lyria. One call per run,
 * cached on disk so resume skips it. Failure is non-fatal — callers should
 * catch and proceed without music.
 *
 * The prompt is built from the story's `musicStyle` field (filled by the
 * LLM) plus the overall mood. Lyria 3 Pro returns a full-length composition
 * regardless; the compositor trims and fades it to the final video length.
 */
export class MusicService {
  constructor(
    private client: OpenRouterMusicClient,
    private model: string
  ) {}

  public async generate(opts: {
    story: Story;
    outputDir: string;
  }): Promise<MusicResult> {
    await mkdir(opts.outputDir, { recursive: true });
    const outputPath = join(opts.outputDir, 'soundtrack.mp3');

    if (await isCachedFile(outputPath, 1024)) {
      const s = await stat(outputPath);
      logger.info('Music cache hit (resume)', {
        path: outputPath,
        bytes: s.size,
      });
      return { path: outputPath, bytes: s.size, fromCache: true };
    }

    const prompt = buildPrompt(opts.story);
    logger.info('Requesting music generation', {
      model: this.model,
      promptChars: prompt.length,
    });

    const result = await this.client.generate({
      model: this.model,
      prompt,
    });

    await atomicWrite(outputPath, result.audio);
    logger.info('Music generated', {
      path: outputPath,
      bytes: result.audio.length,
      format: result.format,
    });
    return { path: outputPath, bytes: result.audio.length };
  }
}

function buildPrompt(story: Story): string {
  const style = story.musicStyle?.trim();
  const mood = story.overallMood;
  const base = style && style.length > 0 ? style : `${mood} instrumental score`;

  return [
    base,
    `Mood: ${mood}.`,
    `Style: short-form vertical video soundtrack with no vocals — purely instrumental.`,
    `Production: balanced mix, gentle dynamics, suitable as background under a spoken narration.`,
  ].join(' ');
}
