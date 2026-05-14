import { join } from 'path';
import { mkdir, readFile, writeFile, access } from 'fs/promises';
import { OpenRouterImageClient } from '../clients/OpenRouterImageClient';
import { Brand } from '../brand/types';
import { logger } from '../utils/logger';

/**
 * Disk-cached canonical character image per (brand, archetype).
 *
 * Generated once per (brand, archetype) on first use, then reused across
 * every video in that series. This is what holds the character visually
 * consistent scene-to-scene and run-to-run.
 *
 * To force a regeneration, delete the cache file at
 * `{cacheDir}/{brand.id}/{archetypeId}.png`.
 */
export class CharacterReferenceCache {
  private inFlight = new Map<string, Promise<Buffer>>();

  constructor(
    private client: OpenRouterImageClient,
    private model: string,
    private cacheDir: string
  ) {}

  public async getReference(opts: {
    brand: Brand;
    archetypeId: string;
  }): Promise<Buffer> {
    const key = `${opts.brand.id}/${opts.archetypeId}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      logger.debug('Character reference generation already in flight', { key });
      return existing;
    }

    const promise = this.fetchOrGenerate(opts);
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async fetchOrGenerate(opts: {
    brand: Brand;
    archetypeId: string;
  }): Promise<Buffer> {
    const path = this.cachePath(opts.brand.id, opts.archetypeId);
    if (await fileExists(path)) {
      logger.info('Character reference cache hit', {
        brandId: opts.brand.id,
        archetypeId: opts.archetypeId,
        path,
      });
      return readFile(path);
    }

    logger.info('Character reference cache miss — generating', {
      brandId: opts.brand.id,
      archetypeId: opts.archetypeId,
      path,
    });
    const prompt = buildCharacterPrompt(opts.brand, opts.archetypeId);
    const buffer = await this.client.generate({
      model: this.model,
      prompt,
    });
    await mkdir(dirOf(path), { recursive: true });
    await writeFile(path, buffer);
    logger.info('Character reference cached', {
      brandId: opts.brand.id,
      archetypeId: opts.archetypeId,
      path,
      bytes: buffer.length,
    });
    return buffer;
  }

  private cachePath(brandId: string, archetypeId: string): string {
    return join(this.cacheDir, brandId, `${archetypeId}.png`);
  }
}

function buildCharacterPrompt(brand: Brand, archetypeId: string): string {
  return `${brand.prompts.referenceSheet}

Series identifier: "${brand.id}/${archetypeId}". Every subsequent scene in this series will reference this exact look.`;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '.' : path.slice(0, i);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
