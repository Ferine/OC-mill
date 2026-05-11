import { rename, stat, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';

/**
 * Write a file atomically: stage to .tmp then rename. Prevents a crash
 * from leaving behind a half-written file that a subsequent resume might
 * mistake for completed output.
 */
export async function atomicWrite(
  path: string,
  data: Buffer | string
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/**
 * True iff path exists as a file with at least `minBytes` of content.
 * Used by the resume path to decide whether a previous stage's output
 * is genuinely usable.
 */
export async function isCachedFile(
  path: string,
  minBytes: number = 1
): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() && s.size >= minBytes;
  } catch {
    return false;
  }
}

/**
 * Read JSON from a file. Throws if missing or invalid JSON.
 */
export async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as T;
}
