import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileDialogPrompt, DialogRequest } from '../../domain/dialogs';
import { matchesDialogFilter } from '../../domain/dialogs';
import type { FileEntry, FolderListing } from '../../domain/contracts';
import { formatBytes, isPackage } from '../../domain/files/entries';
import { errorMessage } from '../../domain/errors';
import { Dialog, IconButton } from '../ui/primitives';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { Icon } from '../ui/Icon';

export default function FilePicker({ prompt }: { prompt: FileDialogPrompt }) {
  const [listing, setListing] = useState<FolderListing>();
  const [pathText, setPathText] = useState(prompt.folder);
  const [name, setName] = useState(prompt.name);
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState(prompt.hidden);
  const [filter, setFilter] = useState('0');
  const [selection, setSelection] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const anchor = useRef(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<string>();
  const [newFolder, setNewFolder] = useState<string>();
  const [history, setHistory] = useState<string[]>([]);
  const epoch = useRef({ value: 0 });
  const pathInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const folder = listing?.path ?? prompt.folder;
  const browse = useCallback(
    async (path: string) => {
      const current = ++epoch.current.value;
      setLoading(true);
      setError('');
      setConflict(undefined);
      try {
        const reply = await window.viewer.dialog({ kind: 'browse', id: prompt.id, path });
        if (current !== epoch.current.value || !reply.listing) return;
        setListing(reply.listing);
        setPathText(reply.listing.path);
        setSelection([]);
        setCursor(-1);
        setQuery('');
      } catch (error) {
        if (current === epoch.current.value) setError(errorMessage(error));
      } finally {
        if (current === epoch.current.value) setLoading(false);
      }
    },
    [prompt.id],
  );
  useEffect(() => {
    const requests = epoch.current;
    void browse(prompt.folder);
    return () => {
      requests.value++;
    };
  }, [browse, prompt.folder]);
  const navigate = (path: string) => {
    if (path !== folder) setHistory((previous) => [...previous, folder]);
    void browse(path);
  };
  const extensions = prompt.filters[Number(filter)]?.extensions ?? [];
  const entries = useMemo(
    () =>
      (listing?.entries ?? [])
        .filter(
          (entry) =>
            (hidden || !entry.hidden) && entry.name.toLowerCase().includes(query.toLowerCase()),
        )
        .sort(
          (left, right) =>
            Number(right.directory) - Number(left.directory) ||
            left.name.localeCompare(right.name, undefined, { numeric: true }),
        ),
    [listing, hidden, query],
  );
  const canBrowse = (entry: FileEntry) =>
    entry.directory && (prompt.directory || !isPackage(entry));
  const canChoose = (entry: FileEntry) =>
    !entry.error &&
    ((prompt.directory && entry.directory) ||
      (prompt.files &&
        (!entry.directory || isPackage(entry)) &&
        matchesDialogFilter(entry.name, extensions)));
  const allowed = (entry: FileEntry) => !entry.error && (canBrowse(entry) || canChoose(entry));
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 36,
    overscan: 12,
  });
  const send = async (request: DialogRequest) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const reply = await window.viewer.dialog(request);
      setConflict(reply.conflict);
      if (reply.listing) {
        setNewFolder(undefined);
        navigate(reply.listing.path);
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    if (!busy) void send({ kind: 'cancel', id: prompt.id });
  };
  const choose = (paths: string[], replace = false) =>
    void send({ kind: 'choose', id: prompt.id, paths, replace });
  const submit = () => {
    if (loading || busy || !listing) return;
    if (prompt.mode === 'save') {
      if (!name.trim() || /[\/\\]/.test(name)) {
        setError('Enter a file name without path separators.');
        return;
      }
      let filename = name;
      if (!filename.includes('.') && extensions[0] && extensions[0] !== '*')
        filename += '.' + extensions[0];
      choose([folder + (folder.endsWith(prompt.separator) ? '' : prompt.separator) + filename]);
    } else {
      const byPath = new Map(listing.entries.map((entry) => [entry.path, entry]));
      const selected = selection.flatMap((path) => {
        const entry = byPath.get(path);
        return entry ? [entry] : [];
      });
      if (selected.length === 1 && canBrowse(selected[0]!) && !prompt.directory)
        navigate(selected[0]!.path);
      else if (selected.length) choose(selected.map((entry) => entry.path));
      else if (prompt.directory) choose([folder]);
    }
  };
  const select = (index: number, shift = false, toggle = false) => {
    const entry = entries[index];
    if (!entry || !allowed(entry)) return;
    setCursor(index);
    setConflict(undefined);
    if (prompt.multiple && shift)
      setSelection(
        entries
          .slice(Math.min(anchor.current, index), Math.max(anchor.current, index) + 1)
          .filter(canChoose)
          .map((entry) => entry.path),
      );
    else {
      anchor.current = index;
      setSelection((previous) =>
        prompt.multiple && toggle && canChoose(entry)
          ? previous.includes(entry.path)
            ? previous.filter((path) => path !== entry.path)
            : [
                ...previous.filter((path) =>
                  entries.some((item) => item.path === path && canChoose(item)),
                ),
                entry.path,
              ]
          : [entry.path],
      );
    }
    if (prompt.mode === 'save' && !canBrowse(entry)) setName(entry.name);
  };
  const open = (entry: FileEntry) => {
    if (canBrowse(entry)) navigate(entry.path);
    else if (prompt.mode === 'open' && allowed(entry)) choose([entry.path]);
    else if (prompt.mode === 'save') nameInput.current?.focus();
  };
  const keydown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      let next = cursor < 0 ? 0 : cursor + direction;
      while (entries[next] && !allowed(entries[next]!)) next += direction;
      if (entries[next]) {
        select(next, event.shiftKey, event.ctrlKey || event.metaKey);
        virtual.scrollToIndex(next, { align: 'auto' });
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[cursor];
      if (entry && canBrowse(entry) && selection.length <= 1) navigate(entry.path);
      else submit();
    } else if (event.key === ' ' && entries[cursor]) {
      event.preventDefault();
      select(cursor, event.shiftKey, true);
    } else if (
      event.key.toLowerCase() === 'a' &&
      (event.metaKey || event.ctrlKey) &&
      prompt.multiple
    ) {
      event.preventDefault();
      setSelection(entries.filter(canChoose).map((entry) => entry.path));
    }
  };
  const click = (event: MouseEvent, index: number) => {
    select(index, event.shiftKey, event.metaKey || event.ctrlKey);
    scroll.current?.focus();
  };
  return (
    <Dialog
      title={prompt.title}
      className="viewer-file-picker"
      onClose={cancel}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'g') {
          event.preventDefault();
          pathInput.current?.focus();
          pathInput.current?.select();
        }
      }}
    >
      <div className="file-picker-navigation">
        <IconButton
          icon="left"
          label="Back"
          disabled={busy || loading || !history.length}
          onClick={() => {
            const previous = history.at(-1);
            if (!previous) return;
            setHistory(history.slice(0, -1));
            void browse(previous);
          }}
        />
        <IconButton
          icon="up"
          label="Parent folder"
          disabled={busy || loading || !listing || listing.parent === folder}
          onClick={() => listing && navigate(listing.parent)}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            navigate(pathText);
          }}
        >
          <Icon name="folder" size={16} />
          <input
            ref={pathInput}
            aria-label="Folder path"
            value={pathText}
            onChange={(event) => setPathText(event.target.value)}
            onFocus={(event) => event.target.select()}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !pathText.trim()}>
            Go
          </button>
        </form>
      </div>
      {prompt.message && <p className="file-picker-message">{prompt.message}</p>}
      <div className="file-picker-browser">
        <nav className="file-picker-places" aria-label="Folders">
          {(['Locations', 'Favorites', 'Recent'] as const).map((group) => {
            const places = prompt.places.filter((item) => item.group === group);
            return places.length ? (
              <section key={group} aria-label={group}>
                <h2>{group}</h2>
                {places.map((place) => (
                  <button
                    key={place.path}
                    type="button"
                    title={place.path}
                    className={folder === place.path ? 'selected' : undefined}
                    disabled={busy}
                    onClick={() => navigate(place.path)}
                  >
                    <Icon
                      name={
                        place.name === 'Home'
                          ? 'home'
                          : group === 'Favorites'
                            ? 'star'
                            : group === 'Recent'
                              ? 'clock'
                              : 'folder'
                      }
                      size={16}
                    />
                    <span>{place.name}</span>
                  </button>
                ))}
              </section>
            ) : null;
          })}
        </nav>
        <div className="file-picker-content">
          <div className="file-picker-filter">
            <Icon name="search" size={16} />
            <input
              aria-label="Filter files"
              placeholder="Filter by name…"
              data-autofocus={prompt.mode === 'open' || undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelection([]);
                setCursor(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  scroll.current?.focus();
                  keydown(event);
                }
              }}
              disabled={busy}
            />
            <IconButton
              icon="eye"
              label="Show hidden files"
              aria-pressed={hidden}
              className={hidden ? 'selected' : undefined}
              disabled={busy}
              onClick={() => {
                setHidden(!hidden);
                setSelection([]);
                setCursor(-1);
              }}
            />
          </div>
          <div className="file-picker-columns" aria-hidden="true">
            <span>Name</span>
            <span>Size</span>
          </div>
          <div
            ref={scroll}
            className="file-picker-files"
            role="listbox"
            tabIndex={0}
            aria-label="Files and folders"
            aria-multiselectable={prompt.multiple || undefined}
            aria-busy={loading}
            aria-activedescendant={cursor >= 0 ? `picker-entry-${cursor}` : undefined}
            onKeyDown={keydown}
            onClick={(event) => {
              if (!(event.target as HTMLElement).closest('[role="option"]')) {
                setSelection([]);
                setCursor(-1);
                event.currentTarget.focus();
              }
            }}
          >
            {loading ? (
              <div className="file-picker-empty" role="status">
                Loading folder…
              </div>
            ) : !entries.length ? (
              <div className="file-picker-empty" role="status">
                {query ? 'No matching files' : 'This folder is empty'}
              </div>
            ) : (
              <div className="file-picker-rows" style={{ height: virtual.getTotalSize() }}>
                {virtual.getVirtualItems().map((row) => {
                  const entry = entries[row.index]!;
                  return (
                    <div
                      id={`picker-entry-${row.index}`}
                      key={entry.path}
                      role="option"
                      aria-selected={selection.includes(entry.path)}
                      aria-disabled={!allowed(entry)}
                      className={`file-picker-row ${selection.includes(entry.path) ? 'selected' : ''}`}
                      style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                      onClick={(event) => click(event, row.index)}
                      onDoubleClick={() => allowed(entry) && open(entry)}
                      title={entry.error || entry.name}
                    >
                      <Icon
                        name={isPackage(entry) ? 'grid' : entry.directory ? 'folder' : 'file'}
                        size={16}
                      />
                      <span>{entry.name}</span>
                      <small>{entry.directory ? '' : formatBytes(entry.size)}</small>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="file-picker-fields">
        {prompt.mode === 'save' && (
          <label className="file-picker-name">
            File name
            <input
              ref={nameInput}
              data-autofocus
              value={name}
              maxLength={255}
              onChange={(event) => {
                setName(event.target.value);
                setConflict(undefined);
              }}
              onFocus={(event) => {
                const end = event.target.value.lastIndexOf('.');
                event.target.setSelectionRange(0, end > 0 ? end : event.target.value.length);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
              disabled={busy}
            />
          </label>
        )}
        {prompt.filters.length > 0 && (
          <div className="file-picker-type">
            <span>File type</span>
            <ChoiceButton
              label="File type"
              value={filter}
              choices={prompt.filters.map((item, index) => ({
                value: String(index),
                label: `${item.name} (${item.extensions.map((extension) => '*.' + extension).join(', ')})`,
              }))}
              onChoose={(value) => {
                setFilter(value);
                setSelection([]);
                setCursor(-1);
                setConflict(undefined);
              }}
            />
          </div>
        )}
        {newFolder !== undefined && (
          <form
            className="file-picker-new-folder"
            onSubmit={(event) => {
              event.preventDefault();
              void send({ kind: 'new-folder', id: prompt.id, parent: folder, name: newFolder });
            }}
          >
            <label>
              New folder
              <input
                autoFocus
                aria-label="New folder name"
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
                maxLength={255}
                disabled={busy}
              />
            </label>
            <button type="button" disabled={busy} onClick={() => setNewFolder(undefined)}>
              Cancel
            </button>
            <button className="button-secondary" disabled={busy || !newFolder.trim()}>
              Create
            </button>
          </form>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {conflict && (
          <div className="file-picker-conflict" role="alert">
            <strong>Replace this file?</strong>
            <p>{conflict}</p>
            <p>The previous version will be kept in the Trash or as a recovery copy.</p>
            <div>
              <button disabled={busy} onClick={() => setConflict(undefined)}>
                Keep existing file
              </button>
              <button className="danger" disabled={busy} onClick={() => choose([conflict], true)}>
                Replace file
              </button>
            </div>
          </div>
        )}
      </div>
      <footer>
        <button
          className="file-picker-system"
          disabled={busy}
          onClick={() => void send({ kind: 'system', id: prompt.id })}
        >
          System dialog…
        </button>
        <IconButton
          icon="folder-plus"
          label="New folder"
          disabled={busy || loading || !listing}
          onClick={() => setNewFolder('')}
        />
        <span className="file-picker-selection">
          {selection.length
            ? `${selection.length} selected`
            : prompt.directory && listing
              ? folder.split(prompt.separator).filter(Boolean).at(-1) || folder
              : ''}
        </span>
        <button disabled={busy} onClick={cancel}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            loading ||
            !listing ||
            !!conflict ||
            (prompt.mode === 'save' ? !name.trim() : !prompt.directory && !selection.length)
          }
          onClick={submit}
        >
          {prompt.buttonLabel}
        </button>
      </footer>
    </Dialog>
  );
}
