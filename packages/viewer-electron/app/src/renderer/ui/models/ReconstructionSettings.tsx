import { useState } from 'react';
import { reconstructionCredentialID } from '../../../domain/canvases/reconstruction';
import type { SettingsSnapshot } from '../../../domain/services';
import { errorMessage } from '../../../domain/errors';
import { Disclosure } from '../Disclosure';

export function ReconstructionSettings({
  snapshot,
  error,
}: {
  snapshot: SettingsSnapshot;
  error(message: string): void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const configured = snapshot.credentials.includes(reconstructionCredentialID);
  const save = async (value: string) => {
    setBusy(true);
    try {
      await window.viewer.reconstructionKey(value);
      setKey('');
    } catch (value) {
      error(errorMessage(value));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Disclosure
      variant="row"
      summary="3D reconstruction"
      meta={
        configured ? 'Meta SAM 3D Objects · fal connected' : 'Meta SAM 3D Objects · configure fal'
      }
    >
      <p className="settings-note">
        Reconstruct a textured 3D mesh from a photo and a reviewed object mask. fal hosts this Meta
        model and bills your fal account separately. Each generation asks before sending the
        selected images.
      </p>
      <label className="settings-row">
        <span>
          fal API key
          <small>Stored using the operating system’s secure credential encryption.</small>
        </span>
        <input
          type="password"
          value={key}
          autoComplete="off"
          placeholder={configured ? 'Replace saved key' : 'Enter fal API key'}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <div className="settings-actions">
        <button disabled={busy || !key.trim()} onClick={() => void save(key.trim())}>
          Save key
        </button>
        {configured && (
          <button disabled={busy} onClick={() => void save('')}>
            Disconnect fal
          </button>
        )}
      </div>
    </Disclosure>
  );
}
