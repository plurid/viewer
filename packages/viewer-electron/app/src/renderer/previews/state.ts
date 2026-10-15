import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { PreviewContext } from './contracts';
import type { FileEntry } from '../../domain/contracts';
import { sameSourceVersion, sourceVersion, type SourceVersion } from '../../domain/inspection';
import { activeWorkspace, getState, previewValues, savePreviewValue } from '../state/store';
const views = new Map<string, Map<string, unknown>>();
export function previewState(id: string, file?: FileEntry): NonNullable<PreviewContext['state']> {
  const owner = getState() && activeWorkspace().id;
  if (owner && activeWorkspace().panes.some((pane) => pane.id === id))
    return {
      get: (key) => {
        const values = previewValues(id, owner),
          before = values['_sourceVersion'] as SourceVersion | undefined;
        if (
          file &&
          before &&
          !sameSourceVersion(before, sourceVersion(file)) &&
          !key.startsWith('notes.')
        )
          return;
        return values[key];
      },
      set: (key, value) => {
        const before = previewValues(id, owner)['_sourceVersion'] as SourceVersion | undefined;
        // Record the source version only when it changes; a new file resets its view.
        if (file && !(before && sameSourceVersion(before, sourceVersion(file))))
          savePreviewValue(id, '_sourceVersion', sourceVersion(file), owner, !!before);
        savePreviewValue(id, key, value, owner);
      },
    };
  let view = views.get(id);
  if (!view) {
    view = new Map();
    views.set(id, view);
    while (views.size > 500) views.delete(views.keys().next().value!);
  }
  return {
    get: (key) => view!.get(key),
    set: (key, value) => {
      view!.set(key, value);
    },
  };
}
export function usePreviewState<T>(
  context: PreviewContext,
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(
    () => (context.state?.get(key) as T | undefined) ?? initial,
  );
  const set = useCallback(
    (next: SetStateAction<T>) => {
      setValue((previous) => {
        const value = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
        context.state?.set(key, value);
        return value;
      });
    },
    [context.state, key],
  );
  return [value, set];
}
