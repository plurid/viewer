import { useState } from 'react';
import type { OperationJob } from '../../domain/contracts';
import type { OptimizationOptions } from '../../domain/operations/optimization';
import { formatOptimizationSize } from '../../domain/operations/optimization';
import type { OptimizationSession } from './useOptimizationSession';
import { isActiveJob } from '../../domain/operations/jobs';

/** Paginated results keep the full batch available without retaining a thousand table rows. */
export function OptimizationResults({
  session,
  jobs,
  options,
  sourceRoot,
  working,
  onOpen,
}: {
  session: OptimizationSession;
  jobs: OperationJob[];
  options?: OptimizationOptions;
  sourceRoot?: string;
  working: boolean;
  onOpen(file: string): void;
}) {
  const [resultPage, setResultPage] = useState(0);
  return (
    <>
      <div className="optimize-results">
        <table>
          <thead>
            <tr>
              <th>
                <span className="visually-hidden">Select</span>
              </th>
              <th>File</th>
              <th>Original</th>
              <th>Candidate</th>
              <th>Result</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {session.rows.slice(resultPage * 50, resultPage * 50 + 50).map((row) => {
              const candidate = row.candidate;
              const job = row.exported
                ? [...jobs].reverse().find((value) => value.sources.includes(row.file.path))
                : undefined;
              const item = job?.completed.find((value) => value.source === row.file.path);
              // A job fails when any of its files fails; one it saved still reads as saved.
              const failure =
                row.error ||
                job?.errors.find((value) => value.path === row.file.path)?.message ||
                (job?.status === 'failed' && !item
                  ? job.errors[0]?.message || 'Export failed. Retry this file.'
                  : undefined);
              const smaller = !!candidate && candidate.outputBytes < candidate.inputBytes;
              return (
                <tr key={row.file.path} data-optimization-file={row.file.name}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Save ${row.file.name}`}
                      checked={row.selected}
                      disabled={working || !smaller || row.exported}
                      onChange={(event) => session.select(row.file.path, event.target.checked)}
                    />
                  </td>
                  <td>{sourceRoot ? row.file.path.slice(sourceRoot.length + 1) : row.file.name}</td>
                  <td>{formatOptimizationSize(candidate?.inputBytes ?? row.file.size)}</td>
                  <td>{candidate ? formatOptimizationSize(candidate.outputBytes) : ''}</td>
                  <td>
                    {failure ? (
                      <span className="error">{failure}</span>
                    ) : row.preparing ? (
                      'Preparing…'
                    ) : job && isActiveJob(job) ? (
                      `${job.status === 'running' ? 'Saving' : job.status}…`
                    ) : item?.optimized ? (
                      'Saved'
                    ) : job?.status === 'cancelled' ? (
                      'Export cancelled'
                    ) : candidate ? (
                      <>
                        {smaller ? (
                          <span className="optimize-savings">
                            {Math.round((1 - candidate.outputBytes / candidate.inputBytes) * 100)}%
                            smaller
                          </span>
                        ) : (
                          'Already compact · original kept'
                        )}
                        {candidate.targetSize && (
                          <span
                            className={
                              candidate.targetSize.met ? 'muted' : 'optimization-target-missed'
                            }
                          >
                            {candidate.targetSize.met ? 'Target met' : 'Target not met'} ·{' '}
                            {formatOptimizationSize(candidate.targetSize.bytes)}
                            {candidate.targetSize.quality !== undefined
                              ? ` · quality ${candidate.targetSize.quality}`
                              : ''}
                          </span>
                        )}
                      </>
                    ) : (
                      'Ready'
                    )}
                  </td>
                  <td>
                    <div className="optimization-row-actions">
                      {candidate && (
                        <button
                          disabled={working || !!session.reviewing}
                          onClick={() => void session.review(candidate)}
                        >
                          Review
                        </button>
                      )}
                      {(failure || candidate || job?.status === 'cancelled') && (
                        <button
                          disabled={working || !options}
                          onClick={() => void session.prepare(options!, row.file.path)}
                        >
                          Retry
                        </button>
                      )}
                      {item?.destination && (
                        <button onClick={() => onOpen(item.destination!)}>Open</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {session.rows.length > 50 && (
        <div className="optimization-pagination">
          <button disabled={resultPage === 0} onClick={() => setResultPage((value) => value - 1)}>
            Previous files
          </button>
          <span>
            {resultPage * 50 + 1}–{Math.min(session.rows.length, resultPage * 50 + 50)} of{' '}
            {session.rows.length}
          </span>
          <button
            disabled={(resultPage + 1) * 50 >= session.rows.length}
            onClick={() => setResultPage((value) => value + 1)}
          >
            Next files
          </button>
        </div>
      )}
    </>
  );
}
