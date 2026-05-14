import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { Story } from '../story/types';
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
  /** Optional soundtrack mixed under the narration. */
  music?: MusicMixOptions;
}

export interface MusicMixOptions {
  path: string;
  /** Volume relative to narration in dB. Negative = quieter. Default -18. */
  volumeDb?: number;
  /** Fade-in length, seconds. Default 1.5. */
  fadeInSeconds?: number;
  /** Fade-out length, seconds. Default 2. */
  fadeOutSeconds?: number;
}

export interface ComposeResult {
  path: string;
  durationSeconds: number;
}

/**
 * Compositor — produces the final TikTok-ready MP4 from per-scene clips,
 * narration audio, and burned-in captions.
 *
 * Captioning uses ffmpeg's built-in `drawtext` filter rather than `subtitles`
 * (which requires libass — not present in every ffmpeg build, and the
 * cause of "Filter not found" errors). drawtext styling: large bold font,
 * white fill, thick black outline, bottom-positioned — same TikTok meme
 * look the ASS version produced, with no external library dependency.
 *
 * Two passes:
 *   1. Per-scene: re-encode each clip to a fixed canvas (1080x1920, 30fps,
 *      H.264/AAC), mix narration audio onto it, and burn the scene's
 *      caption via drawtext.
 *   2. Concat: stream-copy concat of the per-scene MP4s into final.mp4.
 */
