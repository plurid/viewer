import { useEffect, useId, useRef, useState } from 'react';
import { errorMessage } from '../../domain/errors';
import { baseName } from '../../domain/workspaces/planes';
import { getState, useViewer } from '../state/core';
import { clearRecentFolders } from '../state/places';
import { Button, Dialog } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { useFolderSuggestions } from './useFolderSuggestions';
import './go-to-folder.css';

export function GoToFolderDialog({
  onOpen,
  onClose,
}: {
  onOpen(path: string): Promise<unknown>;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { paths, checking } = useFolderSuggestions(query);
  const canClear = useViewer(
    (state) => state.saved.recents.length > 0 || Object.keys(state.saved.visits ?? {}).length > 0,
  );
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const live = useRef(true);
  const id = useId();
  const index = Math.max(0, paths.indexOf(selected));
  const choice = paths[index];
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const open = async (suggestion = choice, typed = true) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      let entry;
      if (typed && query.trim()) {
        const path =
          query === '~' || query.startsWith('~/')
            ? getState().bootstrap.home + query.slice(1)
            : query;
        try {
          entry = await window.viewer.stat(path);
        } catch (cause) {
          if (!suggestion) throw cause;
        }
      }
      if (!live.current) return;
      // Recheck on selection: a volume may have disappeared after the suggestions arrived.
      entry ??= suggestion ? await window.viewer.stat(suggestion) : undefined;
      if (!entry?.directory) throw new Error('Choose a folder path.');
      if (!live.current) return;
      await onOpen(entry.path);
      if (live.current) onClose();
    } catch (cause) {
      if (live.current) setError(errorMessage(cause));
    } finally {
      if (live.current) setBusy(false);
    }
  };

  return (
    <Dialog title="Go to folder" onClose={onClose} className="go-to-folder-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
      >
        <label className="field-label" htmlFor={`${id}-input`}>
          Folder path or name
        </label>
        <input
          ref={input}
          id={`${id}-input`}
          data-autofocus
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={paths.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={choice ? `${id}-option-${index}` : undefined}
          aria-describedby={`${id}-status`}
          autoComplete="off"
          spellCheck={false}
          maxLength={32768}
          placeholder="Folder name or ~/Documents"
          value={query}
          disabled={busy}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected('');
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              void open();
            } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && paths.length) {
              event.preventDefault();
              event.stopPropagation();
              setSelected(
                paths[
                  (index + (event.key === 'ArrowDown' ? 1 : -1) + paths.length) % paths.length
                ]!,
              );
            }
          }}
        />
        <p id={`${id}-status`} className="go-to-folder-status" role="status">
          {checking
            ? 'Checking folders…'
            : paths.length
              ? `${paths.length} suggested folders. Use ↑ and ↓ to choose.`
              : query
                ? 'No matching folders. Enter a folder path.'
                : 'Visit a folder to see suggestions here.'}
        </p>
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label="Folder suggestions"
          className="command-results"
        >
          {paths.map((path, row) => (
            <button
              key={path}
              id={`${id}-option-${row}`}
              type="button"
              role="option"
              aria-selected={index === row}
              tabIndex={-1}
              className="command-result"
              title={path}
              disabled={busy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void open(path, false)}
            >
              <Icon name="folder" size={16} />
              <span className="command-result-text">
                <span>{baseName(path)}</span>
                <small>{path}</small>
              </span>
            </button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer>
          {canClear && (
            <Button
              type="button"
              variant="secondary"
              className="dialog-secondary-action"
              disabled={busy}
              onClick={() => {
                clearRecentFolders();
                input.current?.focus();
              }}
            >
              Clear recent folders
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || (!query.trim() && !choice)}>
            Go
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
