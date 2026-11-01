import { useEffect, useState } from 'react';
import type { CanvasDocument } from '../../domain/canvases/document';
import type { RobotComparisonReport, RobotComparisonSide } from '../../domain/robotics/task';
import { errorMessage } from '../../domain/errors';
import { Disclosure } from '../ui/Disclosure';

const millimetres = (value: number) => (value * 1000).toFixed(3) + ' mm';
function measured(side: RobotComparisonSide, targetID: string) {
  const pose = side.report.poses.find((pose) => pose.targetID === targetID)!;
  return `${millimetres(pose.residual)} · ${pose.withinTolerance && !pose.violations.length ? 'Passed' : 'Needs review'}`;
}

export function RobotComparisonPanel({
  document,
  busy,
  onSave,
}: {
  document: CanvasDocument;
  busy: boolean;
  onSave(): void;
}) {
  const originalID = document.fork!.id;
  const [originalVersion, setOriginalVersion] = useState('');
  const key = JSON.stringify([
    document.id,
    document.revision,
    document.stateRevision,
    document.robotCheck,
    originalVersion,
  ]);
  const [result, setResult] = useState<{
    key: string;
    report?: RobotComparisonReport;
    error?: string;
  }>();
  useEffect(
    () =>
      window.viewer.onEvent((event) => {
        if (event.type === 'canvas' && event.document.id === originalID)
          setOriginalVersion(
            JSON.stringify([
              event.document.revision,
              event.document.stateRevision,
              event.document.robotCheck,
            ]),
          );
      }),
    [originalID],
  );
  useEffect(() => {
    let live = true;
    void window.viewer
      .canvas({ kind: 'robot-comparison', id: document.id })
      .then((reply) => {
        if (live) setResult({ key, report: reply.robotComparison });
      })
      .catch((error: unknown) => {
        if (live) setResult({ key, error: errorMessage(error) });
      });
    return () => {
      live = false;
    };
  }, [document.id, key]);
  const current = result?.key === key ? result : undefined;
  const report = current?.report;
  return (
    <section
      aria-label="Base placement comparison"
      className="canvas-robot-comparison"
      data-state={report?.status ?? 'checking'}
    >
      <Disclosure variant="compact" summary="Compare base placements">
        <div className="canvas-robot-report">
          <header>
            <strong>Base placements</strong>
            <button disabled={busy || report?.status !== 'compared'} onClick={onSave}>
              Save comparison JSON…
            </button>
          </header>
          {!current && <p role="status">Comparing saved poses…</p>}
          {current?.error && <p role="alert">{current.error}</p>}
          {report?.status === 'unavailable' && <p>{report.reason}</p>}
          {report?.status === 'compared' && (
            <>
              <p>
                Same model, fixed world targets, tool point and tolerance. A miss does not prove
                unreachability.
              </p>
              <table>
                <caption>
                  Endpoint error and joint limits only. Replay and movement between poses are
                  unchecked.
                </caption>
                <thead>
                  <tr>
                    <th>Target</th>
                    {(
                      [
                        ['Original', report.original],
                        ['This alternative', report.alternative],
                      ] as const
                    ).map(([label, side]) => (
                      <th key={side.id}>
                        {label}
                        <small>Base {side.report.input.base.xyz.join(', ')} m</small>
                        {side.report.input.base.rpy.some((value) => value !== 0) && (
                          <small>Rotation {side.report.input.base.rpy.join(', ')} rad</small>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.original.report.input.targets.map((target) => (
                    <tr key={target.id}>
                      <th scope="row">{target.id}</th>
                      <td>{measured(report.original, target.id)}</td>
                      <td>{measured(report.alternative, target.id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </Disclosure>
    </section>
  );
}
