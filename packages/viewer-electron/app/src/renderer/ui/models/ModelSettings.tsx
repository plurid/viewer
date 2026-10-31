import { useRef, useState } from 'react';
import type { ModelProvider, SettingsSnapshot } from '../../../domain/services';
import {
  newModelProvider,
  providerKinds,
  providerPresets,
  qwenEndpoints,
  reasoningEffortLabels,
  type ProviderKind,
  type ReasoningEffort,
} from '../../../domain/models/providers';
import type { SettingsChange } from '../settings/settings-edits';
import { Field } from '../settings/SettingField';
import { IconButton } from '../primitives';
import { ChoiceButton } from '../ChoiceMenu';
import { referencesTo } from '../../../domain/automation/references';
import { ProviderDataPermission } from './ModelDataPermission';
import { ProviderCheck } from './ProviderCheck';
import { Icon } from '../Icon';

interface ConnectionResult {
  identity: string;
  message: string;
  connected: boolean;
}
const connectionIdentity = (provider: ModelProvider) =>
  JSON.stringify([provider.kind, provider.endpoint, provider.model]);

export function ModelSettings({
  snapshot,
  save,
  error,
}: {
  snapshot: SettingsSnapshot;
  save(change: SettingsChange): void;
  error(message: string): void;
}) {
  const [kind, setKind] = useState<ProviderKind>('openai');
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(
    snapshot.settings.providers[0]?.id ?? null,
  );
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [connections, setConnections] = useState<Record<string, ConnectionResult>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<Record<string, boolean>>({});
  const currentProviders = useRef(snapshot.settings.providers);
  currentProviders.current = snapshot.settings.providers;
  const requests = useRef(new Map<string, number>());
  const patch = (id: string, values: Partial<ModelProvider>) =>
    save((current) => [
      {
        path: 'settings.providers',
        value: current.settings.providers.map((provider) =>
          provider.id === id ? { ...provider, ...values } : provider,
        ),
      },
    ]);
  /** Sets a provider's reasoning effort, or leaves it out for the API's own. */
  const setEffort = (id: string, effort: ReasoningEffort | undefined) =>
    save((current) => [
      {
        path: 'settings.providers',
        value: current.settings.providers.map((provider) => {
          if (provider.id !== id) return provider;
          const { effort: _effort, ...rest } = provider;
          return effort ? { ...rest, effort } : rest;
        }),
      },
    ]);
  /** Sets the SAM model a local server also answers, or leaves it out: then it does not outline. */
  const setSegmentation = (id: string, model: string) =>
    save((current) => [
      {
        path: 'settings.providers',
        value: current.settings.providers.map((provider) => {
          if (provider.id !== id) return provider;
          const { segmentation: _segmentation, ...rest } = provider;
          return model.trim() ? { ...rest, segmentation: model.trim() } : rest;
        }),
      },
    ]);
  const credential = (id: string, key: string) => {
    requests.current.set(id, (requests.current.get(id) ?? 0) + 1);
    setConnections((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id)),
    );
    setSavingKey((previous) => ({ ...previous, [id]: true }));
    void window.viewer
      .providerCredential(id, key)
      .catch((value) => error(value.message))
      .finally(() => setSavingKey((previous) => ({ ...previous, [id]: false })));
  };
  const selectedDefault =
    snapshot.settings.providers.find(
      (provider) => provider.id === snapshot.settings.prompts.providerID,
    ) ?? snapshot.settings.providers[0];
  return (
    <>
      <div className="models-introduction">
        <p className="settings-note">Manage the models you use for Ask Viewer and actions.</p>
        <button onClick={() => setAdding((value) => !value)} aria-expanded={adding}>
          Add model
        </button>
      </div>
      {snapshot.settings.providers.length > 0 && (
        // `>` in the palette: which model turns words into a command line
        <label className="settings-row">
          <span>
            Default for Ask Viewer
            <small>
              {selectedDefault?.name} · {selectedDefault?.model || 'Choose a model to finish setup'}
            </small>
          </span>
          <ChoiceButton
            label="Default model for Ask Viewer"
            value={
              snapshot.settings.providers.some(
                (provider) => provider.id === snapshot.settings.prompts.providerID,
              )
                ? snapshot.settings.prompts.providerID
                : snapshot.settings.providers[0]!.id
            }
            choices={snapshot.settings.providers.map((provider) => ({
              value: provider.id,
              label: `${provider.name} · ${provider.model || 'no model'}`,
            }))}
            onChoose={(providerID) =>
              save(() => [{ path: 'settings.prompts', value: { providerID } }])
            }
          />
        </label>
      )}
      {adding && (
        <div className="settings-actions settings-provider-add" aria-label="Add a model">
          <ChoiceButton
            label="New model provider"
            value={kind}
            choices={providerKinds.map((kind) => ({
              value: kind,
              label: providerPresets[kind].name,
            }))}
            onChoose={(kind) => setKind(kind as ProviderKind)}
          />
          <button
            onClick={() => {
              const provider = newModelProvider(kind, crypto.randomUUID());
              save((current) => [
                { path: 'settings.providers', value: [...current.settings.providers, provider] },
              ]);
              setExpanded(provider.id);
              setAdding(false);
            }}
          >
            Set up model
          </button>
        </div>
      )}
      {!snapshot.settings.providers.length && !adding && (
        <p className="settings-note">
          No models added. Add a model to connect your provider and choose a model ID.
        </p>
      )}
      <datalist id="qwen-endpoints">
        {qwenEndpoints.map((item) => (
          <option key={item.endpoint} value={item.endpoint}>
            {item.label}
          </option>
        ))}
      </datalist>
      {snapshot.settings.providers.map((provider) => {
        const preset = providerPresets[provider.kind];
        const choices = [
          ...new Set([...(models[provider.id] ?? []), ...(preset.suggestedModels ?? [])]),
        ];
        const connection = connections[provider.id];
        const currentConnection =
          connection?.identity === connectionIdentity(provider) ? connection : undefined;
        const status = savingKey[provider.id]
          ? 'Saving key…'
          : loading[provider.id]
            ? 'Connecting…'
            : (currentConnection?.message ??
              (!provider.model
                ? 'Choose a model'
                : !snapshot.credentials.includes(provider.id) && provider.kind !== 'local'
                  ? 'API key needed'
                  : 'Configured · connection not checked'));
        return (
          <details
            className="settings-editor settings-provider"
            key={provider.id}
            data-provider-kind={provider.kind}
            open={expanded === provider.id}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setExpanded((current) =>
                open ? provider.id : current === provider.id ? null : current,
              );
            }}
          >
            <summary className="model-summary">
              <Icon name="right" size={12} />
              <span className="model-identity">
                <strong>{provider.name}</strong>
                <span>{provider.model || 'No model selected'}</span>
              </span>
              <span
                className="model-status"
                data-connected={currentConnection?.connected || undefined}
              >
                {status}
              </span>
              {selectedDefault?.id === provider.id && (
                <span className="model-default">Default for Ask</span>
              )}
            </summary>
            <div className="model-editor-body">
              <div className="settings-editor-heading">
                <h2>Model setup</h2>
                <IconButton
                  icon="close"
                  label={
                    referencesTo(snapshot.settings, 'provider', provider.id).length
                      ? `${provider.name} is used by ${referencesTo(snapshot.settings, 'provider', provider.id).join(', ')}: change them to remove it`
                      : `Remove ${provider.name} provider`
                  }
                  disabled={!!referencesTo(snapshot.settings, 'provider', provider.id).length}
                  onClick={() =>
                    save((current) => [
                      {
                        path: 'settings.providers',
                        value: current.settings.providers.filter((item) => item.id !== provider.id),
                      },
                    ])
                  }
                />
              </div>
              {preset.note && <p className="settings-note">{preset.note}</p>}
              <label>
                Name
                <Field
                  label="Provider name"
                  value={provider.name}
                  save={(name) => patch(provider.id, { name })}
                />
              </label>
              <details className="model-advanced">
                <summary>Provider address</summary>
                <label className="model-address-field">
                  Endpoint
                  <Field
                    label="Provider endpoint"
                    value={provider.endpoint}
                    list={provider.kind === 'qwen' ? 'qwen-endpoints' : undefined}
                    readOnly={!['local', 'qwen'].includes(provider.kind)}
                    save={(endpoint) => patch(provider.id, { endpoint })}
                  />
                </label>
              </details>
              <label>
                API key
                <input
                  type="password"
                  aria-label="API key"
                  autoComplete="off"
                  placeholder={
                    snapshot.credentials.includes(provider.id)
                      ? 'Stored securely'
                      : provider.kind === 'local'
                        ? 'Optional for local servers'
                        : `Paste your ${preset.name} API key`
                  }
                  onBlur={(event) => {
                    const key = event.target.value;
                    if (key) {
                      event.target.value = '';
                      credential(provider.id, key);
                    }
                  }}
                />
              </label>
              <label>
                Model
                <Field
                  label="Model"
                  value={provider.model}
                  list={'models-' + provider.id}
                  placeholder={preset.suggestedModels?.[0] ?? 'Enter a model ID or load models'}
                  save={(model) => patch(provider.id, { model })}
                />
                <datalist id={'models-' + provider.id}>
                  {choices.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </label>
              {provider.kind === 'local' && (
                <label>
                  Outlines with SAM
                  <Field
                    label="Outlines with SAM"
                    value={provider.segmentation ?? ''}
                    placeholder="sam-3.1, when this server also runs SAM"
                    save={(model) => setSegmentation(provider.id, model)}
                  />
                </label>
              )}
              {preset.efforts && (
                <label>
                  Reasoning effort
                  <ChoiceButton
                    label="Reasoning effort"
                    value={provider.effort ?? ''}
                    choices={[
                      { value: '', label: 'Provider default' },
                      ...preset.efforts.map((effort) => ({
                        value: effort,
                        label: reasoningEffortLabels[effort],
                      })),
                    ]}
                    onChoose={(effort) =>
                      setEffort(provider.id, (effort || undefined) as ReasoningEffort | undefined)
                    }
                  />
                </label>
              )}
              <div className="settings-actions">
                {!preset.suggestedModels && (
                  <button
                    disabled={loading[provider.id] || savingKey[provider.id]}
                    onClick={() => {
                      error('');
                      const request = (requests.current.get(provider.id) ?? 0) + 1;
                      requests.current.set(provider.id, request);
                      const current = () =>
                        requests.current.get(provider.id) === request &&
                        currentProviders.current.some(
                          (value) =>
                            value.id === provider.id &&
                            connectionIdentity(value) === connectionIdentity(provider),
                        );
                      setLoading((previous) => ({ ...previous, [provider.id]: true }));
                      void window.viewer
                        .providerModels(provider.id)
                        .then((values) => {
                          if (!current()) return;
                          setModels((previous) => ({ ...previous, [provider.id]: values }));
                          setConnections((previous) => ({
                            ...previous,
                            [provider.id]: {
                              identity: connectionIdentity(provider),
                              connected: true,
                              message: 'Connected · ' + values.length + ' model IDs available',
                            },
                          }));
                          if (!values.length)
                            error(
                              'Connected, but no compatible model IDs were returned. Enter a model ID manually.',
                            );
                        })
                        .catch((value: Error) => {
                          if (!current()) return;
                          setConnections((previous) => ({
                            ...previous,
                            [provider.id]: {
                              identity: connectionIdentity(provider),
                              connected: false,
                              message: 'Connection failed',
                            },
                          }));
                          error(value.message);
                        })
                        .finally(() =>
                          setLoading((previous) => ({ ...previous, [provider.id]: false })),
                        );
                    }}
                  >
                    {loading[provider.id] ? 'Loading models…' : 'Connect and load models'}
                  </button>
                )}
                {snapshot.credentials.includes(provider.id) && (
                  <button
                    disabled={savingKey[provider.id]}
                    onClick={() => credential(provider.id, '')}
                  >
                    Clear stored key
                  </button>
                )}
                {selectedDefault?.id !== provider.id && (
                  <button
                    onClick={() =>
                      save(() => [{ path: 'settings.prompts', value: { providerID: provider.id } }])
                    }
                  >
                    Use for Ask Viewer
                  </button>
                )}
              </div>
              {(loading[provider.id] || savingKey[provider.id]) && (
                <p className="settings-note" role="status">
                  {savingKey[provider.id] ? 'Saving key…' : 'Loading model IDs…'}
                </p>
              )}
              {models[provider.id]?.length ? (
                <p className="settings-note" role="status">
                  {models[provider.id]?.length} model IDs loaded. Choose one in the Model field
                  above.
                </p>
              ) : null}
              {provider.kind === 'gemini' && (
                <details className="model-advanced">
                  <summary>Test model compatibility</summary>
                  <ProviderCheck
                    key={JSON.stringify([provider.id, provider.endpoint, provider.model])}
                    providerID={provider.id}
                    onError={error}
                  />
                </details>
              )}
              <ProviderDataPermission
                key={provider.id + provider.endpoint}
                provider={provider}
                error={error}
              />
            </div>
          </details>
        );
      })}
    </>
  );
}
