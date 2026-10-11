import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { PreviewContext } from './contracts';
const views = new Map<string, Map<string, unknown>>();
export function previewState(id: string): NonNullable<PreviewContext['state']> {
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
