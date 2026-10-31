import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  activeWorkspace,
  useViewer,
  basketEntries,
  removeFromBasket,
  saveCollection,
  changeWorkspace,
} from '../../state/store';
import { useWorkspace } from '../../workspace/context';
import { Dialog, Loading } from '../primitives';
import { prepareOperationReview } from '../operations/OperationReview';
import type { Collection } from '../../../domain/workspaces/collections';
import { errorMessage } from '../../../domain/errors';
import { maxQueryLength } from '../../../domain/search/query';
import { useWindowEvent } from '../../app/window-events';
import { Disclosure } from '../Disclosure';
/** Every basket reference stays reachable, however many there are. */
function BasketList({ paths, busy }: { paths: string[]; busy: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: paths.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 40,
    overscan: 8,
  });
  if (!paths.length) return null;
  return (
    <div ref={viewport} className="basket-list">
      <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
        {rows.getVirtualItems().map((virtual) => {
          const path = paths[virtual.index];
          if (path === undefined) return null;
          return (
            <div
              key={path}
              className="project-control-row"
              style={{
                position: 'absolute',
                width: '100%',
                height: virtual.size,
                transform: `translateY(${virtual.start}px)`,
              }}
            >
              <span title={path}>{path}</span>
              <button disabled={busy} onClick={() => removeFromBasket([path])}>
                Remove
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
export function CollectionControls() {
  const space = useViewer(activeWorkspace),
    workspace = useWorkspace();
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [query, setQuery] = useState(''),
    [queryRoot, setQueryRoot] = useState(''),
    [content, setContent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useWindowEvent('viewer:collections', () => {
    setOpen(true);
    setError('');
  });
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  if (!open) return null;
  const basket = space.basket ?? [];
  const save = (kind: Collection['kind']) => {
    saveCollection({
      id: crypto.randomUUID(),
      name: name.trim(),
      kind,
      sources: kind === 'explicit' ? basket.map((item) => item.path) : [queryRoot],
      ...(kind === 'query' ? { query, content, recursive: true } : {}),
    });
    setName('');
  };
  return (
    <Dialog wide title="Collections and basket" onClose={() => !busy && setOpen(false)}>
      <div className="dialog-body collections-body">
        <div className="project-control-row">
          <strong>Basket · {basket.length} files</strong>
          <button
            disabled={busy || !basket.length}
            onClick={() => removeFromBasket(basket.map((item) => item.path))}
          >
            Clear basket
          </button>
        </div>
        <BasketList paths={basket.map((item) => item.path)} busy={busy} />
        <div className="settings-actions">
          <button
            disabled={busy || !basket.length}
            onClick={() =>
              void run(async () => {
                const root = await window.viewer.chooseFolder();
                if (!root) return;
                await prepareOperationReview('Copy basket files', [
                  {
                    kind: 'copy',
                    sources: basket.map((item) => item.path),
                    expectedSources: basket.map(({ path, version }) => ({ path, version })),
                    destination: root,
                  },
                ]);
                setOpen(false);
              })
            }
          >
            Review copy…
          </button>
          <button
            disabled={busy || !basket.length}
            onClick={() =>
              void run(async () => {
                const root = await window.viewer.chooseFolder();
                if (!root) return;
                await prepareOperationReview('Move basket files', [
                  {
                    kind: 'move',
                    sources: basket.map((item) => item.path),
                    expectedSources: basket.map(({ path, version }) => ({ path, version })),
                    destination: root,
                  },
                ]);
                setOpen(false);
              })
            }
          >
            Review move…
          </button>
          <button
            disabled={busy || !basket.length}
            onClick={() =>
              void run(async () => {
                const entries = [];
                for (const item of basket) entries.push(await window.viewer.stat(item.path));
                basketEntries(entries);
              })
            }
          >
            Refresh source versions
          </button>
        </div>
        <label className="field-label">
          Collection name
          <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="settings-actions">
          <button
            disabled={busy || !basket.length || !name.trim()}
            onClick={() => {
              try {
                save('explicit');
              } catch (error) {
                setError(errorMessage(error));
              }
            }}
          >
            Save basket as collection
          </button>
        </div>
        <Disclosure variant="compact" summary="New query collection">
          <div className="collections-query-form">
            <label className="field-label">
              Query
              <input
                value={query}
                maxLength={maxQueryLength}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="field-label">
              Folder
              <input value={queryRoot} onChange={(event) => setQueryRoot(event.target.value)} />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const root = await window.viewer.chooseFolder();
                  if (root) setQueryRoot(root);
                })
              }
            >
              Choose folder…
            </button>
            <label className="review-checkpoint">
              <input
                type="checkbox"
                checked={content}
                onChange={(event) => setContent(event.target.checked)}
              />
              <span>Search indexed file contents</span>
            </label>
            <button
              disabled={busy || !name.trim() || !query.trim() || !queryRoot}
              onClick={() => {
                try {
                  save('query');
                } catch (error) {
                  setError(errorMessage(error));
                }
              }}
            >
              Save query collection
            </button>
          </div>
        </Disclosure>
        <h3>Named collections</h3>
        {(space.collections ?? []).map((collection) => (
          <div className="project-control-row" key={collection.id}>
            <span>
              <strong>{collection.name}</strong>
              <small>
                {collection.kind === 'explicit'
                  ? collection.sources.length + ' references'
                  : collection.kind === 'tag'
                    ? 'Tagged “' + collection.tag + '”'
                    : collection.query}
              </small>
            </span>
            <div className="settings-actions">
              <button
                disabled={busy}
                onClick={() => {
                  workspace.openCollection(collection.id);
                  setOpen(false);
                }}
              >
                Open plane
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  for (const pane of space.panes)
                    if (pane.type === 'collection' && pane.collectionID === collection.id)
                      workspace.closePane(pane.id);
                  changeWorkspace((value) => ({
                    ...value,
                    collections: value.collections?.filter((item) => item.id !== collection.id),
                    ...(value.project
                      ? {
                          project: {
                            ...value.project,
                            definition: {
                              ...value.project.definition,
                              collections: value.project.definition.collections?.filter(
                                (item) => item.id !== collection.id,
                              ),
                            },
                          },
                        }
                      : {}),
                  }));
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {busy && <Loading />}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button disabled={busy} onClick={() => setOpen(false)}>
          Done
        </button>
      </footer>
    </Dialog>
  );
}
