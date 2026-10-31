import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CommandContext } from '../commands/registry';
import type { SpokenStep } from '../../domain/command-line/spoken';
import type { SpeechProcessing } from '../../domain/speech/recognition';
import type { SpokenSession, SpokenStepStatus } from './spoken';
import { spokenText } from '../../domain/command-line/spoken';
import { listText } from '../../domain/fabrication/plan';
import { useCommands } from '../commands/context';
import { getState } from '../state/store';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/primitives';
import { useDictation } from '../speech/useDictation';
import {
  askSpoken,
  closeSpoken,
  pressSpoken,
  runOffered,
  spokenCommands,
  spokenSession,
  stopSpoken,
  subscribeSpoken,
} from './spoken';
import '../speech/speech.css';
import './spoken.css';

/** The longest request read into a plan. */
const transcriptLimit = 2000;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "Check Job 1042, then prepare its cut sheets", as a button reads it. */
const planLabel = (steps: readonly SpokenStep[]) => spokenText(steps).replace(/\.$/, '');

/** Where the recording went, as the Speech settings chose. */
function processedText(processing: SpeechProcessing | undefined, done: boolean): string {
  if (processing?.kind !== 'hosted') return 'Transcribed on this Mac; the audio stayed in memory.';
  const where = `${processing.providerName} at ${processing.endpoint} using ${processing.model}`;
  return done
    ? `Sent to ${where} for transcription.`
    : `Finishing sends the recording to ${where}.`;
}

/**
 * ASK VIEWER BY VOICE: records through the Speech settings' provider, under its own audio
 * permission, while the Dictate shortcut is held or until Finish. The transcript shows as soon as
 * it arrives, then the plan in words and each step as it runs (spoken.ts). It is no dialog: the
 * check and the planes the plan opens stay in reach.
 */
export function SpokenRequest({
  target,
  held,
  onRecording,
  onEdit,
  onClose,
}: {
  /** The workspace, plane and folder spoken about: moving away while speaking stops it. */
  target: string;
  /** From a held shortcut, false once it is released; undefined for a click. */
  held?: boolean;
  onRecording(recording: boolean): void;
  onEdit(text: string): void;
  onClose(): void;
}) {
  const registry = useCommands();
  const speech = useDictation();
  const session = useSyncExternalStore(subscribeSpoken, spokenSession);
  // what the person looked at as they began to speak: the plan runs on it
  const [spokenAt] = useState(() => ({
    target,
    context: registry.context(getState().activePane),
  }));
  const [moved, setMoved] = useState(false);
  const asked = useRef(false);
  const initial = useRef(true);
  const { start, finish, cancel, phase, text } = speech;
  // idle again after preparing: the keys came up before the microphone was ready
  const prepared = useRef(false);
  if (phase === 'preparing') prepared.current = true;
  const early = phase === 'idle' && prepared.current;
  const recording = (phase === 'idle' && !early) || phase === 'preparing' || phase === 'listening';
  const active = recording || phase === 'transcribing';
  useEffect(() => {
    closeSpoken();
    void start();
    // asking each command here starts counting what a folder no plane shows holds, while the
    // person speaks: the plan then finds the check offered
    if (spokenAt.context) spokenCommands(registry, spokenAt.context);
    return closeSpoken;
  }, [start, registry, spokenAt.context]);
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (held === false) void finish();
  }, [held, finish]);
  useEffect(() => {
    if (target === spokenAt.target || !active) return;
    cancel();
    setMoved(true);
  }, [target, spokenAt.target, active, cancel]);
  useEffect(() => onRecording(recording && !moved), [recording, moved, onRecording]);
  const words = text.trim();
  useEffect(() => {
    if (phase !== 'review' || !words || words.length > transcriptLimit || asked.current) return;
    asked.current = true;
    if (spokenAt.context) void askSpoken(words, spokenAt.context, registry);
  }, [phase, words, spokenAt.context, registry]);
  useEffect(() => {
    if (!active) return;
    // Escape stops a recording wherever the focus is, as closing the dictation dialog does
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
      onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [active, cancel, onClose]);
  const close = () => {
    cancel();
    onClose();
  };
  const own = phase === 'review' && session?.transcript === words ? session : undefined;
  const running = own && ['reading', 'running', 'waiting'].includes(own.stage);
  const editable = phase === 'review' && !!words;
  const footer = (phase === 'listening' || (active && !moved) || running || editable) && (
    <>
      {phase === 'listening' && (
        <Button variant="primary" onClick={() => void finish()}>
          {speech.processing?.kind === 'hosted' ? 'Finish and transcribe' : 'Finish'}
        </Button>
      )}
      {active && !moved && (
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
      )}
      {running && (
        <Button variant="secondary" onClick={stopSpoken}>
          Stop
        </Button>
      )}
      {editable && (
        <Button
          variant="secondary"
          onClick={() => {
            closeSpoken();
            onEdit(words);
          }}
        >
          Edit as text
        </Button>
      )}
    </>
  );
  return (
    <Panel
      className="spoken-request"
      label="Ask Viewer by voice"
      title="Ask Viewer"
      onClose={close}
      footer={footer}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      {moved ? (
        <p role="status">
          You moved to another plane while speaking, so Viewer stopped. Speak again.
        </p>
      ) : early ? (
        <p role="status">
          The keys came up before the microphone was ready. Hold them while you speak.
        </p>
      ) : phase === 'failed' ? (
        <>
          <p className="error" role="alert">
            {speech.error}
          </p>
          <button
            type="button"
            onClick={() => {
              close();
              void window.viewer.openSettings('settings.speech');
            }}
          >
            Open speech settings
          </button>
        </>
      ) : phase !== 'review' ? (
        <>
          <p className="spoken-status" role="status" aria-live="polite">
            {phase === 'listening'
              ? held
                ? 'Listening. Release the keys to send it.'
                : 'Listening. Choose Finish when you are done.'
              : phase === 'transcribing'
                ? speech.processing?.kind === 'hosted'
                  ? `Transcribing with ${speech.processing.providerName}…`
                  : 'Transcribing on this Mac…'
                : 'Preparing the microphone…'}
          </p>
          {(phase === 'listening' || phase === 'transcribing') && (
            <div className="speech-level-row">
              <meter min="0" max="0.3" value={speech.level} aria-label="Microphone level" />
              <span>{Math.floor(speech.seconds)} / 60 s</span>
            </div>
          )}
          {speech.processing && (
            <p className="muted spoken-note">{processedText(speech.processing, false)}</p>
          )}
        </>
      ) : !words ? (
        <p role="status">No speech came through. Move closer to the microphone and try again.</p>
      ) : (
        <>
          <p className="spoken-transcript">“{words}”</p>
          <p className="muted spoken-note">{processedText(speech.processing, true)}</p>
          {words.length > transcriptLimit ? (
            <p role="status">
              That is more than {transcriptLimit} characters. Ask for less at a time.
            </p>
          ) : (
            own && <Plan session={own} />
          )}
        </>
      )}
    </Panel>
  );
}

