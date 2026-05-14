import { useEffect, useState } from 'react';
import type { PipelineEvent } from '../types';

/**
 * Subscribe to the run's SSE event stream. Returns the events accumulated
 * since mount. Closing the EventSource happens automatically on unmount or
 * when `runId` changes.
 */
export function useRunEvents(runId: string | undefined): PipelineEvent[] {
  const [events, setEvents] = useState<PipelineEvent[]>([]);

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    const src = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    src.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as PipelineEvent;
        setEvents((prev) => [...prev, data]);
      } catch {
        // ignore malformed
      }
    };
    src.onerror = () => {
      // server closed (run ended or no-active-run). Close to stop reconnect.
      src.close();
    };
    return () => src.close();
  }, [runId]);

  return events;
}
