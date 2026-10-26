/*
 * THESIS: Choose a real checkout and place its folder beside the current one.
 * OWN-WORLD: Existing Viewer dialog, flat branch/location rows, shared theme tokens.
 * STORY: Find a branch, inspect its state, open a view or return to an existing one.
 * FIRST VIEWPORT: Search and repository, checkout list, selected status, explicit open actions.
 * FORM: Operate-mode extension; inherited interface, no new visual identity.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CapturedTarget } from '../../../domain/automation/actions';
import type { GitSnapshot } from '../../../domain/comparison/git';
import {
  worktreeLabel,
  type WorktreeCatalog,
  type WorktreeCreation,
} from '../../../domain/comparison/worktrees';
import { errorMessage } from '../../../domain/errors';
import type { WorkspaceController } from '../../workspace/context';
import { getState, receiveSettings, useViewer } from '../../state/store';
import { Dialog, IconButton } from '../../ui/primitives';
import './worktrees.css';
import { CreateWorktree } from './CreateWorktree';

interface Inspection {
  id: string;
  snapshot?: GitSnapshot;
  error?: string;
}

export function WorktreesDialog({
  target,
  workspace,
  onClose,
}: {
  target: CapturedTarget;
  workspace: WorkspaceController;
  onClose(): void;
}) {
  const [catalog, setCatalog] = useState<WorktreeCatalog>();
  const [selectedID, setSelectedID] = useState('');
  const [search, setSearch] = useState('');
  const [inspection, setInspection] = useState<Inspection>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const enabled = useViewer((state) => state.settings.settings.git.enabled);
  const panes = useViewer(
    (state) => state.saved.workspaces.find((space) => space.id === target.workspaceID)?.panes,
  );
  const mounted = useRef(false);
  const pending = useRef(false);
  const catalogRef = useRef<WorktreeCatalog | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (
      catalog?.worktrees.filter(
        (tree) =>
          !needle || `${worktreeLabel(tree)} ${tree.path}`.toLocaleLowerCase().includes(needle),
      ) ?? []
    );
  }, [catalog, search]);
  const selected = visible.find((tree) => tree.id === selectedID) ?? visible[0];
  const existing = selected
    ? (panes?.filter((pane) => pane.type === 'folder' && pane.path === selected.path).length ?? 0)
    : 0;
  const status = inspection?.id === selected?.id ? inspection : undefined;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = catalogRef.current;
      if (current)
        void window.viewer.gitWorktrees({ kind: 'release', catalogID: current.id }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.viewer
      .gitWorktrees({ kind: 'list', directory: target.directory })
      .then((reply) => {
        if (reply.kind !== 'catalog') throw new Error('The worktree list could not be read.');
        if (cancelled) {
          void window.viewer
            .gitWorktrees({ kind: 'release', catalogID: reply.catalog.id })
            .catch(() => {});
          return;
        }
        const previous = catalogRef.current;
        catalogRef.current = reply.catalog;
        setCatalog(reply.catalog);
        setSelectedID(
          reply.catalog.worktrees.find((tree) => tree.path === reply.catalog.currentPath)?.id ??
            reply.catalog.worktrees[0]?.id ??
            '',
        );
        setError('');
        if (previous)
          void window.viewer
            .gitWorktrees({ kind: 'release', catalogID: previous.id })
            .catch(() => {});
      })
      .catch((error) => {
        if (!cancelled) setError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target.directory, reload]);

  useEffect(() => {
    if (!catalog || !selected?.available) return;
    let cancelled = false;
    const id = selected.id;
    // Coalesce rapid keyboard selection before starting a bounded status read.
    const timer = setTimeout(() => {
      void window.viewer
        .gitWorktrees({ kind: 'inspect', catalogID: catalog.id, worktreeID: id })
        .then((reply) => {
          if (reply.kind !== 'status') throw new Error('Checkout status could not be read.');
          if (!cancelled) setInspection({ id, snapshot: reply.snapshot });
        })
        .catch((error) => {
          if (!cancelled) setInspection({ id, error: errorMessage(error) });
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [catalog, selected?.id, selected?.available]);

  const open = async (another = false) => {
    if (!catalog || !selected?.available || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await workspace.openWorktree(
        target,
        { catalogID: catalog.id, worktreeID: selected.id },
        another,
      );
      if (mounted.current) onClose();
    } catch (error) {
      if (mounted.current) setError(errorMessage(error));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const create = async (checkout: WorktreeCreation['checkout'], destination: string) => {
    if (!catalog || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await window.viewer.gitWorktrees({
        kind: 'create',
        catalogID: catalog.id,
        target,
        checkout,
        destination,
      });
      if (result.kind !== 'created') throw new Error('The worktree could not be created.');
      const previous = catalogRef.current;
      catalogRef.current = result.catalog;
      if (mounted.current) {
        setCatalog(result.catalog);
        setSelectedID(result.worktreeID);
        setCreating(false);
      }
      if (previous)
        void window.viewer
          .gitWorktrees({ kind: 'release', catalogID: previous.id })
          .catch(() => {});
      const paneID = await workspace.openWorktree(target, {
        catalogID: result.catalog.id,
        worktreeID: result.worktreeID,
      });
      workspace.openGitChanges(result.entry.path, paneID);
      if (mounted.current) onClose();
    } catch (value) {
      if (mounted.current) setError(errorMessage(value));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Dialog
      title={creating ? 'Create worktree' : 'Open worktree'}
      wide
      className="worktrees-dialog"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      {!creating && (
        <div className="worktrees-controls">
          <input
            type="search"
            aria-label="Find worktree"
            placeholder="Find branch or folder"
            data-autofocus
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <IconButton
            icon="refresh"
            label="Refresh worktrees"
            disabled={loading || busy}
            onClick={() => {
              setLoading(true);
              setReload((value) => value + 1);
            }}
          />
          <button
            type="button"
            disabled={busy || loading || !catalog?.branches?.length || !!catalog.creationProblem}
            onClick={() => {
              setError('');
              setCreating(true);
            }}
          >
            Create worktree…
          </button>
        </div>
      )}
      <p className="worktrees-repository" title={catalog?.repository ?? target.directory}>
        {catalog?.repository ?? target.directory}
      </p>
      {error && (
        <p className="worktrees-error" role="alert">
          {error}
        </p>
      )}
      {creating && catalog ? (
        <CreateWorktree
          key={catalog.id}
          catalog={catalog}
          busy={busy}
          create={create}
          cancel={() => setCreating(false)}
          show={(id) => {
            setSelectedID(id);
            setSearch('');
            setCreating(false);
          }}
        />
      ) : (
        <>
          {catalog?.creationProblem && (
            <p className="worktrees-creation-problem">{catalog.creationProblem}</p>
          )}
          <div
            className="worktrees-list"
            ref={list}
            role="listbox"
            aria-label="Repository worktrees"
            aria-busy={loading}
            tabIndex={0}
            aria-activedescendant={selected ? `worktree-${selected.id}` : undefined}
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !visible.length)
                return;
              event.preventDefault();
              const current = visible.findIndex((tree) => tree.id === selected?.id);
              const index =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? visible.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          visible.length - 1,
                          current + (event.key === 'ArrowDown' ? 1 : -1),
                        ),
                      );
              setSelectedID(visible[index]!.id);
              document
                .getElementById(`worktree-${visible[index]!.id}`)
                ?.scrollIntoView({ block: 'nearest' });
            }}
          >
            {visible.map((tree) => (
              <button
                type="button"
                role="option"
                aria-selected={tree.id === selected?.id}
                id={`worktree-${tree.id}`}
                key={tree.id}
                tabIndex={-1}
                className="worktree-option"
                onClick={() => {
                  setSelectedID(tree.id);
                  list.current?.focus();
                }}
              >
                <span className="worktree-branch">{worktreeLabel(tree)}</span>
                <span className="worktree-location" title={tree.path}>
                  {tree.path}
                </span>
                <span className="worktree-state">
                  {tree.path === catalog?.currentPath
                    ? 'Current checkout'
                    : tree.bare
                      ? 'Bare'
                      : tree.prunable !== undefined
                        ? 'Prunable'
                        : !tree.available
                          ? 'Unavailable'
                          : 'Checkout'}
                  {tree.locked !== undefined ? ' · Locked' : ''}
                </span>
              </button>
            ))}
            {!visible.length && (
              <p className="worktrees-empty">
                {loading
                  ? 'Reading existing worktrees…'
                  : search
                    ? 'No worktrees match.'
                    : 'No registered checkouts found.'}
              </p>
            )}
          </div>
          {selected && (
            <section className="worktree-inspection" aria-label="Selected checkout">
              <strong>{worktreeLabel(selected)}</strong>
              <p className="worktree-inspection-path">{selected.path}</p>
              {!selected.available ? (
                <p>{selected.problem}</p>
              ) : status?.error ? (
                <p className="worktrees-error" role="status">
                  {status.error}
                </p>
              ) : status?.snapshot ? (
                <p role="status">
                  {status.snapshot.changes.length
                    ? `${status.snapshot.changes.length} ${status.snapshot.changes.length === 1 ? 'change' : 'changes'}`
                    : 'Clean'}
                  {status.snapshot.ahead ? ` · ${status.snapshot.ahead} ahead` : ''}
                  {status.snapshot.behind ? ` · ${status.snapshot.behind} behind` : ''}
                  {selected.commit ? ` · ${selected.commit.slice(0, 8)}` : ' · No commits yet'}
                </p>
              ) : (
                <p role="status">Reading checkout status…</p>
              )}
              {selected.locked !== undefined && (
                <p>Locked{selected.locked ? `: ${selected.locked}` : ''}</p>
              )}
            </section>
          )}
          <div className="worktrees-preferences">
            <label>
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  void window.viewer
                    .settingsPatch(
                      [{ path: 'settings.git.enabled', value: enabled }],
                      getState().settings.revision,
                    )
                    .then(receiveSettings)
                    .catch((error) => {
                      if (mounted.current) setError(errorMessage(error));
                    });
                }}
              />
              Show Git status in folder planes
            </label>
            <p>
              Views of one checkout share files and staging. Each view keeps its own navigation.
            </p>
          </div>
          <footer>
            {existing > 0 && (
              <button
                type="button"
                disabled={busy || loading || !selected?.available}
                onClick={() => {
                  void open(true);
                }}
              >
                Another view beside
              </button>
            )}
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || loading || !selected?.available}
              onClick={() => {
                void open();
              }}
            >
              {busy ? 'Opening…' : existing ? 'Show existing plane' : 'Open beside'}
            </button>
          </footer>
        </>
      )}
    </Dialog>
  );
}
