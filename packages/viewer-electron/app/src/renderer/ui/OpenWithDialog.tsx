import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApplicationChoices, NativeApplication } from '../../domain/metadata';
import { Dialog, Loading } from './primitives';
import { Icon } from './Icon';

export function OpenWithDialog({ paths, onClose }: { paths: string[]; onClose(): void }) {
  const [choices, setChoices] = useState<ApplicationChoices>();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void window.viewer
      .applications(paths)
      .then((value) => {
        if (live) setChoices(value);
      })
      .catch((error) => {
        if (live) {
          setError(error instanceof Error ? error.message : String(error));
          setChoices({ supported: true, applications: [] });
        }
      });
    return () => {
      live = false;
    };
  }, [paths]);
  const applications = useMemo(
    () =>
      choices?.applications.filter((app) =>
        app.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ) || [],
    [choices, query],
  );
  const selected = applications[Math.min(index, Math.max(0, applications.length - 1))];
  const open = async (application: NativeApplication) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await window.viewer.openWith(paths, application.id);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };
  const choose = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const application = await window.viewer.chooseApplication();
      if (application) {
        await window.viewer.openWith(paths, application.id);
        onClose();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Open With"
      onClose={() => {
        if (!busy) onClose();
      }}
      className="open-with-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (selected) void open(selected);
        }}
      >
        <label className="application-search">
          <Icon name="search" size={18} />
          <input
            data-autofocus
            aria-label="Search applications"
            aria-controls="application-options"
            aria-activedescendant={selected ? `application-${selected.id}` : undefined}
            placeholder="Search applications…"
            value={query}
            disabled={busy}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                const next = Math.max(
                  0,
                  Math.min(applications.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                );
                setIndex(next);
                list.current?.children[next]?.scrollIntoView({ block: 'nearest' });
              }
            }}
          />
        </label>
        <div
          id="application-options"
          className="application-options"
          ref={list}
          role="listbox"
          aria-label="Compatible applications"
        >
          {!choices ? (
            <Loading label="Finding applications…" />
          ) : !applications.length ? (
            <p className="application-empty">
              {choices.supported
                ? query
                  ? 'No matching applications.'
                  : 'No compatible applications found. Choose an application below.'
                : 'Application selection is not available on this platform yet.'}
            </p>
          ) : (
            applications.map((app, i) => (
              <button
                key={app.id}
                id={`application-${app.id}`}
                type="button"
                role="option"
                aria-selected={app.id === selected?.id}
                disabled={busy}
                className="application-option"
                onMouseMove={() => setIndex(i)}
                onClick={() => {
                  void open(app);
                }}
              >
                <Icon name="external" size={18} />
                <span>{app.name}</span>
                {app.default && <small>Default</small>}
              </button>
            ))
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            disabled={busy || choices?.supported === false}
            onClick={() => {
              void choose();
            }}
          >
            Choose Application…
          </button>
          <span className="toolbar-spacer" />
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !selected}>
            {busy ? 'Opening…' : 'Open'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
