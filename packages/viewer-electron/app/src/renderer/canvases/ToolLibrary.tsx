import { useCallback, useEffect, useState } from 'react';
import type { ToolLibraryPane } from '../../domain/contracts';
import type { CanvasLibraryEntry, CanvasLibraryReply } from '../../domain/canvases/library';
import { baseName } from '../../domain/workspaces/planes';
import { errorMessage } from '../../domain/errors';
import { useWorkspace } from '../workspace/context';
import { Empty, Loading, PathField } from '../ui/primitives';
import './tools.css';

export default function ToolLibrary({ pane }: { pane: ToolLibraryPane }) {
  const workspace = useWorkspace();
  const [library, setLibrary] = useState<CanvasLibraryReply>();
  const [query, setQuery] = useState('');
  const [selectedID, setSelectedID] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLibrary(await window.viewer.canvasLibrary({ kind: 'list' }));
  }, []);
  useEffect(() => {
    let live = true;
    void window.viewer.canvasLibrary({ kind: 'list' }).then(
      (value) => {
        if (live) setLibrary(value);
      },
      (error: unknown) => {
        if (live) setError(errorMessage(error));
      },
    );
    return () => {
      live = false;
    };
  }, []);
  const act = async (work: () => Promise<unknown>, refresh = true) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
      if (refresh) await load();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const configure = async (entry: CanvasLibraryEntry, title: string, enabled: boolean) => {
    const reply = await window.viewer.canvasLibrary({
      kind: 'configure',
      id: entry.id,
      revision: entry.revision,
      title,
      enabled,
    });
    setLibrary(reply);
    setName(title);
  };
  const selected = library?.entries.find((entry) => entry.id === selectedID);
  const needle = query.trim().toLocaleLowerCase();
  const rows = library?.entries.filter((entry) =>
    `${entry.title} ${entry.path}`.toLocaleLowerCase().includes(needle),
  );
  return (
    <section className="tool-library" aria-label="Tool library">
      <header className="tool-library-toolbar" data-viewer-overlay-protected="tool-library-toolbar">
        <input
          type="search"
          aria-label="Search tools"
          placeholder="Search tools or projects…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button disabled={busy} onClick={() => void act(load, false)}>
          Refresh
        </button>
        <button disabled={busy} onClick={() => void act(() => workspace.newChat([]))}>
          New tool…
        </button>
      </header>
      {error && (
        <p className="canvas-message" role="alert">
          {error}
        </p>
      )}
      {!library && !error ? (
        <Loading label="Opening tool library…" />
      ) : !library ? null : !library.entries.length ? (
        <Empty
          title="Your tools live here"
          detail="Ask an agent to build a tool in Chat. Its code, context and saved inputs appear here."
        />
      ) : (
        <div className="tool-library-content">
          <div className="tool-library-list">
            <table>
              <caption className="visually-hidden">Saved project tools</caption>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Project</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((entry) => (
                  <tr key={entry.id} data-selected={selectedID === entry.id || undefined}>
                    <th scope="row">
                      <button
                        aria-pressed={selectedID === entry.id}
                        onClick={() => {
                          setSelectedID(entry.id);
                          setName(entry.title);
                        }}
                      >
                        {entry.title}
                        <small>Revision {entry.revision}</small>
                      </button>
                    </th>
                    <td title={entry.path}>{baseName(entry.path)}</td>
                    <td>{entry.problem ?? (entry.enabled ? 'Enabled' : 'Disabled')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows?.length && <p className="tool-library-hint">No tools match “{query}”.</p>}
            {library.truncated && (
              <p className="tool-library-hint">Showing up to 1,000 saved tools.</p>
            )}
          </div>
          {selected ? (
            <aside className="tool-library-details" aria-label="Selected tool">
              <h2>{selected.title}</h2>
              <p>
                {selected.sources} sources · {selected.assets} assets · Revision {selected.revision}
              </p>
              {selected.path && <PathField path={selected.path} />}
              {selected.problem && <p role="status">{selected.problem}</p>}
              <div className="tool-library-actions">
                <button
                  disabled={busy || !selected.available}
                  onClick={() => void act(() => workspace.openCanvas(selected.id, pane.id))}
                >
                  Open tool
                </button>
                <button
                  disabled={busy || !selected.available}
                  onClick={() =>
                    void act(async () => {
                      const { document } = await window.viewer.canvas({
                        kind: 'read',
                        id: selected.id,
                      });
                      await workspace.openChat(document.conversationID, pane.id);
                    })
                  }
                >
                  Conversation
                </button>
                <button
                  disabled={busy || !selected.available}
                  onClick={() =>
                    void act(async () => {
                      const reply = await window.viewer.chat({
                        kind: 'duplicate-canvas',
                        id: selected.id,
                      });
                      if (!Array.isArray(reply) && reply.canvasID)
                        await workspace.openCanvas(reply.canvasID, pane.id);
                    })
                  }
                >
                  Duplicate
                </button>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(() => configure(selected, name.trim(), selected.enabled));
                }}
              >
                <label>
                  Name
                  <input
                    value={name}
                    maxLength={200}
                    required
                    disabled={busy || !selected.available}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <button
                  disabled={
                    busy || !selected.available || !name.trim() || name.trim() === selected.title
                  }
                >
                  Rename
                </button>
              </form>
              <label className="tool-library-enabled">
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  disabled={busy || !selected.available}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void act(() => configure(selected, selected.title, enabled));
                  }}
                />
                Enable tool
              </label>
              <p className="tool-library-hint">
                Disabling stops the tool and prevents its actions from running.
              </p>
            </aside>
          ) : (
            <p className="tool-library-hint">Select a tool to manage it.</p>
          )}
        </div>
      )}
    </section>
  );
}
