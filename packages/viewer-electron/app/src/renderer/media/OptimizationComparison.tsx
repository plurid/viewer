import { useEffect, useRef, useState } from 'react';
import type {
  OptimizationCandidate,
  OptimizationComparison as Comparison,
} from '../../domain/operations/optimization-review';
import { formatOptimizationSize } from '../../domain/operations/optimization';
import { PDFPagePreview } from '../pdf-tools/PDFPagePreview';

/** Both panes share a PDF page or image scale, and pan together for pixel inspection. */
export function OptimizationComparison({
  review,
  candidate,
  onClose,
}: {
  review: Comparison;
  candidate: OptimizationCandidate;
  onClose(): void;
}) {
  const [page, setPage] = useState(1);
  const [actual, setActual] = useState(false);
  const [error, setError] = useState('');
  const panes = useRef<(HTMLDivElement | null)[]>([]);
  const section = useRef<HTMLElement>(null);
  const syncing = useRef<number | undefined>(undefined);
  useEffect(() => {
    section.current?.scrollIntoView({ block: 'end' });
  }, []);
  useEffect(
    () =>
      window.viewer.onEvent((event) => {
        if (event.type !== 'file-access') return;
        const source = review.original.entry.path;
        if (source === event.path || source.startsWith(event.path.replace(/\/$/, '') + '/'))
          onClose();
      }),
    [review.original.entry.path, onClose],
  );
  useEffect(
    () => () => {
      if (syncing.current) cancelAnimationFrame(syncing.current);
    },
    [],
  );
  const pan = (index: number) => {
    if (syncing.current) return;
    const from = panes.current[index],
      to = panes.current[1 - index];
    if (!from || !to) return;
    to.scrollLeft =
      (from.scrollLeft / Math.max(1, from.scrollWidth - from.clientWidth)) *
      (to.scrollWidth - to.clientWidth);
    to.scrollTop =
      (from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight)) *
      (to.scrollHeight - to.clientHeight);
    syncing.current = requestAnimationFrame(() => {
      syncing.current = undefined;
    });
  };
  return (
    <section ref={section} className="optimization-comparison" aria-label="Before and after review">
      <div className="optimization-review-toolbar">
        <strong>{candidate.source.name}</strong>
        <span className="toolbar-spacer" />
        {candidate.format === 'pdf' ? (
          <>
            <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              Previous page
            </button>
            <label>
              Page{' '}
              <input
                type="number"
                aria-label="Comparison page"
                min={1}
                max={review.pages ?? 1}
                value={page}
                onChange={(event) =>
                  setPage(Math.max(1, Math.min(review.pages ?? 1, Number(event.target.value) || 1)))
                }
              />{' '}
              of {review.pages}
            </label>
            <button
              disabled={page >= (review.pages ?? 1)}
              onClick={() => setPage((value) => value + 1)}
            >
              Next page
            </button>
          </>
        ) : (
          <button aria-pressed={actual} onClick={() => setActual((value) => !value)}>
            {actual ? 'Fit images' : 'Actual size'}
          </button>
        )}
        <button onClick={onClose}>Close review</button>
      </div>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      <div className={`optimization-review-panes ${actual ? 'actual-size' : ''}`}>
        {[review.original, review.candidate].map((resource, index) => (
          <figure key={resource.id}>
            <figcaption>
              {index === 0 ? 'Original' : 'Optimized'}{' '}
              <span>
                {formatOptimizationSize(index === 0 ? candidate.inputBytes : candidate.outputBytes)}
              </span>
            </figcaption>
            <div
              className="optimization-review-scroll"
              ref={(element) => {
                panes.current[index] = element;
              }}
              onScroll={() => pan(index)}
            >
              {candidate.format === 'pdf' ? (
                <PDFPagePreview resource={resource} page={page} rotate={0} />
              ) : (
                <img
                  src={resource.url}
                  alt={`${index === 0 ? 'Original' : 'Optimized'} ${candidate.source.name}`}
                  onError={() =>
                    setError(
                      'An image could not be displayed. Close this review and retry the file.',
                    )
                  }
                />
              )}
            </div>
          </figure>
        ))}
      </div>
    </section>
  );
}
