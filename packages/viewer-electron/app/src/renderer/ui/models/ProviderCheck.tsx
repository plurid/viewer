import { useEffect, useRef, useState } from 'react';
import type { ProviderCheckResult } from '../../../domain/models/provider-checks';

/** Explicit fixed-input generation check; model discovery alone cannot establish compatibility. */
export function ProviderCheck({
  providerID,
  onError,
}: {
  providerID: string;
  onError(message: string): void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProviderCheckResult>();
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setResult(undefined);
    onError('');
    try {
      const value = await window.viewer.providerCheck({ providerID, kind: 'chat-schema' });
      if (mounted.current) setResult(value);
    } catch (error) {
      if (mounted.current)
        onError(error instanceof Error ? error.message : 'The provider check failed.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="settings-provider-check">
      <div className="settings-actions">
        <button disabled={busy} onClick={() => void check()}>
          {busy ? 'Testing generation…' : 'Test structured output'}
        </button>
      </div>
      <p className="settings-note">
        Sends a short test prompt using the saved model. No files are attached.
      </p>
      {result && (
        <p className={result.outcome === 'passed' ? 'settings-note' : 'error'} role="status">
          {result.detail}
        </p>
      )}
    </div>
  );
}
