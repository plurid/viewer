import { useEffect, useRef } from 'react';
import { Empty, Loading } from '../ui/primitives';
import { useWorkspace } from '../workspace/context';
import { report, updatePane } from '../state/store';
import { useGitReview } from './useGitReview';
import type { ReviewMode } from '../../domain/comparison/review';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { useVirtualizer } from '@tanstack/react-virtual';

export default function GitChanges({
  path,
  paneID,
  manual,
}: {
  path: string;
  paneID: string;
  manual?: boolean;
}) {
  if (manual)
    return (
      <Empty
        title="Ready for Git review"
        detail="Load this task’s changes when you are ready. Git may run this repository’s configured filters."
      >
        <button type="button" onClick={() => updatePane(paneID, { activation: undefined })}>
          Load Git changes
        </button>
      </Empty>
    );
  return <ActiveGitChanges path={path} paneID={paneID} />;
}
function ActiveGitChanges({ path, paneID }: { path: string; paneID: string }) {
  const review = useGitReview(path, paneID);
  const workspace = useWorkspace();
  const scroll = useRef<HTMLDivElement>(null);
  const changes = review.snapshot?.files ?? [];
  const selection = changes.findIndex((file) => file.id === review.selected?.id);
  const move = (delta: number) => {
    const next = changes[selection + delta];
    if (next) review.change({ selectedPath: next.path });
  };
  const { file, position } = review;
  useEffect(() => {
    if (scroll.current && file) scroll.current.scrollTop = position(file.path);
  }, [file, position]);
  const files = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: changes.length,
    getScrollElement: () => files.current,
    estimateSize: () => 40,
    overscan: 8,
  });
  useEffect(() => {
    if (selection >= 0 && files.current?.clientHeight)
      virtual.scrollToIndex(selection, { align: 'auto' });
  }, [selection, virtual]);
  const stage = review.view.mode === 'staged' ? 'Unstage' : 'Stage';
  return (
    <section
      className="git-review"
      aria-label="Git review"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.altKey && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          move(event.key === 'ArrowDown' ? 1 : -1);
        }
      }}
    >
      <div className="diff-toolbar">
        <label>
          Changes{' '}
          <ChoiceButton
            label="Review changes"
            value={review.view.mode}
            disabled={review.busy}
            onChoose={(mode) => review.change({ mode: mode as ReviewMode })}
            choices={[
              { value: 'unstaged', label: 'Unstaged' },
              { value: 'staged', label: 'Staged' },
              { value: 'branch', label: 'Against base' },
            ]}
          />
        </label>
        {review.view.mode === 'branch' && (
          <label>
            Base{' '}
            <ChoiceButton
              label="Review base"
              value={review.selectedBase?.id ?? (review.view.baseCommit ? 'saved' : '')}
              onChoose={(id) => {
                const base = review.branches.find((branch) => branch.id === id);
                if (base) review.change({ baseCommit: base.commit, baseName: base.name });
              }}
              choices={[
                ...(!review.selectedBase && review.view.baseCommit
                  ? [
                      {
                        value: 'saved',
                        label: `${review.view.baseName} · saved ${review.view.baseCommit.slice(0, 8)}`,
                      },
                    ]
                  : []),
                ...review.branches.map((branch) => ({ value: branch.id, label: branch.name })),
              ]}
            />
          </label>
        )}
        <span className="git-review-branch">{review.snapshot?.branch}</span>
        <button disabled={review.busy} onClick={review.refresh}>
          Refresh
        </button>
      </div>
      {review.error && (
        <div className="git-review-error" role="alert">
          {review.error}
        </div>
      )}
      <div className="git-review-body">
        <div className="git-review-files" role="list" aria-label="Changed files" ref={files}>
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((item) => {
              const change = changes[item.index]!;
              return (
                <div
                  role="listitem"
                  key={change.id}
                  style={{
                    position: 'absolute',
                    top: item.start,
                    height: item.size,
                    width: '100%',
                  }}
                >
                  <button
                    className="git-review-file"
                    aria-pressed={change.id === review.selected?.id}
                    disabled={review.busy}
                    onClick={() => review.change({ selectedPath: change.path })}
                  >
                    <span className="git-badge">{change.status}</span>
                    <span>{change.path}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="git-review-content">
          <div className="diff-toolbar">
            <button
              aria-label="Previous changed file"
              disabled={selection <= 0 || review.busy}
              onClick={() => move(-1)}
            >
              Previous
            </button>
            <button
              aria-label="Next changed file"
              disabled={selection < 0 || selection >= changes.length - 1 || review.busy}
              onClick={() => move(1)}
            >
              Next
            </button>
            <span className="git-review-path">{review.selected?.path ?? 'Changed files'}</span>
            {review.selected && (
              <button
                onClick={() =>
                  void workspace
                    .openGitDiff(review.snapshot!.root + '/' + review.selected!.path, paneID)
                    .catch(report)
                }
              >
                Open diff
              </button>
            )}
            {review.file && !review.file.problem && review.view.mode !== 'branch' && (
              <button
                disabled={review.busy}
                onClick={() => void review.apply(review.file!.hunks.map((hunk) => hunk.id))}
              >
                {stage} all hunks
              </button>
            )}
          </div>
          <div
            className="git-review-patch"
            ref={scroll}
            onScroll={(event) => {
              if (review.file) review.savePosition(review.file.path, event.currentTarget.scrollTop);
            }}
          >
            {review.reading ? (
              <Loading label="Reading changes…" />
            ) : !changes.length ? (
              <Empty
                title="No changes"
                detail={
                  review.view.mode === 'branch'
                    ? 'No changes against this base.'
                    : `Nothing ${review.view.mode}.`
                }
              />
            ) : review.error && !review.file ? (
              <Empty
                title="Patch unavailable"
                detail="Refresh review to load the current changes."
              />
            ) : !review.file ? (
              <Loading label="Reading patch…" />
            ) : review.file.problem ? (
              <Empty title="Text hunk review unavailable" detail={review.file.problem} />
            ) : (
              review.file.hunks.map((hunk, index) => (
                <section className="git-review-hunk" key={hunk.id} aria-label={`Hunk ${index + 1}`}>
                  <header>
                    <code>{hunk.heading}</code>
                    {review.view.mode !== 'branch' && (
                      <button disabled={review.busy} onClick={() => void review.apply([hunk.id])}>
                        {stage} hunk {index + 1}
                      </button>
                    )}
                  </header>
                  <pre>
                    {hunk.lines.map((line, index) => (
                      <span
                        key={index}
                        className={
                          line.startsWith('+')
                            ? 'git-line-added'
                            : line.startsWith('-')
                              ? 'git-line-removed'
                              : ''
                        }
                      >
                        {line || ' '}
                      </span>
                    ))}
                  </pre>
                </section>
              ))
            )}
          </div>
        </div>
      </div>
      <footer className="git-review-footer">
        {changes.length} changed {changes.length === 1 ? 'file' : 'files'}
        {changes.length > 1 && ' · ⌥↑ / ⌥↓ moves between files'}
        {review.view.mode === 'branch' && ' · Includes working changes'}
      </footer>
    </section>
  );
}
