import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ReviewBranch,
  ReviewFile,
  ReviewSnapshot,
  ReviewState,
} from '../../domain/comparison/review';
import { errorMessage } from '../../domain/errors';
import { activeWorkspace, savePreviewValue, previewValues, updatePane } from '../state/store';
import { useWorkspace } from '../workspace/context';

export function useGitReview(path: string, paneID: string) {
  const workspace = useWorkspace();
  const owner = activeWorkspace().id;
  const [view, setView] = useState<ReviewState>(() => {
    const pane = activeWorkspace().panes.find((pane) => pane.id === paneID);
    return pane?.type === 'git-changes' && pane.review ? pane.review : { mode: 'unstaged' };
  });
  const [generation, refresh] = useState(0);
  const [revision, reread] = useState(0);
  const [lease, setLease] = useState<{
    id: string;
    branches: ReviewBranch[];
    defaultBaseID?: string;
  }>();
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>();
  const [file, setFile] = useState<ReviewFile>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(true);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let id: string | undefined;
    setLease(undefined);
    setSnapshot(undefined);
    setFile(undefined);
    setError('');
    setReading(true);
    void window.viewer
      .gitReview({
        kind: 'open',
        target: {
          workspaceID: owner,
          rootID: workspace.rootID(paneID) || paneID,
          paneID,
          panePath: path,
          directory: path,
          selection: [],
        },
      })
      .then((result) => {
        if (result.kind !== 'opened') throw new Error('Git review could not open.');
        id = result.reviewID;
        if (cancelled)
          void window.viewer.gitReview({ kind: 'release', reviewID: id }).catch(() => {});
        else setLease({ id, branches: result.branches, defaultBaseID: result.defaultBaseID });
      })
      .catch((value) => {
        if (!cancelled) {
          setError(errorMessage(value));
          setReading(false);
        }
      });
    return () => {
      cancelled = true;
      if (id) void window.viewer.gitReview({ kind: 'release', reviewID: id }).catch(() => {});
    };
  }, [path, paneID, owner, workspace, generation]);
  const selectedBase =
    lease?.branches.find(
      (branch) => branch.commit === view.baseCommit && branch.name === view.baseName,
    ) ??
    (!view.baseCommit
      ? lease?.branches.find((branch) => branch.id === lease.defaultBaseID)
      : undefined);
  useEffect(() => {
    if (!lease) return;
    let cancelled = false;
    setReading(true);
    setError('');
    setFile(undefined);
    void window.viewer
      .gitReview({
        kind: 'read',
        reviewID: lease.id,
        mode: view.mode,
        baseID: selectedBase?.id,
        baseCommit: view.baseCommit,
      })
      .then((result) => {
        if (cancelled) return;
        if (result.kind !== 'snapshot') throw new Error('Changed files are unavailable.');
        setSnapshot(result.snapshot);
      })
      .catch((value) => {
        if (!cancelled) setError(errorMessage(value));
      })
      .finally(() => {
        if (!cancelled) setReading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lease, view.mode, view.baseCommit, selectedBase?.id, revision]);
  const selected =
    snapshot?.files.find((file) => file.path === view.selectedPath) ?? snapshot?.files[0];
  useEffect(() => {
    setFile(undefined);
    if (!lease || !snapshot || !selected || reading) return;
    let cancelled = false;
    void window.viewer
      .gitReview({ kind: 'file', reviewID: lease.id, snapshotID: snapshot.id, fileID: selected.id })
      .then((result) => {
        if (!cancelled && result.kind === 'file') setFile(result.file);
      })
      .catch((value) => {
        if (!cancelled) setError(errorMessage(value));
      });
    return () => {
      cancelled = true;
    };
  }, [lease, snapshot, selected, reading]);
  const change = (patch: Partial<ReviewState>) => {
    const next = { ...view, ...patch };
    setFile(undefined);
    if ('mode' in patch || 'baseCommit' in patch) {
      setSnapshot(undefined);
      setReading(true);
    }
    setView(next);
    setError('');
    if (activeWorkspace().id === owner) updatePane(paneID, { review: next });
  };
  const position = useCallback(
    (file: string) => {
      const values = previewValues(paneID, owner)['git.review.positions'];
      return values &&
        typeof values === 'object' &&
        !Array.isArray(values) &&
        typeof values[file] === 'number'
        ? values[file]
        : 0;
    },
    [paneID, owner],
  );
  return {
    view,
    change,
    snapshot,
    file,
    selected,
    branches: lease?.branches ?? [],
    selectedBase,
    error,
    busy,
    reading,
    refresh: () => refresh((value) => value + 1),
    async apply(hunks: string[]) {
      if (!lease || !file || busy) return;
      setBusy(true);
      setError('');
      try {
        await window.viewer.gitReview({
          kind: 'apply',
          reviewID: lease.id,
          fileID: file.id,
          hunks,
        });
        if (mounted.current) reread((value) => value + 1);
      } catch (value) {
        if (mounted.current) setError(errorMessage(value));
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    position,
    savePosition(file: string, top: number) {
      const previous = previewValues(paneID, owner)['git.review.positions'];
      const values =
        previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
      savePreviewValue(
        paneID,
        'git.review.positions',
        Object.fromEntries(
          [...Object.entries(values).filter(([path]) => path !== file), [file, top]].slice(-100),
        ),
        owner,
      );
    },
  };
}
