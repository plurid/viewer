import { useState } from 'react';
import type { CommandContext } from './registry';
import { Dialog } from '../ui/primitives';
import { useViewer } from '../state/store';
import { Icon } from '../ui/Icon';

/** Selection is captured before choosing a destination; confirmation runs the operation. */
export function DestinationDialog({
  kind,
  context,
  onClose,
}: {
  kind: 'copy' | 'move';
  context: CommandContext;
  onClose(): void;
}) {
  const [path, setPath] = useState(context.directory || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const favorites = useViewer((state) => state.saved.favorites);
  const locations = useViewer((state) => state.bootstrap.locations);
  const name = kind === 'copy' ? 'Copy' : 'Move';
  return (
    <Dialog title={`${name} to folder`} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const destination = await window.viewer.stat(path);
            if (!destination.directory) throw new Error('Choose a folder.');
            await window.viewer.operate({
              kind,
              sources: context.selection.map((entry) => entry.path),
              destination: destination.path,
            });
            onClose();
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
            setBusy(false);
          }
        }}
      >
        <p className="muted">
          {context.selection.length === 1
            ? context.selection[0].name
            : `${context.selection.length} selected items`}
        </p>
        <label className="field-label">
          Destination
          <input
            autoFocus
            data-autofocus
            value={path}
            onChange={(event) => setPath(event.target.value)}
            required
            maxLength={32768}
          />
        </label>
        <div className="destination-options">
          {[...favorites, ...locations]
            .filter(
              (item, index, all) => all.findIndex((other) => other.path === item.path) === index,
            )
            .slice(0, 12)
            .map((item) => (
              <button
                type="button"
                key={item.path}
                title={item.path}
                onClick={() => setPath(item.path)}
              >
                <Icon name="folder" size={15} />
                {item.name}
              </button>
            ))}
          <button
            type="button"
            onClick={() => {
              void window.viewer
                .chooseFolder()
                .then((path) => {
                  if (path) setPath(path);
                })
                .catch((error) => setError(String(error.message || error)));
            }}
          >
            Choose folder…
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !path.trim()}>
            {name}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
