import { useCallback, useEffect, useRef, useState } from 'react';
import type { Volume } from '../../domain/volumes';
import { formatBytes } from '../../domain/files';
import { Dialog, IconButton, Loading } from './primitives';
import { Icon } from './Icon';
export function Volumes({
  onClose,
  open,
}: {
  onClose(): void;
  open(path: string): Promise<boolean>;
}) {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const live = useRef(true),
    sequence = useRef(0);
  const refresh = useCallback(async (clearError = false) => {
    const ticket = ++sequence.current;
    try {
      const volumes = await window.viewer.volumesList();
      if (live.current && ticket === sequence.current) {
        setVolumes(volumes);
        if (clearError) setError('');
      }
    } catch (value) {
      if (live.current && ticket === sequence.current) setError((value as Error).message);
    } finally {
      if (live.current && ticket === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const requests = sequence;
    live.current = true;
    void refresh();
    const interval = setInterval(() => {
      if (live.current) void refresh();
    }, 5000);
    return () => {
      live.current = false;
      // Invalidate replies to requests started before closing.
      requests.current++;
      clearInterval(interval);
    };
  }, [refresh]);
  return (
    <Dialog title="Volumes" onClose={onClose} className="volumes-dialog">
      <div className="dialog-copy">
        <p className="muted">
          Open a disk or network volume. macOS may ask you to choose it before Viewer can read its
          files.
        </p>
        {loading && <Loading label="Loading volumes…" />}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!loading && !volumes.length && <p className="muted">No volumes available.</p>}
        <div className="volume-list">
          {volumes.map((volume) => (
            <div key={volume.path} className="volume-row">
              <Icon name="drive" size={24} />
              <button
                className="volume-open"
                disabled={!!busy}
                title={volume.path}
                onClick={async () => {
                  setBusy(volume.path);
                  try {
                    if (await open(volume.path)) onClose();
                  } catch (value) {
                    setError((value as Error).message);
                  } finally {
                    setBusy('');
                  }
                }}
              >
                <strong>{volume.name}</strong>
                <small>
                  {volume.total
                    ? `${formatBytes(volume.available)} available of ${formatBytes(volume.total)}`
                    : volume.path}
                  {volume.readOnly ? ' · Read only' : ''}
                </small>
              </button>
              {volume.ejectable && (
                <IconButton
                  icon="eject"
                  label={`Eject ${volume.name}`}
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(volume.path);
                    try {
                      await window.viewer.volumeEject(volume.path);
                      await refresh(true);
                    } catch (value) {
                      setError((value as Error).message);
                    } finally {
                      setBusy('');
                    }
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <footer>
          <button onClick={() => void refresh(true)} disabled={!!busy}>
            {busy ? 'Waiting for files to close…' : 'Refresh'}
          </button>
          <button onClick={onClose}>Done</button>
        </footer>
      </div>
    </Dialog>
  );
}
