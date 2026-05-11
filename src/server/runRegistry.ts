import { PipelineEventBus, PipelineEvent } from '../pipeline/events';

export type RunStatus = 'running' | 'success' | 'failed';

export interface RegisteredRun {
  runId: string;
  runDir: string;
  bus: PipelineEventBus;
  status: RunStatus;
  startedAt: number;
  /** Bounded ring buffer so a tab opened mid-run still gets recent context. */
  events: PipelineEvent[];
  error?: string;
  tiktokPostId?: string;
  tiktokShareUrl?: string;
}

const MAX_EVENTS = 1000;

/**
 * In-memory registry of runs the server has launched. Survives until the
 * server process exits — restarting the server forgets in-flight events
 * but the on-disk runDir state is still intact and can be inspected.
 */
export class RunRegistry {
  private runs = new Map<string, RegisteredRun>();

  register(runId: string, runDir: string): RegisteredRun {
    const bus = new PipelineEventBus();
    bus.setMaxListeners(64);

    const run: RegisteredRun = {
      runId,
      runDir,
      bus,
      status: 'running',
      startedAt: Date.now(),
      events: [],
    };
    this.runs.set(runId, run);

    bus.subscribe((event) => {
      run.events.push(event);
      if (run.events.length > MAX_EVENTS) run.events.shift();
      if (event.type === 'run.success') {
        run.status = 'success';
        run.tiktokPostId = event.tiktokPostId;
        run.tiktokShareUrl = event.tiktokShareUrl;
      } else if (event.type === 'run.failure') {
        run.status = 'failed';
        run.error = event.error;
      }
    });

    return run;
  }

  get(runId: string): RegisteredRun | undefined {
    return this.runs.get(runId);
  }

  list(): RegisteredRun[] {
    return Array.from(this.runs.values()).sort(
      (a, b) => b.startedAt - a.startedAt
    );
  }
}
