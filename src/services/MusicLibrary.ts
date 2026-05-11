import { join } from 'path';
import { readdir, stat } from 'fs/promises';
import { atomicWrite, isCachedFile, readJson } from '../utils/io';
import { Mood } from '../story/types';
import { logger } from '../utils/logger';

const SUPPORTED_EXTENSIONS = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
const FALLBACK_MOOD = 'default';

export interface MusicSelection {
  path: string;
  mood: string;
}

/**
 * Picks a background-music track for a story. Tracks live in
 *
 *   ${rootDir}/<mood>/*.{mp3,wav,ogg,m4a,flac,aac}
 *
 * and the library prefers a track matching `story.overallMood`, then
 * falls back to `default/`, then returns undefined (compositor skips
 * the music mix entirely). The choice is persisted alongside the run
 * so resume always reuses the same track.
 */
export class MusicLibrary {
  constructor(private rootDir: string) {}

  /**
   * Returns the track path for this run. On a fresh run, picks at random
   * from the mood folder and writes the choice to `pickPath`. On resume,
   * loads the prior choice if it's still on disk.
   */
  public async pickFor(
    mood: Mood,
    pickPath: string
  ): Promise<MusicSelection | undefined> {
    // Resume path: reuse the previously-selected track.
    if (await isCachedFile(pickPath, 10)) {
      try {
        const prior = await readJson<MusicSelection>(pickPath);
        if (await fileExists(prior.path)) {
          logger.info('Music selection cache hit (resume)', prior);
          return prior;
        }
        logger.warn(
          'Persisted music selection no longer on disk — picking fresh',
          prior
        );
      } catch {
        // fall through and re-pick
      }
    }

    const candidates = await this.tracksForMood(mood);
    if (candidates.length === 0) {
      logger.info('No music tracks available for mood — skipping music', {
        mood,
        searched: [
          join(this.rootDir, mood),
          join(this.rootDir, FALLBACK_MOOD),
        ],
      });
      return undefined;
    }

    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    const selection: MusicSelection = { path: picked, mood };
    await atomicWrite(pickPath, JSON.stringify(selection, null, 2));
    logger.info('Music selected', selection);
    return selection;
  }

  /**
   * Summary of what's available (used at startup for visibility).
   */
  public async inventory(): Promise<Record<string, number>> {
    let entries: string[];
    try {
      entries = await readdir(this.rootDir);
    } catch {
      return {};
    }
    const counts: Record<string, number> = {};
    for (const name of entries) {
      const moodDir = join(this.rootDir, name);
      try {
        const s = await stat(moodDir);
        if (!s.isDirectory()) continue;
        const files = await readdir(moodDir);
        counts[name] = files.filter((f) => SUPPORTED_EXTENSIONS.test(f)).length;
      } catch {
        // skip
      }
    }
    return counts;
  }

  private async tracksForMood(mood: Mood): Promise<string[]> {
    const direct = await this.listMoodDir(mood);
    if (direct.length > 0) return direct;
    // Mood is a typed union so it never equals 'default' directly, but the
    // fallback search runs unconditionally — it's a separate folder.
    return this.listMoodDir(FALLBACK_MOOD);
  }

  private async listMoodDir(name: string): Promise<string[]> {
    const dir = join(this.rootDir, name);
    try {
      const files = await readdir(dir);
      return files
        .filter((f) => SUPPORTED_EXTENSIONS.test(f))
        .map((f) => join(dir, f));
    } catch {
      return [];
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
