import { join } from 'path';
import { mkdir, readFile, writeFile, access } from 'fs/promises';
import { OpenRouterImageClient } from '../clients/OpenRouterImageClient';
import { ArchetypeName } from '../story/types';
import { logger } from '../utils/logger';

/**
 * Disk-cached canonical character image per archetype.
 *
 * Generated once per archetype on first use, then reused across every video
 * in that series. This is what holds the orange cat visually consistent
 * scene-to-scene and run-to-run.
 *
 * To force a regeneration, delete the cache file (e.g. {cacheDir}/RagsToRiches.png).
 */
export class CharacterReferenceCache {
  constructor(
    private client: OpenRouterImageClient,
    private model: string,
    private cacheDir: string
  ) {}

  public async getReference(archetype: ArchetypeName): Promise<Buffer> {
    const path = this.cachePath(archetype);
    if (await fileExists(path)) {
      logger.info('Character reference cache hit', { archetype, path });
      return readFile(path);
    }

    logger.info('Character reference cache miss — generating', {
      archetype,
      path,
    });
    const buffer = await this.client.generate({
      model: this.model,
      prompt: this.buildCharacterPrompt(archetype),
    });
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(path, buffer);
    logger.info('Character reference cached', {
      archetype,
      path,
      bytes: buffer.length,
    });
    return buffer;
  }

  private cachePath(archetype: ArchetypeName): string {
    return join(this.cacheDir, `${archetype}.png`);
  }

  private buildCharacterPrompt(archetype: ArchetypeName): string {
    return `Character reference sheet for a recurring TikTok series: a chubby orange tabby cat.

Physical traits — these MUST be consistent across every appearance:
- Extremely chubby orange tabby with a prominent round belly
- Bright orange and white striped fur, soft and fluffy texture
- Big shiny expressive eyes, slightly teary or sparkling
- Endearing waddle, food-motivated personality
- Small white chest patch, white paws

Composition: full-body neutral studio shot, plain soft-grey background, even cinematic lighting, photorealistic, high detail. Vertical 9:16 framing. No text, no logos, no humans, no other animals.

Series identifier: "${archetype}". Every subsequent scene in this series will reference this exact look.`;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
