import { useState, useSyncExternalStore } from 'react';
import type { OperationJob } from '../../domain/contracts';
import type { CheckFinding, CheckSource } from '../../domain/fabrication/check';
import type { ModelProvider } from '../../domain/services';
import type { CheckSession } from './check';
import { checkSendingLabels } from '../../domain/fabrication/check';
import { millimetreText } from '../../domain/fabrication/plan';
import { countText } from '../../domain/layout/nesting/format';
import {
  modelDataLabels,
  modelEndpoint,
  modelPermissionCovers,
} from '../../domain/models/permissions';
import { providerTakesImages } from '../../domain/models/providers';
import { fileName, findingGradeLabels } from '../../domain/tours/tour';
import { errorMessage } from '../../domain/errors';
import { report, useViewer } from '../state/store';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { IconButton } from '../ui/primitives';
import { useModelPermission } from '../ui/models/ModelDataPermission';
import { useWorkspace } from '../workspace/context';
import {
  cancelCheck,
  checkSession,
  chooseCheckProvider,
  closeCheck,
  correctedCopies,
  cutSheets,
  exportHandoff,
  handoffNestings,
  playCheckTour,
  prepareCutSheets,
  runCheck,
  saveCorrection,
  subscribeCheck,
} from './check';
import './check.css';

/** How an operation the check started stands, in words. */
function jobStatus(job: OperationJob | undefined, done: (job: OperationJob) => string): string {
  if (!job) return 'Starting…';
  if (job.status === 'completed') return done(job);
  if (job.status === 'failed' || job.status === 'cancelled')
    return job.errors[0]?.message ?? (job.status === 'failed' ? 'It failed.' : 'Cancelled.');
  return job.detail ?? 'Saving…';
}

/**
 * CHECK A LASER JOB: what will be sent, to which model and at which data level, then Run; the
 * findings with Viewer's grade and reason, each correction for review, the tour, the cut sheets and
 * the handoff (docs/guides/layout.md#check-a-laser-job).
 */
export function CheckPanel() {
  const current = useSyncExternalStore(subscribeCheck, checkSession);
  if (!current) return null;
  return <CheckPanelBody current={current} />;
}

function CheckPanelBody({ current }: { current: CheckSession }) {
  const opening = current.opening;
  return (
    <aside className="check-panel" aria-label={`Check ${opening?.job ?? 'laser job'}`}>
      <header>
        <h2>{opening ? `Check ${opening.job}` : 'Check laser job'}</h2>
        <IconButton icon="close" label="Close the check" onClick={closeCheck} />
      </header>
      <div className="check-panel-body">
        {current.phase === 'opening' && (
          <p className="muted" role="status">
            Listing the job’s files…
          </p>
        )}
        {opening && current.phase !== 'checked' && <Inventory current={current} />}
        {(current.phase === 'drawing' || current.phase === 'asking') && (
          <div className="check-progress" role="status">
            <span>{current.progress}…</span>
            <button type="button" onClick={cancelCheck}>
              Cancel
            </button>
          </div>
        )}
        {current.phase === 'failed' && (
          <p className="error" role="alert">
            {current.error}
          </p>
        )}
        {current.phase === 'checked' && <Result current={current} />}
      </div>
    </aside>
  );
}

function sendingOf(source: CheckSource) {
  return checkSendingLabels[source.sending];
}

/** What will be sent, to which provider, at which data level; then Run. */
function Inventory({ current }: { current: CheckSession }) {
  const opening = current.opening!;
  const providers = useViewer((state) => state.settings.settings.providers);
  const pictures = providers.filter((provider) => providerTakesImages(provider.kind));
  const provider = pictures.find((item) => item.id === current.providerID);
  const running = current.phase === 'drawing' || current.phase === 'asking';
  return (
    <>
      <section aria-label="What is sent">
        <h3>What is sent</h3>
        <ul className="check-files">
          {opening.sources.map((source) => (
            <li key={source.ref}>
              <span className="check-ref tabular">{source.ref}</span>
              <span className="check-file" title={source.path}>
                {source.name}
              </span>
              <span className="muted">{sendingOf(source)}</span>
            </li>
          ))}
        </ul>
        <p className="muted check-note">
          The model sees each file by its ref and name, never its folder. Viewer measures every DXF
          itself and grades each finding.
        </p>
        {opening.skipped.length > 0 && (
          <p className="muted check-note">
            Left out: {opening.skipped.map((item) => `${item.name} (${item.reason})`).join(', ')}.
          </p>
        )}
      </section>
      <section aria-label="Model">
        <h3>Model</h3>
        {pictures.length ? (
          <ChoiceButton
            label="Model to check with"
            value={current.providerID ?? ''}
            placeholder="Choose a model"
            choices={pictures.map((item) => ({
              value: item.id,
              label: `${item.name} · ${item.model || 'no model ID'}`,
            }))}
            onChoose={chooseCheckProvider}
            disabled={running}
          />
        ) : (
          <p className="check-note">
            A check sends pictures, so it needs Meta, Gemini, OpenRouter or another Chat Completions
            model.{' '}
            <button
              type="button"
              onClick={() => void window.viewer.openSettings('settings.providers').catch(report)}
            >
              Add a model in Settings
            </button>
          </p>
        )}
        {provider && <Permission provider={provider} running={running} current={current} />}
      </section>
    </>
  );
}

