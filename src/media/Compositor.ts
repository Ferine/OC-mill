import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
import { Story, Scene } from '../story/types';
import { SceneClipResult } from './VideoClipService';
import { SceneNarrationResult } from './NarrationService';
import { logger } from '../utils/logger';

export interface ComposeOptions {
  story: Story;
  clips: SceneClipResult[];
  narrations: SceneNarrationResult[];
  outputDir: string;
  outputPath: string;
  /** Target output dimensions, default 1080x1920 (9:16). */
  width?: number;
  height?: number;
  /** Frame rate, default 30. */
  fps?: number;
}

export interface ComposeResult {
  path: string;
  durationSeconds: number;
}

/**
 * Compositor — produces the final TikTok-ready MP4 from per-scene clips,
 * narration audio, and burned-in ASS subtitles.
 *
 * Two passes:
 *   1. Per-scene: re-encode each clip to a fixed canvas (1080x1920, 30fps,
 *      H.264/AAC), mix narration audio onto it, and burn the scene's
 *      subtitle from a per-scene ASS file. Output is uniform across scenes
 *      so the concat demuxer is safe.
 *   2. Concat: stream-copy concat of the per-scene MP4s into the final file.
 */
export class Compositor {
  public async compose(opts: ComposeOptions): Promise<ComposeResult> {
    const width = opts.width ?? 1080;
    const height = opts.height ?? 1920;
    const fps = opts.fps ?? 30;

    await mkdir(opts.outputDir, { recursive: true });

    logger.info('Composing final video', {
      sceneCount: opts.story.scenes.length,
      outputPath: opts.outputPath,
      canvas: `${width}x${height}@${fps}`,
    });

    const sceneOutputs: string[] = [];
    for (let i = 0; i < opts.story.scenes.length; i++) {
      const scene = opts.story.scenes[i];
      const clip = opts.clips.find((c) => c.sceneIndex === i);
      const narration = opts.narrations.find((n) => n.sceneIndex === i);
      if (!clip || !narration) {
        throw new Error(`Missing clip or narration for scene ${i}`);
      }

      const assPath = join(opts.outputDir, `scene-${i}.ass`);
      await writeFile(assPath, buildAss(scene, width, height));

      const sceneOutput = join(opts.outputDir, `scene-${i}-composed.mp4`);
      await this.composeScene({
        clipPath: clip.path,
        narrationPath: narration.path,
        assPath,
        durationSeconds: scene.durationSeconds,
        outputPath: sceneOutput,
        width,
        height,
        fps,
      });
      sceneOutputs.push(sceneOutput);
    }

    const listPath = join(opts.outputDir, 'concat.txt');
    await writeFile(
      listPath,
      sceneOutputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
    );

    await this.concat(listPath, opts.outputPath);

    const totalDuration = opts.story.scenes.reduce(
      (sum, s) => sum + s.durationSeconds,
      0
    );

    logger.info('Final video composed', {
      outputPath: opts.outputPath,
      totalDurationSeconds: totalDuration,
    });

    return { path: opts.outputPath, durationSeconds: totalDuration };
  }

  private composeScene(opts: {
    clipPath: string;
    narrationPath: string;
    assPath: string;
    durationSeconds: number;
    outputPath: string;
    width: number;
    height: number;
    fps: number;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      // Escape ass path for the subtitles filter (colons and backslashes).
      const escapedAss = opts.assPath
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'");

      ffmpeg(opts.clipPath)
        .input(opts.narrationPath)
        .complexFilter([
          {
            filter: 'scale',
            options: `${opts.width}:${opts.height}:force_original_aspect_ratio=increase`,
            inputs: '0:v',
            outputs: 'scaled',
          },
          {
            filter: 'crop',
            options: `${opts.width}:${opts.height}`,
            inputs: 'scaled',
            outputs: 'cropped',
          },
          {
            filter: 'fps',
            options: `${opts.fps}`,
            inputs: 'cropped',
            outputs: 'fpsed',
          },
          {
            filter: 'subtitles',
            options: `filename=${escapedAss}`,
            inputs: 'fpsed',
            outputs: 'v',
          },
          {
            filter: 'apad',
            inputs: '1:a',
            outputs: 'a',
          },
        ])
        .outputOptions([
          '-map [v]',
          '-map [a]',
          '-c:v libx264',
          '-preset fast',
          '-pix_fmt yuv420p',
          '-c:a aac',
          '-b:a 192k',
          '-t', `${opts.durationSeconds}`,
          '-movflags +faststart',
        ])
        .save(opts.outputPath)
        .on('start', (cmd) => logger.debug('ffmpeg compose-scene start', { cmd }))
        .on('end', () => {
          logger.info('Scene composed', { outputPath: opts.outputPath });
          resolve();
        })
        .on('error', (err) => {
          logger.error('Scene composition failed', {
            outputPath: opts.outputPath,
            error: err.message,
          });
          reject(err);
        });
    });
  }

  private concat(listPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(listPath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-c copy', '-movflags +faststart'])
        .save(outputPath)
        .on('start', (cmd) => logger.debug('ffmpeg concat start', { cmd }))
        .on('end', () => {
          logger.info('Concat finished', { outputPath });
          resolve();
        })
        .on('error', (err) => {
          logger.error('Concat failed', { outputPath, error: err.message });
          reject(err);
        });
    });
  }
}

/**
 * Build a per-scene ASS subtitle file. One Dialogue event covering the
 * full scene duration, styled for TikTok meme look (white text, thick
 * black outline, bottom-positioned, large bold font).
 *
 * The subtitle text is the same string we send to TTS, but any inline
 * audio-direction tags (e.g. `[whispers]`, `[laughs]`, `[pause]` —
 * supported by Gemini TTS to steer delivery) are stripped before burn-in
 * so they never appear on screen.
 */
function buildAss(scene: Scene, width: number, height: number): string {
  const captionSource = stripAudioTags(scene.subtitleText).trim();
  // If nothing remains after stripping, render nothing rather than an
  // empty dialogue event (which ffmpeg's subtitles filter dislikes).
  if (!captionSource) {
    return emptyAss(width, height);
  }
  const text = escapeAssText(captionSource);
  const end = secondsToAssTime(scene.durationSeconds);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,80,&H00FFFFFF,&H00000000,&H64000000,1,1,5,2,2,80,80,200,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Default,,0,0,0,,${text}
`;
}

function secondsToAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  // ASS escaping: { } and \\ are special, newlines become \\N
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

/**
 * Remove inline TTS direction tags like [whispers], [laughs], [pause].
 * These are spoken-as-style cues some TTS providers (notably Gemini)
 * accept inline in the input text — they MUST NOT appear in burned
 * subtitles.
 */
function stripAudioTags(text: string): string {
  // Conservative: only strip bracketed lowercase/whitespace cues, which
  // cover the documented Gemini direction tags. Leaves bracketed proper
  // nouns or normal punctuation alone.
  return text.replace(/\[[a-z][a-z0-9 _'-]*\]/gi, '').replace(/\s{2,}/g, ' ');
}

function emptyAss(width: number, height: number): string {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,80,&H00FFFFFF,&H00000000,&H64000000,1,1,5,2,2,80,80,200,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}
