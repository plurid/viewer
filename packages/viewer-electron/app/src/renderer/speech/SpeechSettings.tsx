import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechModel } from '../../domain/speech/models';
import {
  speechLanguages,
  type SpeechPreferences,
  type SpeechRequest,
  type SpeechStatus,
} from '../../domain/speech/recognition';
import { errorMessage } from '../../domain/errors';
import { DictationDialog } from './DictationDialog';
import { Loading } from '../ui/primitives';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { defaultShortcuts } from '../../domain/preferences/shortcuts';
import { useMicrophones } from './devices';
import './speech.css';
import { HostedSpeechSettings } from './HostedSpeechSettings';

const descriptions: Record<string, string> = {
  'whisper-tiny':
    'Fastest and smallest. Useful for short English phrases; other languages can need more corrections.',
  'whisper-base': 'A small multilingual model for everyday dictation.',
  'whisper-small':
    'More accurate multilingual dictation. Uses more memory and takes longer to transcribe.',
};
export function SpeechSettings({ shortcut = defaultShortcuts.dictate! }: { shortcut?: string }) {
  const [status, setStatus] = useState<SpeechStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const microphones = useMicrophones();
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const value = await window.viewer.speech({ kind: 'status' });
      if (id === sequence.current && value && 'models' in value) setStatus(value);
    } catch (error) {
      if (id === sequence.current) setError(errorMessage(error));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'speech-changed') {
        void refresh();
      }
    });
    const pending = sequence;
    return () => {
      pending.current++;
      stop();
    };
  }, [refresh]);
  const request = async (request: SpeechRequest) => {
    setBusy(true);
    setError('');
    try {
      await window.viewer.speech(request);
      await refresh();
      return true;
    } catch (error) {
      setError(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const preference = (change: Partial<SpeechPreferences>) => {
    if (status)
      void request({
        kind: 'preferences',
        preferences: { ...status.preferences, ...change },
      }).catch(() => {});
  };
  if (!status)
    return error ? (
      <p className="error" role="alert">
        {error} <button onClick={() => void refresh()}>Retry</button>
      </p>
    ) : (
      <Loading label="Reading speech settings…" />
    );
  const active = status.setup.filter((task) => task.state === 'running');
  const model = (item: SpeechModel & { installed: boolean; selected: boolean }) => {
    const record = status.models.records.findLast((record) => record.model === item.id);
    const task = active.find((task) => task.model === item.id);
    const latest = status.setup.findLast((task) => task.model === item.id);
    const failure = latest?.state === 'failed' ? latest : undefined;
    return (
      <section className="speech-model" key={item.id} aria-label={item.name}>
        <div className="speech-model-heading">
          <strong>
            {item.name}
            {item.id === 'whisper-small' ? ' · Recommended' : ''}
          </strong>
          <span>
            {Math.round(item.bytes / 1024 ** 2)} MiB ·{' '}
            {item.selected ? 'Selected' : item.installed ? 'Installed' : 'Not installed'}
          </span>
        </div>
        <p className="settings-note">{descriptions[item.id]}</p>
        {task && (
          <>
            <progress
              aria-label={'Installing ' + item.name}
              max={item.bytes}
              value={record?.received ?? 0}
            />
            <p className="settings-note" role="status">
              {record?.status === 'downloading'
                ? `Downloaded ${Math.round(record.received / 1024 ** 2)} of ${Math.round(item.bytes / 1024 ** 2)} MiB. Verifying before use.`
                : 'Preparing model…'}
            </p>
          </>
        )}
        {failure && !task && (
          <p className="error" role="alert">
            {failure.message}
          </p>
        )}
        <div className="speech-model-actions">
          {task ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void request({ kind: 'cancel-setup', id: task.id })}
            >
              Cancel download
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy || item.selected}
                onClick={() =>
                  void request({
                    kind: 'setup',
                    action: item.installed ? 'use' : 'install',
                    model: item.id,
                  })
                }
              >
                {item.selected ? 'Selected' : item.installed ? 'Use model' : 'Download and use'}
              </button>
              {!item.installed && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void request({ kind: 'setup', action: 'import', model: item.id })}
                >
                  Import verified weights…
                </button>
              )}
            </>
          )}
        </div>
      </section>
    );
  };
  return (
    <>
      <p className="settings-note">
        Speak into Ask Viewer, notes or chat, then review the transcript. Choose local recognition
        or a hosted provider. Your microphone opens only when you start a recording.
      </p>
      <div className="settings-row">
        <span>Transcribe with</span>
        <ChoiceButton
          label="Speech processing"
          value={status.preferences.backend ?? 'local'}
          disabled={busy}
          choices={[
            { value: 'local', label: 'Local Whisper' },
            { value: 'hosted', label: 'Hosted provider' },
          ]}
          onChoose={(value) => preference({ backend: value as 'local' | 'hosted' })}
        />
      </div>
      {status.preferences.backend !== 'hosted' && !status.models.runtime.recognitionAvailable && (
        <p className="error" role="alert">
          {status.models.runtime.reason}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status.preferences.backend === 'hosted' ? (
        <HostedSpeechSettings
          snapshot={status.hosted ?? { providers: [] }}
          selectedID={status.preferences.providerID}
          busy={busy}
          request={request}
          select={(providerID) => preference({ providerID })}
        />
      ) : (
        <>
          <h2>Local speech model</h2>
          <p className="settings-note">
            Download weights once, or import the matching GGML file. Viewer checks the pinned size
            and checksum. Cancelled downloads are retained and cannot be used.
          </p>
          {status.models.models.map(model)}
        </>
      )}
      <h2>Recording</h2>
      <div className="speech-preferences">
        <label className="settings-row">
          <span>Language</span>
          <ChoiceButton
            label="Speech language"
            value={status.preferences.language}
            disabled={busy}
            choices={speechLanguages.map(([value, label]) => ({ value, label }))}
            onChoose={(value) => preference({ language: value as SpeechPreferences['language'] })}
          />
        </label>
        <label className="settings-row">
          <span>Microphone</span>
          <ChoiceButton
            label="Speech microphone"
            value={status.preferences.microphone}
            disabled={busy}
            choices={[
              { value: '', label: 'System default' },
              ...microphones
                .filter((item) => item.deviceId !== 'default' && item.deviceId)
                .map((item, index) => ({
                  value: item.deviceId,
                  label: item.label || `Microphone ${index + 1}`,
                })),
              ...(status.preferences.microphone &&
              !microphones.some((item) => item.deviceId === status.preferences.microphone)
                ? [
                    {
                      value: status.preferences.microphone,
                      label: 'Saved microphone · unavailable',
                    },
                  ]
                : []),
            ]}
            onChoose={(microphone) => preference({ microphone })}
          />
        </label>
      </div>
      <p className="settings-note">
        Microphone access:{' '}
        {status.microphone === 'not-determined' ? 'not requested yet' : status.microphone}. Device
        names become available after microphone access is granted. A missing selected microphone
        never silently switches to another device.
      </p>
      <p className="settings-note">
        {shortcut ? (
          <>
            Hold <kbd>{shortcut}</kbd> in the workspace to dictate an Ask Viewer request. Release to
            transcribe.
          </>
        ) : (
          'Choose a Dictate shortcut in Settings → Shortcuts, or use the command palette.'
        )}{' '}
        Each recording is limited to 60 seconds.
      </p>
      <button
        type="button"
        className="settings-reset"
        disabled={
          busy ||
          (status.preferences.backend === 'hosted'
            ? !status.hosted?.providers.some(
                (provider) =>
                  provider.id === status.preferences.providerID &&
                  provider.hasKey &&
                  provider.allowed,
              )
            : !status.models.selected || !status.models.runtime.recognitionAvailable)
        }
        onClick={() => setTesting(true)}
      >
        Test microphone and transcription
      </button>
      {testing && (
        <DictationDialog
          destination="Speech test · the transcript will not be saved"
          useLabel="Done"
          onClose={() => {
            setTesting(false);
            void refresh();
          }}
          onUse={() => {}}
        />
      )}
    </>
  );
}
