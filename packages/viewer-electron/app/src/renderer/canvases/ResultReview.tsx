import type { CanvasResult } from '../../domain/canvases/results';
import { canvasResultName } from '../../domain/canvases/results';
import { DrawingResult } from './DrawingResult';

export interface PendingCanvasResult {
  result: CanvasResult;
  revision: number;
  stateRevision: number;
}

export function ResultReview({
  pending,
  stale,
  busy,
  onSave,
  onCancel,
}: {
  pending: PendingCanvasResult;
  stale: boolean;
  busy: boolean;
  onSave(): void;
  onCancel(): void;
}) {
  return (
    <section className="canvas-result" aria-label="Review canvas result">
      <header>
        <strong>{canvasResultName(pending.result)}</strong>
        <button disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy || stale} onClick={onSave}>
          {pending.result.format === 'dxf' ? 'Save drawing…' : 'Save result…'}
        </button>
      </header>
      {stale && <p role="status">The tool or its inputs changed. Prepare this result again.</p>}
      {pending.result.format === 'dxf' ? (
        <DrawingResult content={pending.result.content} />
      ) : (
        <pre tabIndex={0} aria-label="Result contents">
          {pending.result.content}
        </pre>
      )}
    </section>
  );
}
