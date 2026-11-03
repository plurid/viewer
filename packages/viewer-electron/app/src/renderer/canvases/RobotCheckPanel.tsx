import { useEffect, useState } from 'react';
import type {
  ExperimentDocument as CanvasDocument,
  ExperimentAPI,
} from '../../domain/robotics/experiment-canvases';
import type { RobotCheckReport } from '../../domain/robotics/task';
import { errorMessage } from '../../domain/errors';
import { Disclosure } from '../ui/Disclosure';
import { RobotComparisonPanel } from './RobotComparisonPanel';

export function RobotCheckPanel({
  api,
  document,
  busy,
  group,
  onCheck,
  onSave,
  onSaveComparison,
  onDefinition,
}: {
  api: ExperimentAPI;
  document: CanvasDocument;
  busy: boolean;
  group?: string;
  onCheck(): void;
  onSave(): void;
  onSaveComparison(): void;
  onDefinition(sourceID: string, joint: string): void;
}) {
  const binding = document.robotCheck!;
  const key = JSON.stringify([document.id, document.revision, document.stateRevision, binding]);
  const [result, setResult] = useState<{
    key: string;
    report?: RobotCheckReport;
    error?: string;
  }>();
  useEffect(() => {
    let live = true;
    void api
      .canvas({ kind: 'robot-report', id: document.id })
      .then((reply) => {
        if (live) setResult({ key, report: reply.robotReport });
      })
      .catch((error: unknown) => {
        if (live) setResult({ key, error: errorMessage(error) });
      });
    return () => {
      live = false;
    };
  }, [api, key, document.id]);
  const current = result?.key === key ? result : undefined;
  const report = current?.report;
  const state = !current
    ? 'checking'
    : report?.status === 'checked'
      ? report.passed
        ? 'passed'
        : 'failed'
      : 'stale';
  const label = {
    checking: 'Checking…',
    passed: 'Passed',
    failed: 'Needs review',
    stale: 'Check again',
  }[state];
  const millimetres = (value: number) => (value * 1000).toFixed(3) + ' mm';
  return (
    <section className="canvas-robot-check" aria-label="Robot check" data-state={state}>
      <Disclosure
        variant="compact"
        className="canvas-inspector"
        group={group}
        closeOnEscape
        summary={`Robot check · ${label}`}
      >
        <div className="canvas-robot-report">
          <header>
            <strong>Checked by Viewer</strong>
            <button disabled={busy || state === 'checking'} onClick={onCheck}>
              Check poses
            </button>
            <button disabled={busy || report?.status !== 'checked'} onClick={onSave}>
              Save check JSON…
            </button>
          </header>
          {!current && <p role="status">Checking saved poses…</p>}
          {current?.error && <p role="alert">{current.error}</p>}
          {report?.status === 'stale' && <p>{report.reason}</p>}
          {report?.status === 'checked' && (
            <>
              <p>
                {report.passed ? 'Every target pose meets' : 'Some target poses do not meet'} the{' '}
                {millimetres(report.input.tolerance)} position tolerance and hard joint limits.
              </p>
              <table>
                <caption>World-frame targets in metres; position error in millimetres</caption>
                <thead>
                  <tr>
                    <th>Target (X, Y, Z)</th>
                    <th>Error</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.poses.map((pose) => (
                    <tr key={pose.targetID}>
                      <th scope="row">
                        {pose.targetID}
                        <small>
                          {report.input.targets
                            .find((t) => t.id === pose.targetID)!
                            .position.map((v) => v.toFixed(4))
                            .join(', ')}
                        </small>
                      </th>
                      <td>{millimetres(pose.residual)}</td>
                      <td>
                        {pose.withinTolerance && !pose.violations.length ? (
                          'Passed'
                        ) : (
                          <>
                            {!pose.withinTolerance && <span>Position outside tolerance</span>}
                            {pose.violations.map((v) => (
                              <button
                                key={v.joint}
                                onClick={() => onDefinition(binding.sourceID, v.joint)}
                              >
                                {v.joint}: {v.value.toFixed(3)} {v.unit}, limit {v.lower.toFixed(3)}{' '}
                                to {v.upper.toFixed(3)}
                              </button>
                            ))}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Tool: {report.input.tool.link} · offset {report.input.tool.point.join(', ')} m.
                Base: {report.input.base.xyz.join(', ')} m; rotation{' '}
                {report.input.base.rpy.join(', ')} rad.
              </p>
              <p className="canvas-robot-scope">
                Endpoint positions and hard joint limits only. Orientation, movement between poses,
                collision and physical operation are not checked.
              </p>
            </>
          )}
        </div>
      </Disclosure>
      {document.fork && (
        <RobotComparisonPanel
          api={api}
          document={document}
          busy={busy}
          group={group}
          onSave={onSaveComparison}
        />
      )}
    </section>
  );
}
