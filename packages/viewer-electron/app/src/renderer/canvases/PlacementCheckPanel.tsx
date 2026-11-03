import { useEffect, useState } from 'react';
import type {
  ExperimentDocument as CanvasDocument,
  ExperimentAPI,
} from '../../domain/robotics/experiment-canvases';
import type { PlacementReport, PlacementComparison } from '../../domain/robotics/placement';
import { errorMessage } from '../../domain/errors';
import { Disclosure } from '../ui/Disclosure';

export function PlacementCheckPanel({
  api,
  document,
  group,
  busy,
  onCheck,
  onSave,
}: {
  api: ExperimentAPI;
  document: CanvasDocument;
  group?: string;
  busy: boolean;
  onCheck(): void;
  onSave(): void;
}) {
  const key = JSON.stringify([
    document.id,
    document.revision,
    document.stateRevision,
    document.placementCheck,
  ]);
  const forkID = document.fork?.id;
  const [result, setResult] = useState<{
    key: string;
    report?: PlacementReport;
    comparison?: PlacementComparison;
    error?: string;
  }>();
  useEffect(() => {
    let live = true;
    void Promise.all([
      api.canvas({ kind: 'placement-report', id: document.id }),
      forkID ? api.canvas({ kind: 'placement-comparison', id: document.id }) : undefined,
    ])
      .then(([report, comparison]) => {
        if (live)
          setResult({
            key,
            report: report.placementReport,
            comparison: comparison?.placementComparison,
          });
      })
      .catch((error: unknown) => {
        if (live) setResult({ key, error: errorMessage(error) });
      });
    return () => {
      live = false;
    };
  }, [api, document.id, forkID, key]);
  const current = result?.key === key ? result : undefined;
  const report = current?.report;
  const checked = report?.status === 'checked' ? report : undefined;
  const label = !current
    ? 'Checking…'
    : !checked
      ? 'Check again'
      : checked.recommended
        ? 'Placements checked'
        : 'No passing candidate';
  const comparison = current?.comparison;
  return (
    <Disclosure
      variant="compact"
      className="canvas-inspector"
      group={group}
      closeOnEscape
      summary={`Station study · ${label}`}
    >
      <div className="canvas-robot-report" data-placement-status={report?.status ?? 'loading'}>
        <header>
          <strong>Checked by Viewer</strong>
          <button disabled={busy} onClick={onCheck}>
            Check placements
          </button>
          <button disabled={busy || !checked} onClick={onSave}>
            Save check JSON…
          </button>
        </header>
        {current?.error && <p role="alert">{current.error}</p>}
        {report?.status === 'stale' && <p>{report.reason}</p>}
        {checked && (
          <>
            <table>
              <caption>Position tolerance {(checked.brief.tolerance * 1000).toFixed(1)} mm</caption>
              <thead>
                <tr>
                  <th>Mounting point</th>
                  <th>Passing targets</th>
                  <th>Mounting allowed</th>
                  <th>Maximum error</th>
                  <th>Move from existing</th>
                </tr>
              </thead>
              <tbody>
                {checked.candidates.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">
                      {c.label}
                      {checked.input.selected === c.id ? ' · Selected' : ''}
                    </th>
                    <td>
                      {c.reached} / {c.total}
                    </td>
                    <td>{c.allowed ? 'Yes' : 'No'}</td>
                    <td>{(c.maximumError * 1000).toFixed(2)} mm</td>
                    <td>{Math.round(c.distance * 1000)} mm</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              {checked.recommended
                ? `Least movement among passing candidates: ${checked.candidates.find((c) => c.id === checked.recommended)!.label}.`
                : 'These candidate poses do not establish an allowed placement.'}
            </p>
            {comparison?.status === 'compared' && (
              <p>
                Compared with {comparison.original.title}:{' '}
                {comparison.original.report.input.selected ?? 'no selection'} →{' '}
                {comparison.alternative.report.input.selected ?? 'no selection'}. Same robot,
                targets and reserved areas.
              </p>
            )}
            {comparison?.status === 'unavailable' && <p>{comparison.reason}</p>}
            <p className="canvas-robot-scope">{checked.scope}</p>
          </>
        )}
      </div>
    </Disclosure>
  );
}
