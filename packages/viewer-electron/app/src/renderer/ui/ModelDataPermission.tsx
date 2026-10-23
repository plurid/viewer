import { useEffect, useRef, useState } from 'react';
import type { ModelProvider } from '../../domain/services';
import {
  modelDataLabels,
  modelDataLevels,
  type ModelDataLevel,
  type ModelDataPermission,
} from '../../domain/model-permissions';
import { ChoiceButton } from './ChoiceMenu';

export function useModelPermission(provider?: ModelProvider) {
  const identity = provider ? `${provider.id}:${provider.kind}:${provider.endpoint}` : '';
  const [state, setState] = useState<{
    identity: string;
    permission: ModelDataPermission | null;
    loading: boolean;
    error: string;
  }>({ identity: '', permission: null, loading: false, error: '' });
  const sequence = useRef(0);
  const providerID = provider?.id;
  useEffect(() => {
    let live = true;
    const load = async () => {
      const request = ++sequence.current;
      setState({ identity, permission: null, loading: !!providerID, error: '' });
      try {
        const permission = providerID
          ? await window.viewer.providerPermissionGet(providerID)
          : null;
        if (live && request === sequence.current)
          setState({ identity, permission, loading: false, error: '' });
      } catch (error) {
        if (live && request === sequence.current)
          setState({ identity, permission: null, loading: false, error: (error as Error).message });
      }
    };
    void load();
    const unsubscribe = window.viewer.onEvent((event) => {
      if (event.type === 'model-permission' && event.providerID === providerID) void load();
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [identity, providerID]);
  return state.identity === identity
    ? state
    : { identity, permission: null, loading: !!provider, error: '' };
}

export function ProviderDataPermission({
  provider,
  error,
}: {
  provider: ModelProvider;
  error(message: string): void;
}) {
  const { permission, loading, error: loadError } = useModelPermission(provider);
  const [level, setLevel] = useState<ModelDataLevel>('names');
  const [busy, setBusy] = useState(false);
  const save = async (level: ModelDataLevel | null) => {
    setBusy(true);
    try {
      await window.viewer.providerPermissionSet(provider.id, provider.endpoint, level);
    } catch (value) {
      error((value as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="model-data-permission">
      <legend>Data access</legend>
      <p className="settings-note">
        Actions send your instructions and the allowed data to{' '}
        <span className="model-endpoint">{provider.endpoint}</span>. Your approval is stored
        privately. Configuration and agents cannot grant it.
      </p>
      <p className="settings-note" role="status">
        {loading
          ? 'Checking permission…'
          : permission
            ? `Allowed: ${modelDataLabels[permission.level]}.`
            : 'No file data may be sent yet.'}
      </p>
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      <div className="settings-actions">
        <ChoiceButton
          label={`Data to allow for ${provider.name}`}
          value={level}
          choices={modelDataLevels.map((level) => ({
            value: level,
            label: modelDataLabels[level],
          }))}
          onChoose={(level) => setLevel(level as ModelDataLevel)}
          disabled={busy || loading}
        />
        <button
          type="button"
          disabled={busy || loading || !!loadError}
          onClick={() => void save(level)}
        >
          {busy ? 'Saving…' : 'Allow selected data'}
        </button>
        {permission && (
          <button type="button" disabled={busy || loading} onClick={() => void save(null)}>
            Revoke access
          </button>
        )}
      </div>
      {permission && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={!!permission.agents}
            disabled={busy || loading}
            onChange={(event) => {
              const allow = event.target.checked;
              setBusy(true);
              void window.viewer
                .providerPermissionAgents(provider.id, provider.endpoint, allow)
                .catch((value: Error) => error(value.message))
                .finally(() => setBusy(false));
            }}
          />
          Actions agents start may send this data too
        </label>
      )}
      <p className="settings-note">
        Changing the endpoint or clearing the key revokes access and stops running requests.
      </p>
    </fieldset>
  );
}
