import { useEffect, useRef, useState } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { errorMessage } from '../../domain/errors';
import { sourceVersion } from '../../domain/files/inspection';
import type { OptimizationOptions } from '../../domain/operations/optimization';
import type {
  OptimizationCandidate,
  OptimizationComparison,
} from '../../domain/operations/optimization-review';
import { report } from '../state/store';

export interface OptimizationRow {
  file: FileEntry;
  candidate?: OptimizationCandidate;
  preparing?: boolean;
  selected: boolean;
  exported?: boolean;
  error?: string;
}
/** The dialog owns preparation and comparison leases. Queued exports keep their
 * desktop capabilities until the operation journal has finished with them. */
export function useOptimizationSession(files: FileEntry[]) {
  const [rows, setRows] = useState<OptimizationRow[]>(() =>
    files.map((file) => ({ file, selected: false })),
  );
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<string[]>([]);
  const [comparison, setComparison] = useState<OptimizationComparison>();
  const [reviewing, setReviewing] = useState('');
  const [error, setError] = useState('');
  const state = useRef({
    live: true,
    generation: 0,
    request: '',
    candidates: new Set<string>(),
    jobs: new Set<string>(),
    review: 0,
    exportGeneration: 0,
  });
  const update = (file: string, patch: Partial<OptimizationRow>) =>
    setRows((values) => values.map((row) => (row.file.path === file ? { ...row, ...patch } : row)));
  const release = (ids: string[]) => {
    ids.forEach((id) => state.current.candidates.delete(id));
    if (ids.length) void window.viewer.optimization({ kind: 'release', ids }).catch(report);
  };
  const releaseComparison = (value?: OptimizationComparison) => {
    if (value)
      for (const resource of [value.original, value.candidate])
        void window.viewer.release(resource.id).catch(report);
  };
  const comparisonRef = useRef<OptimizationComparison | undefined>(undefined);
  const clearReview = () => {
    state.current.review++;
    releaseComparison(comparisonRef.current);
    comparisonRef.current = undefined;
    setComparison(undefined);
    setReviewing('');
  };
  const reset = () => {
    const active = state.current;
    active.generation++;
    if (active.request)
      void window.viewer.optimization({ kind: 'cancel', requestID: active.request }).catch(report);
    release([...active.candidates]);
    clearReview();
    setRows(files.map((file) => ({ file, selected: false })));
    setJobs([]);
    setBusy(false);
    setError('');
  };
  useEffect(() => {
    const active = state.current;
    active.live = true;
    return () => {
      active.live = false;
      active.generation++;
      active.review++;
      if (active.request)
        void window.viewer
          .optimization({ kind: 'cancel', requestID: active.request })
          .catch(report);
      release([...active.candidates]);
      releaseComparison(comparisonRef.current);
    };
    // This hook belongs to one selection for the lifetime of its dialog.
  }, []);
  const prepare = async (options: OptimizationOptions, retry?: string) => {
    const active = state.current;
    const generation = ++active.generation;
    setBusy(true);
    setError('');
    clearReview();
    try {
      for (const row of rows.filter((row) => (retry ? row.file.path === retry : !row.candidate))) {
        if (!active.live || active.generation !== generation) break;
        if (row.candidate) release([row.candidate.id]);
        update(row.file.path, {
          preparing: true,
          error: undefined,
          candidate: undefined,
          selected: false,
          exported: false,
        });
        try {
          // Retry is an explicit request to inspect the file's current version.
          const file = retry ? await window.viewer.stat(row.file.path) : row.file;
          if (!active.live || active.generation !== generation) break;
          const requestID = crypto.randomUUID();
          active.request = requestID;
          const value = await window.viewer.optimization({
            kind: 'prepare',
            requestID,
            source: file.path,
            version: sourceVersion(file),
            options,
          });
          if (value?.kind !== 'prepared')
            throw new Error('The processor returned no candidate. Retry this file.');
          if (!active.live || active.generation !== generation) {
            release([value.id]);
            break;
          }
          active.candidates.add(value.id);
          update(row.file.path, {
            file: value.source,
            candidate: value,
            preparing: false,
            selected: value.outputBytes < value.inputBytes && value.targetSize?.met !== false,
          });
        } catch (reason) {
          if (active.live && active.generation === generation)
            update(row.file.path, { preparing: false, error: errorMessage(reason) });
        } finally {
          if (active.generation === generation) active.request = '';
        }
      }
    } finally {
      if (active.live && active.generation === generation) setBusy(false);
    }
  };
  const review = async (candidate: OptimizationCandidate) => {
    clearReview();
    const sequence = state.current.review;
    setReviewing(candidate.id);
    setError('');
    try {
      const value = await window.viewer.optimization({ kind: 'review', id: candidate.id });
      if (value?.kind !== 'review')
        throw new Error('The comparison could not be opened. Retry this file.');
      if (!state.current.live || state.current.review !== sequence) {
        releaseComparison(value);
        return;
      }
      comparisonRef.current = value;
      setComparison(value);
    } catch (reason) {
      if (state.current.live && state.current.review === sequence) setError(errorMessage(reason));
    } finally {
      if (state.current.live && state.current.review === sequence) setReviewing('');
    }
  };
  const save = async (destination: string, sourceRoot?: string) => {
    const generation = state.current.exportGeneration;
    setBusy(true);
    setError('');
    try {
      const value = await window.viewer.optimization({
        kind: 'export',
        destination,
        sourceRoot,
        ids: rows.flatMap((row) => (row.selected && row.candidate ? [row.candidate.id] : [])),
      });
      if (value?.kind !== 'exported') throw new Error('The export did not start. Try again.');
      value.jobs.forEach((id) => state.current.jobs.add(id));
      if (state.current.exportGeneration !== generation)
        await Promise.all(value.jobs.map((id) => window.viewer.cancelJob(id)));
      if (state.current.live) {
        setJobs((ids) => [...ids, ...value.jobs]);
        setRows((values) =>
          values.map((row) => {
            if (!row.selected) return row;
            const failure = value.failures.find((item) => item.path === row.file.path);
            return { ...row, selected: false, exported: !failure, error: failure?.message };
          }),
        );
      }
    } catch (reason) {
      if (state.current.live) setError(errorMessage(reason));
    } finally {
      if (state.current.live) setBusy(false);
    }
  };
  const cancel = async () => {
    const active = state.current;
    active.generation++;
    active.exportGeneration++;
    if (active.request)
      await window.viewer.optimization({ kind: 'cancel', requestID: active.request });
    await Promise.all([...active.jobs].map((id) => window.viewer.cancelJob(id)));
    active.request = '';
    setRows((values) =>
      values.map((row) =>
        row.preparing
          ? { ...row, preparing: false, error: 'Preparation cancelled. Retry when ready.' }
          : row,
      ),
    );
    setBusy(false);
  };
  return {
    rows,
    busy,
    jobs,
    comparison,
    reviewing,
    error,
    prepare,
    review,
    save,
    cancel,
    reset,
    select: (file: string, selected: boolean) => update(file, { selected }),
    clearReview,
  };
}

export type OptimizationSession = ReturnType<typeof useOptimizationSession>;
