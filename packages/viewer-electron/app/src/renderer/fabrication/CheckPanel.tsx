import { useEffect, useState, useSyncExternalStore } from 'react';
import type { OperationJob } from '../../domain/contracts';
import type { CheckFinding, CheckOutline, CheckSource } from '../../domain/fabrication/check';
import type { ThicknessGroup } from '../../domain/fabrication/names';
import type { ModelProvider } from '../../domain/services';
import type { CheckPhase, CheckSession } from './check';
import { checkSendingLabels } from '../../domain/fabrication/check';
import { correctionProposal, listText, savedPitches } from '../../domain/fabrication/plan';
import { namedRefs } from '../../domain/fabrication/answer';
import { partValuesText } from '../../domain/fabrication/part-values';
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
import { overlayOpen } from '../ui/modal';
import { Panel, PanelSection } from '../ui/Panel';
import { Button, Row } from '../ui/primitives';
import { useModelPermission } from '../ui/models/ModelDataPermission';
import { startingSheets } from '../layout/nesting/headless';
import { preparedNestings, subscribeNestings } from '../layout/nesting/prepared';
import { useWorkspace } from '../workspace/context';
import {
  cancelCheck,
  cancelHandoff,
  checkCollapsed,
  checkSession,
  chooseCheckProvider,
  clockText,
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
  toggleCheckPanel,
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
 * the handoff (docs/guides/layout.md#check-a-laser-job). Its title bar collapses it to the title
 * and a short status, so the plane behind it shows.
 */
export function CheckPanel() {
  const current = useSyncExternalStore(subscribeCheck, checkSession);
  const collapsed = useSyncExternalStore(subscribeCheck, checkCollapsed);
  // the check belongs to the workspace it was opened in: in another, it waits as it was left
  const workspace = useViewer((state) => state.saved.activeWorkspace);
  if (!current || current.workspaceID !== workspace) return null;
  return <CheckPanelBody current={current} collapsed={collapsed} />;
}

/** The phases that show what is sent and the model, before and around a run. */
const listingPhases: readonly CheckPhase[] = ['ready', 'drawing', 'asking', 'failed'];

/**
 * What the collapsed title bar says after the job: "2 findings, 1 confirmed", or the step that
 * runs and since when, such as the model reading or a thickness nesting for the export.
 */
function collapsedStatus(current: CheckSession): { text: string; since?: number } {
  const result = current.result;
  switch (current.phase) {
    case 'opening':
      return { text: 'Listing the job’s files' };
    case 'comparing':
      return { text: `Comparing with the check at ${clockText(current.checked ?? Date.now())}` };
    case 'empty':
      return { text: 'Nothing to check' };
    case 'ready':
      return { text: `Ready to check ${countText(current.opening?.sources.length ?? 0, 'file')}` };
    case 'drawing':
    case 'asking':
      return { text: current.progress ?? 'Checking', since: current.since };
    case 'failed':
      return { text: 'Not checked' };
    case 'checked': {
      if (current.handoffProgress)
        return { text: current.handoffProgress, since: current.handoffSince };
      if (current.stale)
        return { text: `Changed since ${clockText(current.checked ?? Date.now())}` };
      const findings = result?.findings ?? [];
      const confirmed = findings.filter((item) => item.grade.status === 'confirmed').length;
      return {
        text: findings.length
          ? `${countText(findings.length, 'finding')}, ${confirmed} confirmed`
          : 'No findings',
      };
    }
  }
}

function CheckPanelBody({ current, collapsed }: { current: CheckSession; collapsed: boolean }) {
  const opening = current.opening;
  const job = opening?.job ?? current.nothing?.job;
  const status = collapsedStatus(current);
  return (
    <Panel
      className="check-panel"
      label={`Check ${job ?? 'laser job'}`}
      title={job ? `Check ${job}` : 'Check laser job'}
      status={
        <>
          {status.text}
          <Elapsed since={status.since} />
        </>
      }
      collapsed={collapsed}
      onCollapsedChange={toggleCheckPanel}
      onClose={closeCheck}
      closeLabel="Close the check"
      data-stale={current.phase === 'checked' && current.stale ? true : undefined}
      onKeyDown={(event) => {
        // a menu or dialog inside keeps its own Escape; a running tour takes it first
        if (event.key !== 'Escape' || event.defaultPrevented || overlayOpen()) return;
        event.preventDefault();
        event.stopPropagation();
        closeCheck();
      }}
    >
      {current.phase === 'opening' && (
        <p className="muted" role="status">
          Listing the job’s files…
        </p>
      )}
      {current.phase === 'comparing' && (
        <p className="muted" role="status">
          Comparing {job}’s files with the check at {clockText(current.checked ?? Date.now())}…
        </p>
      )}
      {current.phase === 'empty' && (
        <p className="check-summary" role="status">
          {current.nothing?.text}
        </p>
      )}
      {opening && listingPhases.includes(current.phase) && <Inventory current={current} />}
      {(current.phase === 'drawing' || current.phase === 'asking') && (
        <div className="check-progress" role="status">
          <span>
            {current.progress}
            <Elapsed since={current.since} />
          </span>
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
    </Panel>
  );
}

/** " · 34 s": how long the current step has run, counted each second. */
function Elapsed({ since }: { since?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  if (since === undefined) return null;
  return <span className="tabular"> · {Math.max(0, Math.floor((now - since) / 1000))} s</span>;
}

/**
 * "“60” marked on the drawing", "“60” in a box from Muse Spark", "Feature: outline from SAM 3.1,
 * confidence 87%".
 */
function outlineText(outline: CheckOutline): string {
  const quoted = outline.quote ? `“${outline.quote}”` : 'The text';
  const what =
    outline.kind !== 'text'
      ? `Feature: ${outline.label}`
      : outline.source === 'page-text'
        ? `${quoted} marked on the drawing`
        : `${quoted} in a ${outline.label}`;
  const confidence =
    outline.confidence === undefined ? '' : `, confidence ${Math.round(outline.confidence * 100)}%`;
  return `${what}${confidence}${outline.note ? `. ${outline.note}` : ''}`;
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
      <PanelSection title="Sent to the model">
        <ul className="check-files">
          {opening.sources.map((source) => (
            <li key={source.ref} data-ref={source.ref}>
              <span className="check-file" title={source.path}>
                {source.name}
              </span>
              <span className="muted">{sendingOf(source)}</span>
            </li>
          ))}
        </ul>
        <p className="muted check-note">
          The model sees each file by its name, never its folder. Viewer measures every DXF itself
          and grades each finding.
        </p>
        {opening.skipped.length > 0 && (
          <p className="muted check-note">
            Left out: {opening.skipped.map((item) => `${item.name} (${item.reason})`).join(', ')}.
          </p>
        )}
      </PanelSection>
      <PanelSection label="Model">
        {pictures.length ? (
          <Row
            label="Model"
            detail={
              provider && (
                <>
                  Sends {modelDataLabels.images} to{' '}
                  <span className="check-endpoint">{modelEndpoint(provider)}</span>.
                </>
              )
            }
            control={
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
            }
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
      </PanelSection>
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
      {!loading && !allowed && (
        <Row
          as="div"
          compact
          role="status"
          className="check-permission"
          label={
            permission
              ? `${provider.name} may receive ${modelDataLabels[permission.level]}; this check also sends pictures.`
              : `${provider.name} may not receive file data yet.`
          }
          control={
            <Button
              variant="secondary"
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
            </Button>
          }
        />
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

/**
 * When a result shown again was checked, "Checked at 22:14 · Run again", or what changed in the
 * job since, which makes it out of date: then nothing below is acted on until it runs again.
 */
function Since({ current }: { current: CheckSession }) {
  const at = clockText(current.checked ?? Date.now());
  const again = (
    <button type="button" onClick={() => void runCheck()}>
      Run again
    </button>
  );
  return current.stale ? (
    <div className="check-stale" role="status">
      <p>{current.stale} The findings below are from before.</p>
      {again}
    </div>
  ) : (
    <p className="muted check-note check-since">
      Checked at {at} · {again}
    </p>
  );
}

function Result({ current }: { current: CheckSession }) {
  const result = current.result!;
  const jobs = useViewer((state) => state.jobs);
  const workspace = useWorkspace();
  const confirmed = result.findings.filter((item) => item.grade.status === 'confirmed').length;
  const notSent = [...current.problems, ...result.notSent];
  const stale = !!current.stale;
  const shownAgain = current.kept || stale;
  return (
    <>
      {shownAgain && <Since current={current} />}
      <PanelSection label="Summary">
        <p className="check-summary">
          {result.summary
            ? namedRefs(result.summary, current.opening!.sources)
            : 'The model gave no summary.'}
        </p>
        <p className="muted check-note">
          {result.provider.name} · {result.provider.model} · {result.seconds} s ·{' '}
          {result.findings.length
            ? `${countText(result.findings.length, 'finding')}, ${confirmed} confirmed by Viewer`
            : 'no findings'}
        </p>
        {notSent.length > 0 && <p className="muted check-note">Not sent: {notSent.join(' ')}</p>}
      </PanelSection>
      {result.findings.length > 0 && (
        <PanelSection
          label="Findings"
          title={stale ? `Findings from ${clockText(current.checked ?? Date.now())}` : 'Findings'}
        >
          <ol className="check-findings">
            {result.findings.map((item) => (
              <Finding key={item.finding.id} item={item} current={current} jobs={jobs} />
            ))}
          </ol>
        </PanelSection>
      )}
      {result.issues.length > 0 && (
        <PanelSection title="Notes on the answer">
          <ul className="check-notes">
            {result.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </PanelSection>
      )}
      <PanelSection title="Tour">
        <p className="check-note">
          {result.tour.stops.length
            ? `${countText(result.tour.stops.length, 'stop')} through the job’s files, each finding with Viewer’s grade.`
            : 'The answer plans no tour.'}
          {result.tour.skipped.length > 0 && ` ${result.tour.skipped.join(' ')}`}
        </p>
        <button
          type="button"
          disabled={stale || !result.tour.stops.length}
          onClick={(event) => {
            // the panel goes down to its title bar: focus stays in it, and comes back there
            event.currentTarget
              .closest('.check-panel')
              ?.querySelector<HTMLButtonElement>('.check-panel-toggle')
              ?.focus();
            playCheckTour(workspace);
          }}
        >
          Play the tour
        </button>
      </PanelSection>
      <CutSheets current={current} jobs={jobs} />
      <Handoff current={current} jobs={jobs} />
      {!shownAgain && (
        <footer className="check-actions">
          <button type="button" onClick={() => void runCheck()}>
            Run again
          </button>
        </footer>
      )}
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
        <span className="check-finding-summary">
          {namedRefs(finding.summary, current.opening!.sources)}
        </span>
      </div>
      {item.readings ? (
        <ul className="check-readings" aria-label={`Readings of ${finding.id}`}>
          {item.readings.map((reading) => (
            <li key={reading.finding.id}>
              <span className="tour-grade" data-grade={reading.grade.status}>
                {findingGradeLabels[reading.grade.status]}
              </span>
              <span className="check-reason">
                {reading.finding.drawing?.quote ? `“${reading.finding.drawing.quote}”: ` : ''}
                {reading.grade.reason}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="check-reason">{grade.reason}</p>
      )}
      {item.origin === 'viewer' && (
        <p className="muted check-note">
          {item.unread
            ? 'Raised by Viewer, from what the answer leaves out of the request.'
            : 'Raised by Viewer, comparing what the job itself says.'}
        </p>
      )}
      {where.length > 0 && <p className="muted check-note">{where.join(' · ')}</p>}
      {item.outlines.map((outline, index) => (
        <p key={`${outline.stop}-${index}`} className="muted check-note">
          {outlineText(outline)}
        </p>
      ))}
      {correction && (
        <div className="check-correction" aria-label={`Correction for ${finding.id}`}>
          <p>
            <strong>Proposed:</strong> {correctionProposal(correction.plan, correction.name)}.
          </p>
          {current.corrections[finding.id] ? (
            <p className="check-note" role="status">
              {jobStatus(job, (done) => {
                const report = done.completed[0]?.correction;
                return report
                  ? `Saved: ${savedPitches(report).replace(/^P/, 'p')}, measured again.`
                  : 'Saved.';
              })}
            </p>
          ) : (
            <button
              type="button"
              disabled={!!current.stale}
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
    <PanelSection title="Cut sheets">
      <ul className="check-parts">
        {parts.map((part) => (
          <li key={part.ref} data-question={part.question ? true : undefined}>
            <span className="check-file">
              {copies.has(part.path) ? `${part.name}, corrected copy` : part.name}
            </span>
            <span className="muted">
              {part.question ??
                partValuesText(part) ??
                'Nothing in the job gives its quantity or thickness.'}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={!!current.stale || !parts.length}
        onClick={() => prepareCutSheets(workspace)}
      >
        Prepare cut sheets
      </button>
    </PanelSection>
  );
}

/** "6 mm is not nested yet: the export nests it first on 1250 × 2500 mm sheets." */
function missingText(missing: readonly ThicknessGroup<string>[]): string {
  const one = missing.length === 1;
  const sheets = new Set(missing.map((group) => startingSheets(group.thickness)));
  return (
    `${listText(missing.map((group) => group.label))} ${one ? 'is' : 'are'} not nested yet: ` +
    `the export nests ${one ? 'it' : 'them'} first on ${listText([...sheets])} sheets. ` +
    'To choose the sheets yourself, prepare the cut sheets and wait for Checked.'
  );
}

/**
 * The handoff: what the folder holds, then Export handoff; when a thickness is not nested yet,
 * Nest and export handoff nests it first, saying which thickness and how much while it runs.
 */
function Handoff({ current, jobs }: { current: CheckSession; jobs: readonly OperationJob[] }) {
  // a Layout plane checking a nesting changes what the export saves, and what it nests first
  const prepared = useSyncExternalStore(subscribeNestings, preparedNestings);
  const { nestings, notes, missing, hold } = handoffNestings(current, jobs, prepared);
  const job = jobs.find((entry) => entry.id === current.handoff);
  const corrections = correctedCopies(current, jobs).size;
  const files = current.opening!.sources.length + corrections;
  const sheets = nestings.map(
    (nesting) => `“${nesting.title}” on ${countText(nesting.plan.sheets.length, 'sheet')}`,
  );
  return (
    <PanelSection title="Handoff">
      <p className="check-note">
        A folder for the shop: {countText(files, 'file')} as evidence, the tour pointed at them, the
        check record{sheets.length ? `, and ${listText(sheets)}` : ''}.
      </p>
      {notes.map((note) => (
        <p key={note} className="muted check-note">
          {note}
        </p>
      ))}
      {!current.handoff && missing.length > 0 && (
        <p className="check-note">{hold ?? missingText(missing)}</p>
      )}
      {current.handoff ? (
        <p className="check-note" role="status">
          {jobStatus(job, (done) => {
            const folder = done.completed[0]?.destination;
            return folder ? `Saved “${fileName(folder)}”.` : 'Saved.';
          })}
        </p>
      ) : current.handoffProgress ? (
        <div className="check-progress" role="status">
          <span>
            {current.handoffProgress}
            <Elapsed since={current.handoffSince} />
          </span>
          <button type="button" onClick={cancelHandoff}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!!current.stale || !!hold}
          onClick={() => void exportHandoff()}
        >
          {missing.length ? 'Nest and export handoff' : 'Export handoff'}
        </button>
      )}
      {current.handoffError && (
        <p className="error" role="alert">
          {current.handoffError}
        </p>
      )}
    </PanelSection>
  );
}
