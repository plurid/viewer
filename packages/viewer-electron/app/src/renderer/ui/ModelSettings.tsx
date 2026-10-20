import { useState } from 'react';
import type { ModelProvider, SettingsSnapshot } from '../../domain/services';
import {
  newModelProvider,
  providerKinds,
  providerPresets,
  qwenEndpoints,
  type ProviderKind,
} from '../../domain/model-providers';
import type { SettingsChange } from './settings-edits';
import { Field } from './SettingField';
import { IconButton } from './primitives';
import { referencesTo } from '../../domain/references';
import { ProviderDataPermission } from './ModelDataPermission';

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
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<Record<string, boolean>>({});
  const patch = (id: string, values: Partial<ModelProvider>) =>
    save((current) => [
      {
        path: 'settings.providers',
        value: current.settings.providers.map((provider) =>
          provider.id === id ? { ...provider, ...values } : provider,
        ),
      },
    ]);
  const credential = (id: string, key: string) => {
    setSavingKey((previous) => ({ ...previous, [id]: true }));
    void window.viewer
      .providerCredential(id, key)
      .catch((value) => error(value.message))
      .finally(() => setSavingKey((previous) => ({ ...previous, [id]: false })));
  };
  return (
    <>
      <p className="settings-note">
        Choose a provider and model for each recipe. Requests run only when you invoke an action.
      </p>
      <div className="settings-actions settings-provider-add">
        <select
          aria-label="New model provider"
          value={kind}
          onChange={(event) => setKind(event.target.value as ProviderKind)}
        >
          {providerKinds.map((kind) => (
            <option key={kind} value={kind}>
              {providerPresets[kind].name}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const provider = newModelProvider(kind, crypto.randomUUID());
            save((current) => [
              { path: 'settings.providers', value: [...current.settings.providers, provider] },
            ]);
          }}
        >
          Add provider
        </button>
      </div>
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
        return (
          <section
            className="settings-editor settings-provider"
            key={provider.id}
            data-provider-kind={provider.kind}
          >
            <div className="settings-editor-heading">
              <h2>{provider.name}</h2>
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
            <label>
              Endpoint
              <Field
                label="Provider endpoint"
                value={provider.endpoint}
                list={provider.kind === 'qwen' ? 'qwen-endpoints' : undefined}
                readOnly={!['local', 'qwen'].includes(provider.kind)}
                save={(endpoint) => patch(provider.id, { endpoint })}
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
            <ProviderDataPermission
              key={provider.id + provider.endpoint}
              provider={provider}
              error={error}
            />
            <div className="settings-actions">
              {!preset.suggestedModels && (
                <button
                  disabled={loading[provider.id] || savingKey[provider.id]}
                  onClick={() => {
                    error('');
                    setLoading((previous) => ({ ...previous, [provider.id]: true }));
                    void window.viewer
                      .providerModels(provider.id)
                      .then((values) => {
                        setModels((previous) => ({ ...previous, [provider.id]: values }));
                        if (!values.length)
                          error(
                            'Connected, but no compatible model IDs were returned. Enter a model ID manually.',
                          );
                      })
                      .catch((value) => error(value.message))
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
            </div>
            {(loading[provider.id] || savingKey[provider.id]) && (
              <p className="settings-note" role="status">
                {savingKey[provider.id] ? 'Saving key…' : 'Loading model IDs…'}
              </p>
            )}
            {models[provider.id]?.length ? (
              <p className="settings-note" role="status">
                {models[provider.id]?.length} models available in the Model field.
              </p>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
