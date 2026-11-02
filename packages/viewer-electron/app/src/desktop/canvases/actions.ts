import { randomUUID } from 'node:crypto';
import type { CanvasDocument } from '../../domain/canvases/document';
import {
  canvasActionsSchema,
  canvasActionOutputSchema,
  validateCanvasActionInput,
} from '../../domain/canvases/actions';
import type {
  CanvasAction,
  CanvasActionEvent,
  CanvasActionOutput,
  CanvasActionRun,
} from '../../domain/canvases/actions';

interface Frame {
  owner: number;
  revision: number;
  frameID: string;
  actions: CanvasAction[];
}
interface Pending {
  owner: number;
  run: CanvasActionRun;
  resolve(value: CanvasActionOutput): void;
  reject(error: Error): void;
  dispose(): void;
  received: boolean;
  committing: boolean;
}

/** Live registrations never survive a frame, revision or app restart. */
export class CanvasActions {
  private frames = new Map<string, Frame>();
  private pending = new Map<string, Pending>();
  private recent = new Map<string, CanvasActionRun>();
  constructor(
    private emit: (owner: number, event: CanvasActionEvent) => void,
    private timeout = 30000,
  ) {}

  register(owner: number, document: CanvasDocument, frameID: string, raw: unknown) {
    const actions = canvasActionsSchema.parse(raw);
    const previous = this.frames.get(document.id);
    if (previous && previous.frameID !== frameID)
      this.cancel(document.id, 'The canvas frame changed.');
    this.frames.set(document.id, { owner, revision: document.revision, frameID, actions });
  }
  list(id: string, revision: number) {
    const frame = this.frames.get(id);
    return frame?.revision === revision ? structuredClone(frame.actions) : [];
  }
  activity(id: string) {
    return structuredClone(this.recent.get(id));
  }
  busy(id: string) {
    return this.pending.has(id);
  }
  detach(owner: number, id: string, frameID: string) {
    const frame = this.frames.get(id);
    if (frame?.owner !== owner || frame.frameID !== frameID) return;
    this.cancel(id, 'The canvas was closed or stopped.');
    this.frames.delete(id);
  }
  invalidate(document: CanvasDocument, committing?: string) {
    const run = this.pending.get(document.id)?.run;
    if (
      run &&
      run.id !== committing &&
      (run.revision !== document.revision || run.stateRevision !== document.stateRevision)
    )
      this.cancel(document.id, 'The canvas or its inputs changed.');
    const frame = this.frames.get(document.id);
    if (frame && frame.revision !== document.revision) this.frames.delete(document.id);
  }
  start(
    owner: number,
    document: CanvasDocument,
    actionID: string,
    raw: unknown,
    actor: string,
    signal: AbortSignal,
    actorKind: CanvasActionRun['actorKind'] = 'user',
  ) {
    signal.throwIfAborted();
    if (this.pending.has(document.id))
      throw new Error('An action is already running in this canvas.');
    const frame = this.frames.get(document.id);
    if (!frame || frame.owner !== owner || frame.revision !== document.revision)
      throw new Error('Open the current canvas before running its actions.');
    const action = frame.actions.find((a) => a.id === actionID);
    if (!action) throw new Error('This action is unavailable in the current canvas.');
    const input = validateCanvasActionInput(action, raw);
    const run: CanvasActionRun = {
      id: randomUUID(),
      canvasID: document.id,
      frameID: frame.frameID,
      revision: document.revision,
      stateRevision: document.stateRevision,
      action: action.id,
      label: action.label,
      actor: actor.slice(0, 200),
      actorKind,
      input,
      status: 'running',
      started: Date.now(),
    };
    const result = new Promise<CanvasActionOutput>((resolve, reject) => {
      const abort = () => this.cancel(document.id, 'Action cancelled.');
      const timer = setTimeout(
        () => this.cancel(document.id, 'Action exceeded its 30-second limit.'),
        this.timeout,
      );
      this.pending.set(document.id, {
        owner,
        run,
        resolve,
        reject,
        received: false,
        committing: false,
        dispose: () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
        },
      });
      signal.addEventListener('abort', abort, { once: true });
    });
    // A response may arrive before the caller exits its persistence queue.
    void result.catch(() => {});
    this.recent.set(document.id, run);
    try {
      this.emit(owner, {
        kind: 'invoke',
        run: structuredClone(run),
        state: structuredClone(document.state),
      });
    } catch {
      this.finish(
        document.id,
        run.id,
        'failed',
        undefined,
        'The canvas could not receive this action.',
      );
    }
    return { run, result };
  }
  complete(
    owner: number,
    id: string,
    frameID: string,
    runID: string,
    output?: unknown,
    error?: string,
  ) {
    const pending = this.pending.get(id);
    if (
      !pending ||
      pending.owner !== owner ||
      pending.run.id !== runID ||
      pending.run.frameID !== frameID ||
      pending.received
    )
      throw new Error('This action response is no longer current.');
    if (error) {
      this.finish(id, runID, 'failed', undefined, error);
      return;
    }
    const parsed = canvasActionOutputSchema.safeParse(output);
    if (!parsed.success) {
      this.finish(id, runID, 'failed', undefined, 'The action returned an invalid result.');
      return;
    }
    pending.received = true;
    pending.resolve(parsed.data);
  }
  assertCurrent(id: string, runID: string) {
    if (this.pending.get(id)?.run.id !== runID) throw new Error('This action was cancelled.');
  }
  commit(id: string, runID: string, signal: AbortSignal) {
    this.assertCurrent(id, runID);
    signal.throwIfAborted();
    const pending = this.pending.get(id)!;
    // Once the validated result enters the persistence queue it must settle as saved or failed.
    // A late cancellation cannot report that an already committed state was discarded.
    pending.committing = true;
    pending.dispose();
  }
  finish(
    id: string,
    runID: string,
    status: 'completed' | 'failed' | 'cancelled',
    result?: CanvasActionOutput['result'],
    error?: string,
  ) {
    const pending = this.pending.get(id);
    if (!pending || pending.run.id !== runID) return;
    pending.dispose();
    this.pending.delete(id);
    const run = {
      ...pending.run,
      status,
      finished: Date.now(),
      result,
      error: error?.slice(0, 1000),
    };
    this.recent.set(id, run);
    this.emit(pending.owner, { kind: 'settled', run: structuredClone(run) });
    if (status !== 'completed') pending.reject(new Error(error || 'Action cancelled.'));
  }
  cancel(id: string, reason = 'You took over this canvas.') {
    const pending = this.pending.get(id);
    if (pending && !pending.committing)
      this.finish(id, pending.run.id, 'cancelled', undefined, reason);
  }
  release(owner: number) {
    for (const [id, frame] of this.frames)
      if (frame.owner === owner) this.detach(owner, id, frame.frameID);
  }
}
