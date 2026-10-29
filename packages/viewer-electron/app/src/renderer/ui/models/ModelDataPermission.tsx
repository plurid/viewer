import { useEffect, useRef, useState } from 'react';
import type { ModelProvider } from '../../../domain/services';
import {
  modelDataLabels,
  modelDataLevels,
  type ModelDataLevel,
  type ModelDataPermission,
} from '../../../domain/models/permissions';
import { ChoiceButton } from '../ChoiceMenu';
import { errorMessage } from '../../../domain/errors';

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
          setState({ identity, permission: null, loading: false, error: errorMessage(error) });
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
  useEffect(() => setLevel(permission?.level ?? 'names'), [permission?.level]);
  const save = async (level: ModelDataLevel | null) => {
    setBusy(true);
    try {
      await window.viewer.providerPermissionSet(provider.id, provider.endpoint, level);
    } catch (value) {
      error(errorMessage(value));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="model-data-permission">
      <summary>
        Data access
        <span>
          {loading ? 'Checking…' : permission ? modelDataLabels[permission.level] : 'Not allowed'}
          {permission && ` · Agent actions ${permission.agents ? 'allowed' : 'off'}`}
        </span>
      </summary>
      <p className="settings-note">
        Choose what this provider may receive. Access is granted only after your approval.
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
          <span>Allow agent-started actions to send the same data</span>
        </label>
      )}
      <p className="settings-note">
        Changing the endpoint or clearing the key revokes access and stops running requests.
      </p>
    </details>
  );
}