export class Compositor {
  public async compose(opts: ComposeOptions): Promise<ComposeResult> {
    const width = opts.width ?? 1080;
    const height = opts.height ?? 1920;
    const fps = opts.fps ?? 30;

    await mkdir(opts.outputDir, { recursive: true });

    const fontPath = findSubtitleFont();
    if (!fontPath) {
      logger.warn(
        'No subtitle font found on disk — captions will be skipped. ' +
          'Set SUBTITLE_FONT_PATH to a .ttf/.ttc/.otf file to enable them.'
      );
    }

    logger.info('Composing final video', {
      sceneCount: opts.story.scenes.length,
      outputPath: opts.outputPath,
      canvas: `${width}x${height}@${fps}`,
      fontPath: fontPath ?? '(none)',
    });

    const sceneOutputs: string[] = [];
    for (let i = 0; i < opts.story.scenes.length; i++) {
      const scene = opts.story.scenes[i];
      const clip = opts.clips.find((c) => c.sceneIndex === i);
      const narration = opts.narrations.find((n) => n.sceneIndex === i);
      if (!clip || !narration) {
        throw new Error(`Missing clip or narration for scene ${i}`);
      }

      // drawtext reads the caption from a sidecar text file — sidesteps
      // ffmpeg's filter-graph escaping which is brittle for arbitrary user
      // text (apostrophes, colons, quotes).
      const captionText = stripAudioTags(scene.subtitleText).trim();
      const captionPath = join(opts.outputDir, `scene-${i}.txt`);
      await writeFile(captionPath, captionText);

      const sceneOutput = join(opts.outputDir, `scene-${i}-composed.mp4`);
      await this.composeScene({
        clipPath: clip.path,
        narrationPath: narration.path,
        captionText,
        captionPath,
        fontPath,
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

    const totalDuration = opts.story.scenes.reduce(
      (sum, s) => sum + s.durationSeconds,
      0
    );

    if (opts.music) {
      // Concat to an intermediate, then mix music in the final pass.
      // Video is stream-copied in both passes — only audio gets re-encoded.
      const intermediatePath = join(opts.outputDir, 'concat-no-music.mp4');
      await this.concat(listPath, intermediatePath);
      try {
        await this.mixMusic({
          videoPath: intermediatePath,
          musicPath: opts.music.path,
          volumeDb: opts.music.volumeDb ?? -18,
          fadeInSeconds: opts.music.fadeInSeconds ?? 1.5,
          fadeOutSeconds: opts.music.fadeOutSeconds ?? 2,
          totalDurationSeconds: totalDuration,
          outputPath: opts.outputPath,
        });
      } catch (err) {
        // Music mix is non-fatal — fall back to the music-less concat
        // rather than losing the run over a soundtrack issue.
        logger.warn('Music mix failed — using narration-only output', {
          error: err instanceof Error ? err.message : String(err),
        });
        await this.concat(listPath, opts.outputPath);
      }
    } else {
      await this.concat(listPath, opts.outputPath);
    }

    logger.info('Final video composed', {
      outputPath: opts.outputPath,
      totalDurationSeconds: totalDuration,
      hasMusic: !!opts.music,
    });

    return { path: opts.outputPath, durationSeconds: totalDuration };
  }

  /**
   * Mix a soundtrack under the narrated video. Re-encodes audio (the
   * narration was AAC; the mixed output stays AAC) but stream-copies video.
   * Music is trimmed to the video duration, attenuated by `volumeDb`, then
   * faded in at start and out at end. amix uses `duration=first` so the
   * narration track defines length — extra music tail is dropped.
   */
  private mixMusic(opts: {
    videoPath: string;
    musicPath: string;
    volumeDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
    totalDurationSeconds: number;
    outputPath: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const fadeOutStart = Math.max(
        0,
        opts.totalDurationSeconds - opts.fadeOutSeconds
      );

      const filterChain: ffmpeg.FilterSpecification[] = [
        // Narration audio passes through unchanged.
        { filter: 'anull', inputs: '0:a', outputs: 'narr' },
        // Music: trim, attenuate, fade.
        {
          filter: 'atrim',
          options: `duration=${opts.totalDurationSeconds}`,
          inputs: '1:a',
          outputs: 'mtrim',
        },
        {
          filter: 'volume',
          options: `volume=${opts.volumeDb}dB`,
          inputs: 'mtrim',
          outputs: 'mvol',
        },
        {
          filter: 'afade',
          options: `t=in:st=0:d=${opts.fadeInSeconds}`,
          inputs: 'mvol',
          outputs: 'mfin',
        },
        {
          filter: 'afade',
          options: `t=out:st=${fadeOutStart}:d=${opts.fadeOutSeconds}`,
          inputs: 'mfin',
          outputs: 'music',
        },
        // Mix. duration=first locks output length to narration; dropout
        // prevents auto-level changes when one stream is silent.
        {
          filter: 'amix',
          options: 'inputs=2:duration=first:dropout_transition=0:normalize=0',
          inputs: ['narr', 'music'],
          outputs: 'aout',
        },
      ];

      const stderrLines: string[] = [];

      ffmpeg(opts.videoPath)
        .input(opts.musicPath)
        .complexFilter(filterChain)
        .outputOptions([
          '-map', '0:v',
          '-map', '[aout]',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart',
        ])
        .save(opts.outputPath)
        .on('start', (cmd) => logger.info('ffmpeg music-mix start', { cmd }))
        .on('stderr', (line) => {
          stderrLines.push(line);
          if (stderrLines.length > 200) stderrLines.shift();
        })
        .on('end', () => {
          logger.info('Music mix finished', { outputPath: opts.outputPath });
          resolve();
        })
        .on('error', (err) => {
          const tail = stderrLines.slice(-30).join('\n');
          logger.error('Music mix failed', {
            outputPath: opts.outputPath,
            error: err.message,
            stderrTail: tail,
          });
          reject(new Error(`${err.message}\nffmpeg stderr:\n${tail}`));
        });
    });
  }

  private async composeScene(opts: {
    clipPath: string;
    narrationPath: string;
    captionText: string;
    captionPath: string;
    fontPath: string | undefined;
    durationSeconds: number;
    outputPath: string;
    width: number;
    height: number;
    fps: number;
  }): Promise<void> {
    const hasCaption = !!opts.captionText && !!opts.fontPath;
    try {
      await this.runComposeScene({ ...opts, withCaption: hasCaption });
    } catch (err) {
      if (!hasCaption) throw err;
      logger.warn(
        'Scene composition with captions failed — retrying without captions',
        {
          outputPath: opts.outputPath,
          error: err instanceof Error ? err.message : String(err),
        }
      );
      await this.runComposeScene({ ...opts, withCaption: false });
    }
  }

  private runComposeScene(opts: {
    clipPath: string;
    narrationPath: string;
    captionPath: string;
    fontPath: string | undefined;
    durationSeconds: number;
    outputPath: string;
    width: number;
    height: number;
    fps: number;
    withCaption: boolean;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use fully-named scale options. ffmpeg 8 is stricter than older
      // versions about mixing positional with named ('w:h:force_...=increase'
      // is rejected).
      const videoChain: ffmpeg.FilterSpecification[] = [
        {
          filter: 'scale',
          options: `w=${opts.width}:h=${opts.height}:force_original_aspect_ratio=increase`,
          inputs: '0:v',
          outputs: 'scaled',
        },
        {
          filter: 'crop',
          options: `w=${opts.width}:h=${opts.height}`,
          inputs: 'scaled',
          outputs: 'cropped',
        },
        {
          filter: 'fps',
          options: `fps=${opts.fps}`,
          inputs: 'cropped',
          outputs: 'fpsed',
        },
      ];

      if (opts.withCaption && opts.fontPath) {
        const fontfile = escapeFilterPath(opts.fontPath);
        const textfile = escapeFilterPath(opts.captionPath);
        videoChain.push({
          filter: 'drawtext',
          options: [
            `fontfile=${fontfile}`,
            `textfile=${textfile}`,
            `fontsize=${Math.round(opts.height / 24)}`, // ~80 at 1920
            `fontcolor=white`,
            `bordercolor=black`,
            `borderw=6`,
            `box=0`,
            `line_spacing=10`,
            `x=(w-text_w)/2`,
            `y=h-text_h-200`,
          ].join(':'),
          inputs: 'fpsed',
          outputs: 'v',
        });
      } else {
        // Pass-through label so the rest of the graph still references [v].
        videoChain.push({
          filter: 'null',
          inputs: 'fpsed',
          outputs: 'v',
        });
      }

      const audioChain: ffmpeg.FilterSpecification[] = [
        {
          filter: 'apad',
          inputs: '1:a',
          outputs: 'a',
        },
      ];

      const stderrLines: string[] = [];

      ffmpeg(opts.clipPath)
        .input(opts.narrationPath)
        .complexFilter([...videoChain, ...audioChain])
        .outputOptions([
          '-map', '[v]',
          '-map', '[a]',
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-t', `${opts.durationSeconds}`,
          '-movflags', '+faststart',
        ])
        .save(opts.outputPath)
        .on('start', (cmd) =>
          logger.info('ffmpeg compose-scene start', {
            cmd,
            withCaption: opts.withCaption,
          })
        )
        .on('stderr', (line) => {
          // Capture stderr for error diagnostics — keep only the last few
          // hundred lines so a long encode doesn't blow up memory.
          stderrLines.push(line);
          if (stderrLines.length > 200) stderrLines.shift();
        })
        .on('end', () => {
          logger.info('Scene composed', { outputPath: opts.outputPath });
          resolve();
        })
        .on('error', (err) => {
          // Show the actual ffmpeg stderr — the wrapped error message
          // alone is usually too vague ("Filter not found" with no context).
          const tail = stderrLines.slice(-30).join('\n');
          logger.error('Scene composition failed', {
            outputPath: opts.outputPath,
            error: err.message,
            stderrTail: tail,
          });
          reject(new Error(`${err.message}\nffmpeg stderr:\n${tail}`));
        });
    });
  }

  private concat(listPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
        .save(outputPath)
        .on('start', (cmd) => logger.info('ffmpeg concat start', { cmd }))
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
 * Remove inline TTS direction tags like [whispers], [laughs], [pause].
 * These are spoken-as-style cues some TTS providers (notably Gemini)
 * accept inline in the input text — they MUST NOT appear in burned
 * subtitles.
 */
function stripAudioTags(text: string): string {
  return text.replace(/\[[a-z][a-z0-9 _'-]*\]/gi, '').replace(/\s{2,}/g, ' ');
}

/**
 * Locate a usable subtitle font. Allows override via SUBTITLE_FONT_PATH;
 * otherwise probes common system paths on macOS / Linux / Windows.
 */
function findSubtitleFont(): string | undefined {
  const candidates: Array<string | undefined> = [
    process.env.SUBTITLE_FONT_PATH,
    // macOS — prefer paths without spaces; ffmpeg filter-graph parsing is
    // brittle around spaces even when escaped.
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/HelveticaNeue.ttc',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    // Linux
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    // Windows
    'C:\\Windows\\Fonts\\arialbd.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Escape a filesystem path so it can be safely used as a value in an ffmpeg
 * filter-graph options string (where `:` separates key=value pairs and `\`
 * is the escape character). Backslashes double, colons get a backslash.
 */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}
