import { useMemo, useRef, useState } from 'react';
import { maximumWorkspaces, orderedWorkspaces } from '../../../domain/workspaces/catalog';
import { report, useViewer } from '../../state/store';
import { Dialog, IconButton } from '../primitives';
import { Icon } from '../Icon';
import { ChoiceButton } from '../ChoiceMenu';
import './workspaces.css';

const pageSize = 25;

export function WorkspacesDialog({
  onClose,
  onOpen,
  onAction,
}: {
  onClose(): void;
  onOpen(id: string): Promise<void>;
  onAction(kind: 'new' | 'rename' | 'delete', id: string): void;
}) {
  const saved = useViewer((state) => state.saved);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [page, setPage] = useState(0);
  const [opening, setOpening] = useState(false);
  const list = useRef<HTMLUListElement>(null);
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
                    {space.panes.length} {space.panes.length === 1 ? 'plane' : 'planes'}
                  </small>
                </span>
              </button>
              <IconButton
                icon="rename"
                label={`Rename ${space.name}`}
                disabled={opening || elsewhere}
                title={elsewhere ? 'Switch to this workspace’s window to rename it' : undefined}
                onClick={() => onAction('rename', space.id)}
              />
              <IconButton
                icon="trash"
                label={`Delete ${space.name}`}
                disabled={opening || elsewhere}
                title={elsewhere ? 'Switch to this workspace’s window to delete it' : undefined}
                onClick={() => onAction('delete', space.id)}
              />
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
          New workspace…
        </button>
        <span className="workspace-catalog-count" role="status">
          {matches.length === saved.workspaces.length
            ? `${matches.length} workspaces`
            : `${matches.length} of ${saved.workspaces.length} workspaces`}
        </span>
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
    </Dialog>
  );
}
