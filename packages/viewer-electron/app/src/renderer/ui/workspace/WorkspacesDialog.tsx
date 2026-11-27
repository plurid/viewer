import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { DefinitionDialogKind } from './DefinitionDialog';
import type { WorkspaceDefinition } from '../../../domain/workspaces/definitions/schema';
import { rankWorkspaceChoices } from '../../../domain/workspaces/definitions/query';
import { canCaptureDefinition } from '../../../domain/workspaces/definitions/capture';
import { openDefinition, receiveDefinitions } from '../../state/definitions';
import { ProjectManagerOffer } from './ProjectManagerOffer';
import {
  definitionLinkMatches,
  definitionSourceNotice,
  definitionWasRemoved,
  linkedDefinition,
  maximumWorkspaces,
  orderedWorkspaces,
  richDefinition,
  richSummary,
} from '../../../domain/workspaces/catalog';
import { plural } from '../../../domain/plural';
import { announce, report, useViewer } from '../../state/store';
import { Dialog, IconButton } from '../primitives';
import { Icon } from '../Icon';
import { PathLabel } from '../PathLabel';
import { ChoiceButton } from '../ChoiceMenu';
import { Disclosure } from '../Disclosure';
import './workspaces.css';

const pageSize = 25;
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export type WorkspaceTab = 'open' | 'defined';
type OpenWorkspaceSort = 'recent' | 'name';
type DefinedWorkspaceSort = 'recent' | 'key';
type WorkspaceRowAction = 'new' | 'rename' | 'delete' | DefinitionDialogKind;

