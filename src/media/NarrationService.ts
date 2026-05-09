import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { ElevenLabsClient } from '../clients/ElevenLabsClient';
import { runWithConcurrency } from '../pipeline/concurrency';
import { Story, Mood } from '../story/types';
import { logger } from '../utils/logger';

export interface SceneNarrationResult {
  sceneIndex: number;
  path: string;
  bytes: number;
}

export class NarrationService {
  constructor(
    private client: ElevenLabsClient,
    private voicesByMood: Record<string, string>
  ) {}

  /**
   * Generate per-scene narration audio. Voice is chosen from the per-mood
   * voice map; falls back to the story's overall mood if a scene mood has
   * no mapping, then to the first configured voice.
   */
  public async generateAll(opts: {
    story: Story;
    outputDir: string;
    concurrency: number;
  }): Promise<SceneNarrationResult[]> {
    logger.info('Generating narration for all scenes', {
      sceneCount: opts.story.scenes.length,
      outputDir: opts.outputDir,
    });

    await mkdir(opts.outputDir, { recursive: true });

    const tasks = opts.story.scenes.map((scene, sceneIndex) => async () => {
      const voiceId = this.pickVoice(scene.mood, opts.story.overallMood);
      const buffer = await this.client.synthesize({
        voiceId,
        text: scene.subtitleText,
      });
      const path = join(
        opts.outputDir,
        `scene-${String(sceneIndex).padStart(2, '0')}-narration.mp3`
      );
      await writeFile(path, buffer);
      logger.info('Narration generated', {
        sceneIndex,
        voiceId,
        path,
        bytes: buffer.length,
      });
      return { sceneIndex, path, bytes: buffer.length };
    });

    return runWithConcurrency(tasks, opts.concurrency);
  }

  private pickVoice(sceneMood: Mood, fallbackMood: Mood): string {
    return (
      this.voicesByMood[sceneMood] ||
      this.voicesByMood[fallbackMood] ||
      Object.values(this.voicesByMood)[0]
    );
  }
}
