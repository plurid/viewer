import { useState } from 'react';
import type { CommandContext } from './registry';
import { Dialog } from '../ui/primitives';
import { useViewer } from '../state/store';
import { Icon } from '../ui/Icon';
import { DestinationField } from '../ui/DestinationField';
import { useHomeText } from '../ui/PathLabel';
import { errorMessage } from '../../domain/errors';
import { plural } from '../../domain/plural';

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
  const shownError = useHomeText(error);
  return (
    <Dialog title={`${name} to Folder`} onClose={onClose}>
      <form
        className="dialog-form"
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
            setError(errorMessage(error));
            setBusy(false);
          }
        }}
      >
        <p className="muted">
          {context.selection.length === 1
            ? (context.selection[0]?.name ?? '')
            : plural(context.selection.length, 'selected item')}
        </p>
        <DestinationField label="Destination" path={path} onChange={setPath} disabled={busy} />
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
        </div>
        {error && (
          <p className="error" role="alert">
            {shownError}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" data-autofocus disabled={busy || !path.trim()}>
            {name}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