export function WorkspacesDialog({
  onClose,
  onOpen,
  onAction,
  initialTab = 'open',
}: {
  onClose(): void;
  onOpen(id: string): Promise<void>;
  onAction(kind: WorkspaceRowAction, id: string): void;
  initialTab?: WorkspaceTab;
}) {
  const saved = useViewer((state) => state.saved);
  const catalog = useViewer((state) => state.bootstrap.definitions);
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<OpenWorkspaceSort>('recent');
  const [page, setPage] = useState(0);
  const [opening, setOpening] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const undo = useRef<HTMLButtonElement>(null);
  // the notice lives with the dialog, so switching tabs and back keeps it
  const [hidden, setHidden] = useState<HiddenFound>();
  const [undoing, setUndoing] = useState(false);
  // while Forget Planes… asks, the eight seconds wait: answering it starts them again
  const [forgetting, setForgetting] = useState(false);
  const focusSearch = (element = panel.current) =>
    element?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  useEffect(() => {
    if (!hidden || forgetting) return;
    const element = panel.current;
    const timer = setTimeout(() => {
      // the notice's buttons go with it: focus they held returns to the search field
      if (element?.querySelector('.workspace-catalog-count')?.contains(document.activeElement))
        focusSearch(element);
      setHidden(undefined);
    }, hiddenUndoTime);
    return () => clearTimeout(timer);
  }, [hidden, forgetting]);
  const undoHide = (row: HiddenFound) => {
    if (undoing) return;
    setUndoing(true);
    setHidden(undefined);
    void window.viewer
      .workspaceDefinitionFile({ kind: 'show-found', root: row.root })
      .then((catalog) => {
        receiveDefinitions(catalog);
        // the desktop says it showed nothing: Settings or another window showed it already
        if (catalog.changed === 0) announce(`“${row.name}” was already shown again.`);
      })
      .catch(report)
      .finally(() => {
        setUndoing(false);
        focusSearch();
      });
  };
  const status = (count: string, forget?: (row: HiddenFound) => void) => (
    <FooterStatus
      count={count}
      hidden={hidden}
      busy={undoing}
      undo={undo}
      onUndo={undoHide}
      onForget={forget}
    />
  );
  const matches = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const rows = orderedWorkspaces(saved).filter((space) =>
      words.every((word) => space.name.toLocaleLowerCase().includes(word)),
    );
    return sort === 'name'
      ? rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      : rows;
  }, [saved, query, sort]);
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const rows = matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const open = (id: string) => {
    if (opening) return;
    setOpening(true);
    void onOpen(id)
      .then(onClose)
      .catch(report)
      .finally(() => setOpening(false));
  };
  const changePage = (value: number) => {
    setPage(value);
    list.current?.scrollTo({ top: 0 });
  };
  return (
    <Dialog title="Workspaces" className="workspaces-dialog" onClose={onClose}>
      <div
        className="workspace-catalog-tabs"
        role="tablist"
        aria-label="Workspace lists"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 'open'
              : event.key === 'End'
                ? 'defined'
                : tab === 'open'
                  ? 'defined'
                  : 'open';
          setTab(next);
          event.currentTarget.querySelector<HTMLButtonElement>('#workspace-tab-' + next)?.focus();
        }}
      >
        <button
          id="workspace-tab-open"
          role="tab"
          aria-controls="workspace-panel"
          aria-selected={tab === 'open'}
          tabIndex={tab === 'open' ? 0 : -1}
          onClick={() => setTab('open')}
        >
          Open ({saved.workspaces.length})
        </button>
        <button
          id="workspace-tab-defined"
          role="tab"
          aria-controls="workspace-panel"
          aria-selected={tab === 'defined'}
          tabIndex={tab === 'defined' ? 0 : -1}
          onClick={() => setTab('defined')}
        >
          Defined ({catalog?.definitions.length ?? 0})
        </button>
      </div>
      <div
        ref={panel}
        id="workspace-panel"
        role="tabpanel"
        aria-labelledby={'workspace-tab-' + tab}
        className="workspace-catalog-panel"
      >
        {tab === 'defined' ? (
          <DefinedRows
            onClose={onClose}
            status={status}
            onHidden={(row) => {
              setHidden(row);
              // the row left the list: keyboard focus continues on Undo
              requestAnimationFrame(() => undo.current?.focus());
            }}
            onForgotten={(key) =>
              setHidden((row) => (row?.key === key ? { ...row, planes: undefined } : row))
            }
            onForgetting={setForgetting}
          />
        ) : (
          <>
            <div className="workspace-catalog-controls">
              <div className="workspace-catalog-search">
                <Icon name="search" size={16} />
                <input
                  data-autofocus
                  type="search"
                  aria-label="Search workspaces"
                  placeholder="Search workspaces…"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    changePage(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing && rows[0]) {
                      event.preventDefault();
                      event.stopPropagation();
                      open(rows[0].id);
                    }
                  }}
                />
              </div>
              <ChoiceButton
                label="Sort workspaces"
                value={sort}
                choices={[
                  { value: 'recent', label: 'Recent first' },
                  { value: 'name', label: 'Name' },
                ]}
                onChoose={(value) => {
                  setSort(value === 'name' ? 'name' : 'recent');
                  changePage(0);
                }}
              />
            </div>
            <ul ref={list} className="workspace-catalog-list" aria-label="Saved workspaces">
              {rows.map((space) => {
                const current = space.id === saved.activeWorkspace;
                const elsewhere = !current && saved.openWindows?.includes(space.id);
                const removed = definitionWasRemoved(space, catalog);
                const sourceNotice = definitionSourceNotice(space, catalog);
                const linked = !!space.definition && !removed;
                const definition = linkedDefinition(space, catalog);
                const changed = definition && definition.basis !== space.definition!.basis;
                return (
                  <li key={space.id} data-workspace-id={space.id}>
                    <button
                      className="workspace-catalog-open"
                      disabled={opening}
                      aria-current={current ? 'true' : undefined}
                      onClick={() => open(space.id)}
                    >
                      <Icon name={current ? 'check' : 'dock'} />
                      <span>
                        <strong>{space.name}</strong>
                        <small>
                          {current
                            ? 'Current workspace · '
                            : elsewhere
                              ? 'Open in another window · '
                              : ''}
                          {plural(space.panes.length, 'plane')}
                          {removed &&
                            ' · ' +
                              (sourceNotice ?? 'Its definition was removed from workspaces.jsonc.')}
                          {sourceNotice && !removed && ' · ' + sourceNotice}
                          {changed && ' · Definition changed'}
                        </small>
                      </span>
                    </button>
                    <IconButton
                      icon="rename"
                      label={`Rename ${space.name}`}
                      disabled={opening || elsewhere}
                      title={
                        elsewhere ? 'Switch to this workspace’s window to rename it' : undefined
                      }
                      onClick={() => onAction('rename', space.id)}
                    />
                    <IconButton
                      icon={linked ? 'close' : 'trash'}
                      label={`${linked ? 'Close' : 'Delete'} ${space.name}`}
                      disabled={opening || elsewhere}
                      title={
                        elsewhere
                          ? 'Switch to that window to ' + (linked ? 'close it.' : 'delete it.')
                          : undefined
                      }
                      onClick={() => onAction(linked ? 'close' : 'delete', space.id)}
                    />
                    {!linked && (
                      <IconButton
                        icon="dock"
                        label={`Save ${space.name} as definition…`}
                        disabled={opening || elsewhere || !canCaptureDefinition(space)}
                        title={
                          !canCaptureDefinition(space)
                            ? 'Open a folder, file, terminal, scratch or search plane first.'
                            : undefined
                        }
                        onClick={() => onAction('save-as', space.id)}
                      />
                    )}
                    {linked && changed && (
                      <button
                        disabled={opening || elsewhere}
                        onClick={() => onAction('reset', space.id)}
                      >
                        Reset to Definition…
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {!matches.length && (
              <p className="workspace-catalog-empty" role="status">
                No matching workspaces.
              </p>
            )}
            <footer>
              <button
                disabled={opening || saved.workspaces.length >= maximumWorkspaces}
                onClick={() => onAction('new', saved.activeWorkspace)}
              >
                New Workspace…
              </button>
              {status(
                matches.length === saved.workspaces.length
                  ? plural(matches.length, 'workspace')
                  : `${matches.length} of ${plural(saved.workspaces.length, 'workspace')}`,
              )}
              {pages > 1 && (
                <nav aria-label="Workspace pages">
                  <IconButton
                    icon="left"
                    label="Previous workspace page"
                    disabled={currentPage === 0}
                    onClick={() => changePage(currentPage - 1)}
                  />
                  <span>
                    {currentPage + 1} / {pages}
                  </span>
                  <IconButton
                    icon="right"
                    label="Next workspace page"
                    disabled={currentPage === pages - 1}
                    onClick={() => changePage(currentPage + 1)}
                  />
                </nav>
              )}
            </footer>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** A found workspace just marked Not a Workspace, which Undo shows again for a while. */
interface HiddenFound {
  key: string;
  name: string;
  root: string;
  /** The planes it remembers, which hiding keeps until it shows again or is forgotten. */
  planes?: number;
}
/** A remembered snapshot to forget, by its definition. */
interface ForgetTarget {
  key: string;
  name: string;
}
const hiddenUndoTime = 8000;

/**
 * A footer's count, or for eight seconds after Not a Workspace what was hidden, with Undo and, for
 * a workspace that remembers planes, a way to forget them. Only the words are announced.
 */
function FooterStatus({
  count,
  hidden,
  busy,
  undo,
  onUndo,
  onForget,
}: {
  count: string;
  hidden?: HiddenFound;
  busy: boolean;
  undo: RefObject<HTMLButtonElement | null>;
  onUndo(row: HiddenFound): void;
  onForget?(row: HiddenFound): void;
}) {
  const notice =
    hidden &&
    `Hid “${hidden.name}”` +
      (hidden.planes ? ` · remembers ${plural(hidden.planes, 'plane')}` : '');
  return (
    <span className="workspace-catalog-count">
      <span role="status" title={notice}>
        {notice ?? count}
      </span>
      {hidden?.planes && onForget && (
        <button disabled={busy} onClick={() => onForget(hidden)}>
          Forget Planes…
        </button>
      )}
      {hidden && (
        <button ref={undo} disabled={busy} onClick={() => onUndo(hidden)}>
          Undo
        </button>
      )}
    </span>
  );
}

function DefinedRows({
  onClose,
  status,
  onHidden,
  onForgotten,
  onForgetting,
}: {
  onClose(): void;
  /** The footer's count, or the Not a Workspace notice; `forget` opens Forget Planes…. */
  status(count: string, forget?: (row: HiddenFound) => void): ReactNode;
  onHidden(row: HiddenFound): void;
  onForgotten(key: string): void;
  /** Whether Forget Planes… is asking, so the notice's eight seconds wait for its answer. */
  onForgetting(open: boolean): void;
}) {
  const catalog = useViewer((state) => state.bootstrap.definitions);
  const saved = useViewer((state) => state.saved);
  const needsAccess = catalog?.projectManager.state === 'needs-access';
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DefinedWorkspaceSort>('recent');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [forget, setForget] = useState<ForgetTarget>();
  useEffect(() => {
    onForgetting(!!forget);
    // leaving the tab closes the question
    return () => onForgetting(false);
  }, [forget, onForgetting]);
  const searchable = useMemo(
    () => catalog?.definitions.map((item) => ({ ...item, hidden: false })) ?? [],
    [catalog],
  );
  const matches = useMemo(() => {
    const ranked = rankWorkspaceChoices([], searchable, query, {}, true).map(
      (choice) => choice.definition!,
    );
    return sort === 'key'
      ? ranked.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      : query.trim()
        ? ranked
        : ranked.sort(
            (a, b) =>
              Math.max(b.openedAt ?? 0, b.remembered?.at ?? 0) -
              Math.max(a.openedAt ?? 0, a.remembered?.at ?? 0),
          );
  }, [searchable, query, sort]);
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const current = Math.min(page, pages - 1);
  const keys = useMemo(
    () => matches.slice(current * pageSize, (current + 1) * pageSize).map((item) => item.key),
    [matches, current],
  );
  const rows = matches.slice(current * pageSize, (current + 1) * pageSize);
  useEffect(() => {
    const timer = setTimeout(() => {
      void window.viewer.workspaceDefinitionFile({ kind: 'catalog', keys }).catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [keys]);
  useEffect(
    () => () => {
      void window.viewer.workspaceDefinitionFile({ kind: 'catalog', keys: [] }).catch(() => {});
    },
    [],
  );
  const action = (run: () => Promise<unknown>) => {
    setBusy(true);
    void run()
      .catch(report)
      .finally(() => setBusy(false));
  };
  const original = (item: WorkspaceDefinition) =>
    catalog?.definitions.find(
      (definition) => definition.key === item.key && definition.source === item.source,
    );
  const open = (item: WorkspaceDefinition) =>
    action(async () => {
      await openDefinition(item.key);
      onClose();
    });
  const notWorkspace = (item: WorkspaceDefinition) =>
    action(async () => {
      receiveDefinitions(
        await window.viewer.workspaceDefinitionFile({ kind: 'not-a-workspace', key: item.key }),
      );
      onHidden({
        key: item.key,
        name: item.name,
        root: item.root,
        planes: item.remembered?.planes,
      });
    });
  return (
    <>
      {catalog?.projectManager.state === 'undecided' && (
        <ProjectManagerOffer
          busy={busy}
          onChoose={(enabled) =>
            action(async () => {
              receiveDefinitions(
                await window.viewer.workspaceDefinitionFile({ kind: 'project-manager', enabled }),
              );
            })
          }
        />
      )}
      <div className="workspace-catalog-controls">
        <div className="workspace-catalog-search">
          <Icon name="search" size={16} />
          <input
            data-autofocus
            type="search"
            aria-label="Search definitions"
            placeholder="Search definitions…"
            value={query}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || busy) return;
              const first = rows.find(
                (item) => !original(item)?.hidden && item.rootState !== 'missing',
              );
              if (first) {
                event.preventDefault();
                open(first);
              }
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </div>
        <ChoiceButton
          label="Sort definitions"
          value={sort}
          choices={[
            { value: 'recent', label: 'Recently opened' },
            { value: 'key', label: 'Key' },
          ]}
          onChoose={(value) => {
            setSort(value === 'key' ? 'key' : 'recent');
            setPage(0);
          }}
        />
      </div>
      <ul className="workspace-catalog-list" aria-label="Defined workspaces">
        {rows.map((item) => {
          const written = original(item);
          const opened = saved.workspaces.some((space) => definitionLinkMatches(space, item));
          const found = item.source === 'found';
          return (
            <li key={item.key}>
              <div className="workspace-catalog-definition">
                <strong>{item.name}</strong>
                <small>{found ? <PathLabel path={item.root} /> : item.key}</small>
                <span className="workspace-catalog-badges">
                  {found && <span>Found</span>}
                  {item.remembered && !opened && (
                    <span>Remembers {plural(item.remembered.planes, 'plane')}</span>
                  )}
                  {richDefinition(item) && <span>{sentence(richSummary(item))}</span>}
                  {item.curated && <span>Asks before saving</span>}
                  {written?.hidden && <span>Hidden</span>}
                  {item.rootState === 'missing' && <span>Folder missing</span>}
                </span>
              </div>
              <button
                disabled={busy || written?.hidden || item.rootState === 'missing'}
                title={
                  written?.hidden
                    ? 'This definition is hidden. Choose Edit Workspace Definitions to show it.'
                    : item.rootState === 'missing'
                      ? 'Its root folder is missing.'
                      : undefined
                }
                onClick={() => open(item)}
              >
                {opened ? 'Switch' : 'Open'}
              </button>
              {found && (
                <button
                  disabled={busy || opened}
                  aria-label={`Not a Workspace: ${item.name}`}
                  title={opened ? `Close “${item.name}” first.` : undefined}
                  onClick={() => notWorkspace(item)}
                >
                  Not a Workspace
                </button>
              )}
              {item.remembered && !opened && (
                <IconButton
                  icon="trash"
                  className="danger"
                  label={`Forget remembered planes for ${item.name}`}
                  disabled={busy}
                  onClick={() => setForget(item)}
                />
              )}
              {/* a found workspace has no entry in workspaces.jsonc to edit */}
              {!found && (
                <IconButton
                  icon="code"
                  label={`Edit workspace definitions for ${item.name}`}
                  disabled={busy}
                  onClick={() =>
                    action(() => window.viewer.workspaceDefinitionFile({ kind: 'edit' }))
                  }
                />
              )}
            </li>
          );
        })}
      </ul>
      {!rows.length && (
        <div className="workspace-catalog-empty">
          <p>
            {searchable.length
              ? 'No matching definitions.'
              : 'No workspace definitions yet. Choose Edit Workspace Definitions to add one.'}
          </p>
          {needsAccess && (
            <button
              onClick={() =>
                action(() => window.viewer.workspaceDefinitionFile({ kind: 'allow-source' }))
              }
            >
              Allow Access…
            </button>
          )}
        </div>
      )}
      {!!catalog?.diagnostics.length && (
        <Disclosure
          variant="compact"
          summary={catalog.diagnostics.length + ' definition problems'}
          className="workspace-catalog-problems"
        >
          <ul>
            {catalog.diagnostics.map((issue, index) => (
              <li key={index}>
                {issue.line ? 'Line ' + issue.line + ': ' : ''}
                {issue.message}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {forget && (
        <Dialog
          title="Forget remembered planes?"
          onClose={() => {
            if (!busy) setForget(undefined);
          }}
        >
          <div className="dialog-copy">
            <p>
              Forget the remembered planes of “{forget.name}”? It opens from its definition next
              time.
            </p>
          </div>
          <footer>
            <button disabled={busy} onClick={() => setForget(undefined)}>
              Cancel
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await window.viewer.workspaceDefinitions({ kind: 'forget', key: forget.key });
                  onForgotten(forget.key);
                  setForget(undefined);
                })
              }
            >
              Forget Remembered Planes
            </button>
          </footer>
        </Dialog>
      )}
      <footer>
        <button
          onClick={() => action(() => window.viewer.workspaceDefinitionFile({ kind: 'edit' }))}
        >
          Edit Workspace Definitions
        </button>
        {/* the notice takes the count's place, so the footer keeps its height */}
        {status(plural(matches.length, 'definition'), (row) =>
          setForget({ key: row.key, name: row.name }),
        )}
        {pages > 1 && (
          <nav aria-label="Definition pages">
            <IconButton
              icon="left"
              label="Previous definition page"
              disabled={!current}
              onClick={() => setPage(current - 1)}
            />
            <span>
              {current + 1} / {pages}
            </span>
            <IconButton
              icon="right"
              label="Next definition page"
              disabled={current + 1 === pages}
              onClick={() => setPage(current + 1)}
            />
          </nav>
        )}
      </footer>
    </>
  );
}
