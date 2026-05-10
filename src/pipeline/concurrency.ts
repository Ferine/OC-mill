/**
 * Run async tasks with bounded concurrency. Preserves input order in results.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  if (limit < 1) {
    throw new Error(`concurrency limit must be >= 1, got ${limit}`);
  }
  const results: T[] = new Array(tasks.length);
  let next = 0;

  const workerCount = Math.min(limit, tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  });

  await Promise.all(workers);
  return results;
}
