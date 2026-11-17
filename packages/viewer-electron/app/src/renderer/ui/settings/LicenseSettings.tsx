import { useState } from 'react';
import { errorMessage } from '../../../domain/errors';
import { licenseLimits, licenseLine, trialDays } from '../../../domain/license/license';
import type { LicenseRequest, LicenseStatus } from '../../../domain/license/license';

export function LicenseSettings({
  status,
  onChange,
}: {
  status: LicenseStatus;
  onChange(status: LicenseStatus | undefined): void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (request: LicenseRequest) => {
    setBusy(true);
    setError('');
    try {
      onChange(await window.viewer.license(request));
      if (request.kind === 'enter') setKey('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p role="status" className="license-status">
        {licenseLine(status)}
      </p>
      <p className="settings-note">
        {status.kind === 'licensed'
          ? 'Your pay-once license key is saved on this Mac and checked offline.'
          : status.kind === 'trial'
            ? `The trial lasts ${trialDays} days. All features keep working after it ends.`
            : `The ${trialDays}-day trial is over. All features keep working.`}
      </p>
      {status.kind !== 'licensed' && (
        <div className="settings-actions">
          <button disabled={busy} onClick={() => void run({ kind: 'buy' })}>
            Buy Viewer
          </button>
        </div>
      )}
      <h2>{status.kind === 'licensed' ? 'Replace license key' : 'Enter license key'}</h2>
      <label className="license-key-field">
        <span>License key</span>
        <textarea
          value={key}
          maxLength={licenseLimits.key}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          rows={4}
          disabled={busy}
          aria-invalid={!!error}
          aria-describedby={error ? 'license-key-error' : undefined}
          onChange={(event) => {
            setKey(event.target.value);
            setError('');
          }}
        />
      </label>
      <p className="settings-note">
        The key contains your purchase email and order reference. Viewer sends neither to its
        developer. Buy Viewer opens the purchase page in your browser.
      </p>
      <div className="settings-actions">
        <button
          className="primary"
          disabled={busy || !key.trim()}
          onClick={() => void run({ kind: 'enter', key })}
        >
          {busy ? 'Working…' : 'Save License Key'}
        </button>
        {status.kind === 'licensed' && (
          <button className="danger" disabled={busy} onClick={() => void run({ kind: 'remove' })}>
            Remove License Key
          </button>
        )}
      </div>
      {error && (
        <p id="license-key-error" className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
