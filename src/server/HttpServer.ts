import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import { join, basename, resolve, sep } from 'path';
import { readdir, stat } from 'fs/promises';
import { OrangeCatAgent } from '../agent/OrangeCatAgent';
import { Config } from '../utils/config';
import { logger } from '../utils/logger';
import { isCachedFile, readJson } from '../utils/io';
import { Story } from '../story/types';
import { RunRegistry } from './runRegistry';

interface RunSummary {
  runId: string;
  runDir: string;
  status: 'running' | 'success' | 'failed' | 'idle';
  storyTitle?: string;
  archetype?: string;
  sceneCount?: number;
  hasFinal: boolean;
  startedAtMs?: number;
}

interface SceneFileStatus {
  sceneIndex: number;
  keyframe: { exists: boolean; bytes?: number; evalPassed?: boolean };
  clip: { exists: boolean; bytes?: number };
  narration: { exists: boolean; bytes?: number };
}

interface RunDetail extends RunSummary {
  story?: Story;
  scenes: SceneFileStatus[];
  active: boolean;
}

export async function startServer(
  config: Config,
  port: number = 5173,
  agent?: OrangeCatAgent
) {
  const app = Fastify({ logger: false });

  await app.register(staticPlugin, {
    root: resolve(process.cwd(), 'public'),
    prefix: '/',
  });

  // Reuse the already-initialized agent when the caller has one, otherwise
  // construct + init our own (e.g. when startServer is used from tests).
  if (!agent) {
    agent = new OrangeCatAgent(config);
    await agent.initialize();
  }
  const ownedAgent = agent;
  const registry = new RunRegistry();
  const root = config.pipeline.videoDownloadPath;

  // ---------- Runs list / detail ----------

  app.get('/api/runs', async () => {
    const dirs = await listRunDirs(root);
    const summaries = await Promise.all(
      dirs.map((d) => summarize(basename(d), d, registry))
    );
    // newest first
    return summaries.sort(
      (a, b) => (b.startedAtMs ?? 0) - (a.startedAtMs ?? 0)
    );
  });

  app.get('/api/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const runDir = safeRunDir(root, id);
    if (!runDir) return reply.code(400).send({ error: 'invalid run id' });
    if (!(await pathExists(runDir))) {
      return reply.code(404).send({ error: 'not found' });
    }
    return detail(id, runDir, registry);
  });

  // ---------- Start / resume ----------

  app.post('/api/runs', async () => {
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const runDir = join(root, runId);
    const run = registry.register(runId, runDir);
    fireAndForget(ownedAgent, { events: run.bus });
    return { runId, runDir };
  });

  app.post('/api/runs/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    const runDir = safeRunDir(root, id);
    if (!runDir) return reply.code(400).send({ error: 'invalid run id' });
    if (!(await pathExists(runDir))) {
      return reply.code(404).send({ error: 'not found' });
    }
    const run = registry.register(id, runDir);
    fireAndForget(ownedAgent, { events: run.bus, resumeFromRunDir: runDir });
    return { runId: id, runDir };
  });

  // ---------- SSE event stream ----------

  app.get('/api/runs/:id/events', (req, reply) => {
    const { id } = req.params as { id: string };
    const run = registry.get(id);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    if (!run) {
      // Run is not currently held in the registry (server restarted, or
      // viewing a completed run). Send a marker and close.
      send({ type: 'no-active-run' });
      reply.raw.end();
      return;
    }

    // Replay buffered events so a client connecting mid-run sees the
    // full picture immediately.
    for (const event of run.events) send(event);

    const unsubscribe = run.bus.subscribe(send);

    // Heartbeat: keep proxies / browsers from timing out the connection.
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`);
      } catch {
        // socket closed
      }
    }, 20_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // ---------- File serving from runDirs (keyframes / clips / final) ----------

  app.get('/api/runs/:id/files/*', async (req, reply) => {
    const { id } = req.params as { id: string };
    const subpath = (req.params as Record<string, string>)['*'];
    const runDir = safeRunDir(root, id);
    if (!runDir) return reply.code(400).send({ error: 'invalid run id' });

    const target = resolve(runDir, subpath);
    // Path traversal guard
    if (!target.startsWith(runDir + sep) && target !== runDir) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (!(await pathExists(target))) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile(subpath, runDir);
  });

  // ---------- Boot ----------

  await app.listen({ host: '127.0.0.1', port });
  logger.info(`UI available at http://127.0.0.1:${port}`);
}

// ---------- Helpers ----------

function fireAndForget(
  agent: OrangeCatAgent,
  opts: Parameters<OrangeCatAgent['runOnce']>[0]
): void {
  agent.runOnce(opts).catch((err) => {
    logger.error('Background run threw', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function listRunDirs(root: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const name of entries) {
    if (!name.startsWith('run-')) continue;
    const path = join(root, name);
    try {
      const s = await stat(path);
      if (s.isDirectory()) dirs.push(path);
    } catch {
      // skip
    }
  }
  return dirs;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Reject path traversal: id must be a single non-empty segment. */
function safeRunDir(root: string, id: string): string | undefined {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    return undefined;
  }
  return join(root, id);
}

async function summarize(
  runId: string,
  runDir: string,
  registry: RunRegistry
): Promise<RunSummary> {
  const dirStat = await stat(runDir).catch(() => undefined);
  const startedAtMs = dirStat?.birthtimeMs ?? dirStat?.mtimeMs;

  const tracked = registry.get(runId);
  let status: RunSummary['status'] = tracked?.status ?? 'idle';

  let storyTitle: string | undefined;
  let archetype: string | undefined;
  let sceneCount: number | undefined;

  const storyPath = join(runDir, 'story.json');
  if (await isCachedFile(storyPath, 50)) {
    try {
      const story = await readJson<Story>(storyPath);
      storyTitle = story.title;
      archetype = story.archetype;
      sceneCount = story.scenes.length;
    } catch {
      // ignore malformed
    }
  }

  const finalPath = join(runDir, 'final.mp4');
  const hasFinal = await isCachedFile(finalPath, 100_000);
  if (hasFinal && status === 'idle') status = 'success';

  return {
    runId,
    runDir,
    status,
    storyTitle,
    archetype,
    sceneCount,
    hasFinal,
    startedAtMs,
  };
}

async function detail(
  runId: string,
  runDir: string,
  registry: RunRegistry
): Promise<RunDetail> {
  const summary = await summarize(runId, runDir, registry);
  const story = summary.storyTitle
    ? await readJson<Story>(join(runDir, 'story.json')).catch(() => undefined)
    : undefined;

  const scenes: SceneFileStatus[] = [];
  const sceneCount = story?.scenes.length ?? 0;
  for (let i = 0; i < sceneCount; i++) {
    const idx = String(i).padStart(2, '0');
    const kfPath = join(runDir, 'keyframes', `scene-${idx}-keyframe.png`);
    const kfMetaPath = `${kfPath}.meta.json`;
    const clipPath = join(runDir, 'clips', `scene-${idx}-clip.mp4`);
    const narrPath = join(runDir, 'narration', `scene-${idx}-narration.mp3`);

    const kfExists = await isCachedFile(kfPath, 1024);
    const kfStat = kfExists ? await stat(kfPath) : undefined;
    let kfMeta: { evalPassed?: boolean } | undefined;
    if (kfExists) {
      try {
        kfMeta = await readJson<{ evalPassed?: boolean }>(kfMetaPath);
      } catch {
        // missing metadata → unknown
      }
    }

    const clipExists = await isCachedFile(clipPath, 100_000);
    const clipStat = clipExists ? await stat(clipPath) : undefined;
    const narrExists = await isCachedFile(narrPath, 1024);
    const narrStat = narrExists ? await stat(narrPath) : undefined;

    scenes.push({
      sceneIndex: i,
      keyframe: {
        exists: kfExists,
        bytes: kfStat?.size,
        evalPassed: kfMeta?.evalPassed,
      },
      clip: { exists: clipExists, bytes: clipStat?.size },
      narration: { exists: narrExists, bytes: narrStat?.size },
    });
  }

  return {
    ...summary,
    story,
    scenes,
    active: registry.get(runId)?.status === 'running',
  };
}