function Permission({
  provider,
  running,
  current,
}: {
  provider: ModelProvider;
  running: boolean;
  current: CheckSession;
}) {
  const { permission, loading } = useModelPermission(provider);
  const [busy, setBusy] = useState(false);
  const allowed = modelPermissionCovers(permission, provider, 'images');
  const count = current.opening!.sources.length;
  return (
    <>
      <p className="check-note">
        Sends {modelDataLabels.images} to{' '}
        <span className="check-endpoint">{modelEndpoint(provider)}</span>.
      </p>
      {!loading && !allowed && (
        <p className="check-note" role="status">
          {permission
            ? `${provider.name} may receive ${modelDataLabels[permission.level]}; this check also sends pictures.`
            : `${provider.name} may not receive file data yet.`}{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void window.viewer
                .providerPermissionSet(provider.id, provider.endpoint, 'images')
                .catch(report)
                .finally(() => setBusy(false));
            }}
          >
            Allow pictures for {provider.name}
          </button>
        </p>
      )}
      <footer className="check-actions">
        <button
          type="button"
          className="primary"
          disabled={running || loading || !allowed || !provider.model}
          title={
            !provider.model ? `Enter ${provider.name}’s model ID in Settings → Models.` : undefined
          }
          onClick={() => void runCheck()}
        >
          {current.phase === 'failed' ? 'Run again' : `Check ${countText(count, 'file')}`}
        </button>
      </footer>
    </>
  );
}

