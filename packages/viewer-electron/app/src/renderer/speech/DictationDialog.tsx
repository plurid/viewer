import { useEffect, useRef } from 'react';
import { Dialog } from '../ui/primitives';
import { useDictation } from './useDictation';
import './speech.css';

export function DictationDialog({
  onClose,
  onUse,
  destination,
  held,
  autoStart = true,
  useLabel = 'Insert text',
  maxLength = 16000,
}: {
  onClose(): void;
  onUse(text: string): void;
  destination: string;
  /** A defined value means the invocation came from a held shortcut. */
  held?: boolean;
  autoStart?: boolean;
  useLabel?: string;
  maxLength?: number;
}) {
  const speech = useDictation();
  const initial = useRef(true);
  const transcript = useRef<HTMLTextAreaElement>(null);
  const { start, finish } = speech;
  useEffect(() => {
    if (autoStart) void start();
  }, [autoStart, start]);
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (held === false) void finish();
  }, [held, finish]);
  useEffect(() => {
    if (speech.phase === 'review') transcript.current?.focus();
  }, [speech.phase]);
  const active = ['preparing', 'listening', 'transcribing'].includes(speech.phase);
  const close = () => {
    speech.cancel();
    onClose();
  };
  return (
    <Dialog
      title="Dictate"
      className="speech-dialog"
      onClose={close}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="speech-content">
        <p className="speech-destination">{destination}</p>
        <p className="speech-status" role="status" aria-live="polite">
          {speech.phase === 'preparing'
            ? 'Preparing the microphone…'
            : speech.phase === 'listening'
              ? 'Listening…'
              : speech.phase === 'transcribing'
                ? speech.processing?.kind === 'hosted'
                  ? `Transcribing with ${speech.processing.providerName}…`
                  : 'Transcribing on this device…'
                : speech.phase === 'review'
                  ? speech.text
                    ? 'Review your words before inserting.'
                    : 'No speech detected. Move closer to the microphone and try again.'
                  : 'Record up to one minute at a time.'}
        </p>
        {(speech.phase === 'listening' || speech.phase === 'transcribing') && (
          <div className="speech-level-row">
            <meter min="0" max="0.3" value={speech.level} aria-label="Microphone level" />
            <span>{Math.floor(speech.seconds)} / 60 s</span>
          </div>
        )}
        {speech.error && (
          <p className="error" role="alert">
            {speech.error}
          </p>
        )}
        {speech.phase === 'review' && (
          <label className="speech-transcript">
            Transcript
            <textarea
              ref={transcript}
              data-autofocus
              aria-label="Transcript"
              maxLength={maxLength}
              rows={6}
              value={speech.text}
              onChange={(event) => speech.setText(event.target.value)}
            />
          </label>
        )}
        <p className="muted">
          {speech.processing?.kind === 'hosted'
            ? speech.phase === 'review' || speech.phase === 'transcribing'
              ? `This recording was sent to ${speech.processing.providerName} at ${speech.processing.endpoint} using ${speech.processing.model} for transcription.`
              : `Finishing or releasing the shortcut sends this recording to ${speech.processing.providerName} at ${speech.processing.endpoint} using ${speech.processing.model}.`
            : speech.processing?.kind === 'local'
              ? 'Audio stays in memory on this device and is transcribed locally.'
              : 'Your Speech settings determine where this recording is transcribed.'}{' '}
          Inserting text does not send a message or run a command.
        </p>
        {speech.phase === 'failed' && (
          <button
            type="button"
            onClick={() => {
              close();
              void window.viewer.openSettings('settings.speech');
            }}
          >
            Open speech settings
          </button>
        )}
      </div>
      <footer>
        <button type="button" onClick={close}>
          {active ? 'Cancel recording' : 'Cancel'}
        </button>
        {speech.phase === 'listening' ? (
          <button type="button" className="primary" onClick={() => void speech.finish()}>
            {speech.processing?.kind === 'hosted' ? 'Finish and transcribe' : 'Finish recording'}
          </button>
        ) : (
          !active && (
            <button type="button" onClick={() => void speech.start()}>
              {speech.phase === 'review' ? 'Record again' : 'Start recording'}
            </button>
          )
        )}
        {speech.phase === 'review' && (
          <button
            type="button"
            className="primary"
            disabled={!speech.text.trim() || speech.text.trim().length > maxLength}
            onClick={() => {
              onUse(speech.text.trim());
              close();
            }}
          >
            {useLabel}
          </button>
        )}
      </footer>
    </Dialog>
  );
}
