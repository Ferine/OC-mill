import { EventEmitter } from 'events';
import { Story } from '../story/types';

/**
 * Structured pipeline events emitted by StoryAgent and the per-scene
 * services. The HTTP server multiplexes these to SSE clients per run so
 * the UI can show live progress without polling.
 *
 * All events are best-effort and may arrive out of order across scenes
 * (per-scene tasks run in parallel under p-limit).
 */
export type PipelineEvent =
  | { type: 'run.start'; runDir: string; resuming: boolean }
  | { type: 'story.start' }
  | { type: 'story.ready'; story: Story; fromCache?: boolean }
  | { type: 'stage.start'; stage: 'keyframes' | 'clips' | 'narration' | 'compose' | 'upload' }
  | { type: 'stage.done'; stage: 'keyframes' | 'clips' | 'narration' | 'compose' | 'upload' }
  | { type: 'scene.keyframe.start'; sceneIndex: number; attempt: number }
  | {
      type: 'scene.keyframe.ready';
      sceneIndex: number;
      path: string;
      bytes: number;
      evalAttempts: number;
      evalPassed: boolean;
      fromCache?: boolean;
    }
  | { type: 'scene.keyframe.evalFail'; sceneIndex: number; attempt: number; feedback: string }
  | { type: 'scene.clip.start'; sceneIndex: number }
  | {
      type: 'scene.clip.ready';
      sceneIndex: number;
      path: string;
      bytes: number;
      durationSeconds: number;
      fromCache?: boolean;
    }
  | { type: 'scene.narration.start'; sceneIndex: number }
  | {
      type: 'scene.narration.ready';
      sceneIndex: number;
      path: string;
      bytes: number;
      fromCache?: boolean;
    }
  | { type: 'compose.done'; path: string }
  | { type: 'upload.done'; postId: string; shareUrl?: string }
  | { type: 'run.success'; tiktokPostId?: string; tiktokShareUrl?: string }
  | { type: 'run.failure'; error: string };

const CHANNEL = 'event';

/**
 * Thin EventEmitter wrapper carrying typed PipelineEvents on a single channel.
 * `publish` is the producer entry; `subscribe` returns an unsubscribe fn.
 */
export class PipelineEventBus {
  private emitter = new EventEmitter();

  publish(event: PipelineEvent): void {
    this.emitter.emit(CHANNEL, event);
  }

  subscribe(listener: (event: PipelineEvent) => void): () => void {
    this.emitter.on(CHANNEL, listener);
    return () => this.emitter.off(CHANNEL, listener);
  }

  /** Allow many SSE clients per run without warning spam. */
  setMaxListeners(n: number): void {
    this.emitter.setMaxListeners(n);
  }
}