function Result({ current }: { current: CheckSession }) {
  const result = current.result!;
  const jobs = useViewer((state) => state.jobs);
  const workspace = useWorkspace();
  const confirmed = result.findings.filter((item) => item.grade.status === 'confirmed').length;
  const notSent = [...current.problems, ...result.notSent];
  return (
    <>
      <section aria-label="Summary">
        <p className="check-summary">{result.summary || 'The model gave no summary.'}</p>
        <p className="muted check-note">
          {result.provider.name} · {result.provider.model} · {result.seconds} s ·{' '}
          {result.findings.length
            ? `${countText(result.findings.length, 'finding')}, ${confirmed} confirmed by Viewer`
            : 'no findings'}
        </p>
        {notSent.length > 0 && <p className="muted check-note">Not sent: {notSent.join(' ')}</p>}
      </section>
      {result.findings.length > 0 && (
        <section aria-label="Findings">
          <h3>Findings</h3>
          <ol className="check-findings">
            {result.findings.map((item) => (
              <Finding key={item.finding.id} item={item} current={current} jobs={jobs} />
            ))}
          </ol>
        </section>
      )}
      {result.issues.length > 0 && (
        <section aria-label="Notes on the answer">
          <h3>Notes on the answer</h3>
          <ul className="check-notes">
            {result.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Tour">
        <h3>Tour</h3>
        <p className="check-note">
          {result.tour.stops.length
            ? `${countText(result.tour.stops.length, 'stop')} through the job’s files, each finding with Viewer’s grade.`
            : 'The answer plans no tour.'}
          {result.tour.skipped.length > 0 && ` ${result.tour.skipped.join(' ')}`}
        </p>
        <button
          type="button"
          disabled={!result.tour.stops.length}
          onClick={() => playCheckTour(workspace)}
        >
          Play the tour
        </button>
      </section>
      <CutSheets current={current} jobs={jobs} />
      <Handoff current={current} jobs={jobs} />
      <footer className="check-actions">
        <button type="button" onClick={() => void runCheck()}>
          Run again
        </button>
      </footer>
    </>
  );
}

function Finding({
  item,
  current,
  jobs,
}: {
  item: CheckFinding;
  current: CheckSession;
  jobs: readonly OperationJob[];
}) {
  const [error, setError] = useState('');
  const { finding, grade, correction } = item;
  const job = jobs.find((entry) => entry.id === current.corrections[finding.id]);
  const where = [
    item.names.drawing &&
      `${item.names.drawing}${finding.drawing?.page ? `, page ${finding.drawing.page}` : ''}`,
    item.names.dxf,
    item.names.photo,
  ].filter(Boolean);
  return (
    <li className="check-finding">
      <div className="check-finding-head">
        <span className="tour-grade" data-grade={grade.status}>
          {item.question ? 'Question' : findingGradeLabels[grade.status]}
        </span>
        <span className="check-finding-summary">{finding.summary}</span>
      </div>
      <p className="check-reason">{grade.reason}</p>
      {item.origin === 'viewer' && (
        <p className="muted check-note">Raised by Viewer, comparing what the job itself says.</p>
      )}
      {where.length > 0 && <p className="muted check-note">{where.join(' · ')}</p>}
      {item.outlines.map((outline) => (
        <p key={outline.stop} className="muted check-note">
          Outline: {outline.label}
          {outline.confidence === undefined
            ? ''
            : `, confidence ${Math.round(outline.confidence * 100)}%`}
          {outline.note ? `. ${outline.note}` : ''}
        </p>
      ))}
      {correction && (
        <div className="check-correction" aria-label={`Correction for ${finding.id}`}>
          <p>
            <strong>Proposed:</strong> {correction.description.slice(1).join(', ')}.
          </p>
          <p className="muted check-note">Saves {correction.name}; the original is only read.</p>
          {current.corrections[finding.id] ? (
            <p className="check-note" role="status">
              {jobStatus(job, (done) => {
                const report = done.completed[0]?.correction;
                return report
                  ? `Saved: pitch ${millimetreText(report.before)} → ${millimetreText(report.after)}, measured again.`
                  : 'Saved.';
              })}
            </p>
          ) : (
            <button
              type="button"
              onClick={() =>
                void saveCorrection(item).catch((value: unknown) => setError(errorMessage(value)))
              }
            >
              Save {correction.name}
            </button>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function CutSheets({ current, jobs }: { current: CheckSession; jobs: readonly OperationJob[] }) {
  const workspace = useWorkspace();
  const { parts, copies } = cutSheets(current, jobs);
  return (
    <section aria-label="Cut sheets">
      <h3>Cut sheets</h3>
      <ul className="check-parts">
        {parts.map((part) => (
          <li key={part.ref} data-question={part.question ? true : undefined}>
            <span className="check-file">
              {copies.has(part.path) ? `${part.name}, corrected copy` : part.name}
            </span>
            <span className="muted">
              {part.question ??
                ([part.quantity?.text, part.thickness?.text].filter(Boolean).join(' · ') ||
                  'Nothing in the job gives its quantity or thickness.')}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" disabled={!parts.length} onClick={() => prepareCutSheets(workspace)}>
        Prepare cut sheets
      </button>
    </section>
  );
}

function Handoff({ current, jobs }: { current: CheckSession; jobs: readonly OperationJob[] }) {
  const { nestings, notes } = handoffNestings(current, jobs);
  const job = jobs.find((entry) => entry.id === current.handoff);
  const corrections = correctedCopies(current, jobs).size;
  const files = current.opening!.sources.length + corrections;
  return (
    <section aria-label="Handoff">
      <h3>Handoff</h3>
      <p className="check-note">
        A folder for the shop: {countText(files, 'file')} as evidence, the tour pointed at them, the
        check record
        {nestings.length
          ? `, and ${nestings.map((nesting) => `“${nesting.title}” on ${countText(nesting.plan.sheets.length, 'sheet')}`).join(', ')}`
          : ''}
        .
      </p>
      {notes.map((note) => (
        <p key={note} className="muted check-note">
          {note}
        </p>
      ))}
      {current.handoff ? (
        <p className="check-note" role="status">
          {jobStatus(job, (done) => {
            const folder = done.completed[0]?.destination;
            return folder ? `Saved “${fileName(folder)}”.` : 'Saved.';
          })}
        </p>
      ) : (
        <button type="button" onClick={() => void exportHandoff()}>
          Export handoff
        </button>
      )}
      {current.handoffError && (
        <p className="error" role="alert">
          {current.handoffError}
        </p>
      )}
    </section>
  );
}
