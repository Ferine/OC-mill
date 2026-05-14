/**
 * Run async tasks with bounded concurrency. Preserves input order in results.
 *
 * Fail-fast: when any task throws, sibling workers stop dequeuing new tasks.
 * In-flight tasks cannot be cancelled (no AbortSignal threaded through), but
 * we won't create *new* work after a failure — which matters for the video
 * pipeline where each pending task is a paid API job.
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
  let aborted = false;

  const workerCount = Math.min(limit, tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (!aborted) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        results[i] = await tasks[i]();
      } catch (err) {
        aborted = true;
        throw err;
      }
    }
  });

  await Promise.all(workers);
  return results;
}
