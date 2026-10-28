import { useState } from 'react';
import {
  newSpeechProvider,
  speechProviderKinds,
  speechProviderPresets,
  type SpeechProvider,
  type SpeechProviderKind,
  type SpeechProvidersSnapshot,
} from '../../domain/speech/providers';
import type { SpeechRequest } from '../../domain/speech/recognition';
import { ChoiceButton } from '../ui/ChoiceMenu';

function ProviderEditor({
  draft,
  busy,
  change,
  save,
  cancel,
}: {
  draft: SpeechProvider;
  busy: boolean;
  change(value: SpeechProvider): void;
  save(): void;
  cancel(): void;
}) {
  return (
    <form
      className="speech-provider-editor"
      aria-label="Speech provider setup"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <fieldset disabled={busy}>
        <div className="settings-row">
          <span>Provider</span>
          <ChoiceButton
            label="Speech provider type"
            value={draft.kind}
            choices={speechProviderKinds.map((value) => ({
              value,
              label: speechProviderPresets[value].name,
            }))}
            disabled={busy}
            onChoose={(value) => {
              const kind = value as SpeechProviderKind,
                next = newSpeechProvider(kind, draft.id);
              change({
                ...next,
                name:
                  draft.name === speechProviderPresets[draft.kind].name ? next.name : draft.name,
              });
            }}
          />
        </div>
        <label className="field-label">
          Name
          <input
            aria-label="Speech provider name"
            value={draft.name}
            maxLength={200}
            required
            onChange={(event) => change({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="field-label">
          API base URL
          <input
            aria-label="Speech provider endpoint"
            value={draft.endpoint}
            maxLength={4000}
            required
            type="url"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => change({ ...draft, endpoint: event.target.value })}
          />
        </label>
        <label className="field-label">
          Model ID
          <input
            aria-label="Speech provider model"
            value={draft.model}
            maxLength={200}
            required
            spellCheck={false}
            onChange={(event) => change({ ...draft, model: event.target.value })}
          />
        </label>
        <p className="settings-note">{speechProviderPresets[draft.kind].note}</p>
        <div className="speech-model-actions">
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!draft.name.trim() || !draft.model.trim() || !draft.endpoint.trim()}
          >
            Save provider
          </button>
        </div>
      </fieldset>
    </form>
  );
}
export function HostedSpeechSettings({
  snapshot,
  selectedID,
  busy,
  select,
  request,
}: {
  snapshot: SpeechProvidersSnapshot;
  selectedID?: string;
  busy: boolean;
  select(id: string): void;
  request(request: SpeechRequest): Promise<boolean>;
}) {
  const [draft, setDraft] = useState<SpeechProvider>();
  const [key, setKey] = useState<{ id: string; value: string }>();
  const [checking, setChecking] = useState(false);
  const selected = snapshot.providers.find((item) => item.id === selectedID);
  const save = async () => {
    if (!draft) return;
    if (!(await request({ kind: 'provider-save', provider: draft }))) return;
    setDraft(undefined);
    select(draft.id);
  };
  return (
    <section className="speech-hosted" aria-label="Hosted speech providers">
      <h2>Hosted provider</h2>
      <p className="settings-note">
        Finishing a recording sends its audio to the selected provider. Your chat model settings and
        microphone permission do not authorize this transfer. Local recognition remains available as
        a separate choice.
      </p>
      <div className="settings-row">
        <span>Use provider</span>
        <ChoiceButton
          label="Hosted speech provider"
          value={selectedID ?? ''}
          placeholder="Choose a provider"
          disabled={busy || !!draft || !snapshot.providers.length}
          choices={snapshot.providers.map((provider) => ({
            value: provider.id,
            label: provider.name + ' · ' + provider.model,
          }))}
          onChoose={select}
        />
      </div>
      {!draft && (
        <button
          type="button"
          className="settings-reset"
          disabled={busy || snapshot.providers.length >= 8}
          onClick={() => setDraft(newSpeechProvider('meta', crypto.randomUUID()))}
        >
          Add speech provider
        </button>
      )}
      {draft ? (
        <ProviderEditor
          draft={draft}
          busy={busy}
          change={setDraft}
          cancel={() => setDraft(undefined)}
          save={() => void save().catch(() => {})}
        />
      ) : (
        selected && (
          <>
            <div className="speech-provider-summary">
              <strong>
                {selected.name} · {selected.model}
              </strong>
              <p>{selected.endpoint}</p>
              <div className="speech-model-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      id: selected.id,
                      kind: selected.kind,
                      name: selected.name,
                      endpoint: selected.endpoint,
                      model: selected.model,
                    })
                  }
                >
                  Edit provider
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void request({ kind: 'provider-remove', id: selected.id }).catch(() => {})
                  }
                >
                  Remove provider
                </button>
              </div>
            </div>
            <label className="field-label speech-provider-key">
              API key
              <input
                aria-label="Speech provider API key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={20000}
                value={key?.id === selected.id ? key.value : ''}
                placeholder={selected.hasKey ? 'Stored securely' : 'Enter API key'}
                disabled={busy}
                onChange={(event) => setKey({ id: selected.id, value: event.target.value })}
              />
            </label>
            <div className="speech-model-actions">
              <button
                type="button"
                disabled={busy || key?.id !== selected.id || !key.value.trim()}
                onClick={() =>
                  void request({ kind: 'provider-key', id: selected.id, key: key?.value ?? '' })
                    .then((saved) => {
                      if (saved) setKey(undefined);
                    })
                    .catch(() => {})
                }
              >
                Save key
              </button>
              {selected.hasKey && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void request({ kind: 'provider-key', id: selected.id, key: '' }).catch(() => {})
                  }
                >
                  Clear stored key
                </button>
              )}
            </div>
            <h3>Connection and model</h3>
            <p
              className={
                selected.check && !['available', 'unverified'].includes(selected.check.outcome)
                  ? 'error'
                  : 'settings-note'
              }
              role="status"
              aria-live="polite"
            >
              {checking
                ? 'Checking the saved key and model catalog…'
                : selected.check
                  ? `${selected.check.detail}${selected.check.httpStatus ? ` (HTTP ${selected.check.httpStatus})` : ''}`
                  : 'Not checked in this session. Check the saved provider before your first recording.'}
            </p>
            <div className="speech-model-actions">
              <button
                type="button"
                disabled={busy || !selected.hasKey}
                onClick={() => {
                  setChecking(true);
                  void request({ kind: 'provider-check', id: selected.id }).finally(() =>
                    setChecking(false),
                  );
                }}
              >
                {checking ? 'Checking…' : 'Check connection and model'}
              </button>
            </div>
            <p className="settings-note">
              This uses your saved key to request provider metadata. It records and sends no audio.
              Catalog access does not confirm transcription quality or remaining credit.
            </p>
            <h3>Audio access</h3>
            <p className="settings-note" role="status">
              {selected.allowed
                ? 'Recordings are allowed for this saved endpoint and model.'
                : 'Recordings are not allowed yet.'}{' '}
              Changing the endpoint or model revokes audio access and stops affected sessions. A new
              endpoint needs its own key.
            </p>
            <div className="speech-model-actions">
              <button
                type="button"
                disabled={busy || !selected.hasKey}
                onClick={() =>
                  void request({
                    kind: 'provider-consent',
                    id: selected.id,
                    allow: !selected.allowed,
                  }).catch(() => {})
                }
              >
                {selected.allowed ? 'Revoke audio access' : 'Allow recordings…'}
              </button>
            </div>
            <p className="settings-note">
              Keys are encrypted privately and never included in configuration exports. Each
              recording is at most 60 seconds. Viewer does not retry or switch providers
              automatically.
            </p>
          </>
        )
      )}
    </section>
  );
}