/** "Muse Spark planned this from your words; Viewer checked each step against the commands here." */
function readerText(session: SpokenSession): string {
  const { reader } = session;
  if (reader.kind === 'model')
    return `${reader.name} planned this from your words. Viewer checked each step against the commands here.`;
  return `Viewer matched your words to its commands.${reader.note ? ` ${reader.note}` : ''}`;
}

function Plan({ session }: { session: SpokenSession }) {
  const { plan, stage, reader } = session;
  if (stage === 'reading' || !plan)
    return (
      <p className="spoken-status" role="status">
        {reader.kind === 'model'
          ? `${reader.name} is reading your request…`
          : 'Matching your words to Viewer’s commands…'}
      </p>
    );
  if (!plan.steps.length)
    return (
      <>
        <p role="status">
          {plan.problem ?? 'No command here does that. Edit it as text, or ask another way.'}
        </p>
        {session.explanation && reader.kind === 'model' && (
          <p className="muted spoken-note">
            {reader.name}: {session.explanation}
          </p>
        )}
        <p className="muted spoken-note">{readerText(session)}</p>
      </>
    );
  return (
    <>
      <p className="spoken-plan" role="status">
        {spokenText(plan.steps)}
      </p>
      {stage === 'offered' && (
        <div className="spoken-offer">
          <p>
            {plan.mismatch
              ? `${plan.mismatch.named} is not here. ${plan.mismatch.subject} is.`
              : `Viewer has no command for “${plan.unmatched}”, so it waits for you.`}
          </p>
          <button type="button" className="primary" onClick={() => void runOffered()}>
            {planLabel(plan.steps)}
          </button>
        </div>
      )}
      <ol className="spoken-steps">
        {plan.steps.map((step, index) => (
          <Step
            key={step.command}
            step={step}
            status={session.steps[index] ?? { state: 'next' }}
            context={session.context}
            press={() => void pressSpoken(index)}
          />
        ))}
      </ol>
      {stage === 'stopped' && !session.steps.some((item) => item.state === 'failed') && (
        <p className="muted spoken-note">Stopped. What was running goes on in its own panel.</p>
      )}
      <p className="muted spoken-note">{readerText(session)}</p>
    </>
  );
}

const stateText: Record<SpokenStepStatus['state'], string> = {
  next: 'Next',
  running: 'Running',
  done: 'Done',
  press: 'Waits for you',
  failed: 'Did not run',
};
function Step({
  step,
  status,
  context,
  press,
}: {
  step: SpokenStep;
  status: SpokenStepStatus;
  context: CommandContext;
  press(): void;
}) {
  const registry = useCommands();
  const waiting = status.state === 'press';
  // the command as it stands now, for its press: the check it follows may have changed it
  const command = waiting
    ? registry.discover({
        ids: [step.command],
        paneID: context.paneID,
        scope: 'window',
        context,
      })[0]
    : undefined;
  const names = context.selection.map((entry) => entry.name);
  const on = names.length
    ? `On ${listText(names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names)}`
    : undefined;
  return (
    <li className="spoken-step" data-state={status.state}>
      <span className="spoken-step-state">{stateText[status.state]}</span>
      <span className="spoken-step-phrase">{capital(step.phrase)}</span>
      {status.text && <span className="spoken-step-text">{status.text}</span>}
      {step.run === 'press' && status.state === 'next' && (
        <span className="spoken-step-text">It changes files, so it waits for your press.</span>
      )}
      {waiting && (
        <span className="spoken-step-press">
          <button type="button" className="primary" disabled={!command?.available} onClick={press}>
            {command?.label ?? capital(step.phrase)}
          </button>
          <span className="spoken-step-text">
            {command?.available
              ? (command.detail ?? on ?? 'It changes files: Viewer runs it when you press it.')
              : (command?.unavailable ?? 'It is not available here any more.')}
          </span>
        </span>
      )}
    </li>
  );
}
