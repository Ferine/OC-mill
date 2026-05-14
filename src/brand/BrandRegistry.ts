import { join, resolve } from 'path';
import { readdir, mkdir, unlink } from 'fs/promises';
import { Brand } from './types';
import { BrandSchema } from './schemas';
import { ORANGE_CAT_BRAND } from './defaultBrand';
import { atomicWrite, isCachedFile, readJson } from '../utils/io';
import { logger } from '../utils/logger';

/**
 * On-disk brand library. One Brand per `<brandsDir>/<id>.json` file.
 *
 * The registry is the single owner of brand JSON files. The HTTP server
 * mutates brands via {@link upsert} / {@link delete}; the CLI agent reads
 * via {@link get}.
 *
 * On first construction, if the brands directory is empty (or missing),
 * we seed it with the bundled orange-cat brand so a clean checkout still
 * has a valid default.
 */
export class BrandRegistry {
  private brands = new Map<string, Brand>();
  private loaded = false;

  constructor(private brandsDir: string) {}

  public async initialize(): Promise<void> {
    if (this.loaded) return;
    await mkdir(this.brandsDir, { recursive: true });
    await this.reload();
    if (this.brands.size === 0) {
      logger.info('Seeding brands directory with default orange-cat brand', {
        brandsDir: this.brandsDir,
      });
      await this.upsert(ORANGE_CAT_BRAND);
    }
    this.loaded = true;
    logger.info('BrandRegistry initialized', {
      brandsDir: this.brandsDir,
      brandCount: this.brands.size,
      brandIds: [...this.brands.keys()],
    });
  }

  public async reload(): Promise<void> {
    this.brands.clear();
    let entries: string[];
    try {
      entries = await readdir(this.brandsDir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const path = join(this.brandsDir, name);
      if (!(await isCachedFile(path, 10))) continue;
      try {
        const raw = await readJson<unknown>(path);
        const brand = BrandSchema.parse(raw);
        this.brands.set(brand.id, brand);
      } catch (err) {
        logger.warn('Skipping invalid brand file', {
          path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  public list(): Brand[] {
    return [...this.brands.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }

  public get(id: string): Brand | undefined {
    return this.brands.get(id);
  }

  public has(id: string): boolean {
    return this.brands.has(id);
  }

  public async upsert(brand: Brand): Promise<Brand> {
    BrandSchema.parse(brand);
    const path = this.fileFor(brand.id);
    await atomicWrite(path, JSON.stringify(brand, null, 2));
    this.brands.set(brand.id, brand);
    return brand;
  }

  public async delete(id: string): Promise<void> {
    if (!this.brands.has(id)) return;
    if (this.brands.size <= 1) {
      throw new Error('Cannot delete the last remaining brand');
    }
    await unlink(this.fileFor(id)).catch(() => undefined);
    this.brands.delete(id);
  }

  private fileFor(id: string): string {
    return resolve(this.brandsDir, `${id}.json`);
  }
}
