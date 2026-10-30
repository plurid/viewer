import { useEffect, useRef, useState } from 'react';
import type { Resource } from '../../domain/contracts';
import type { DiffSource } from '../../domain/comparison/diff';
import { errorMessage } from '../../domain/errors';
import { editingPlane } from '../editing/planes';
import { report } from '../state/store';

export interface ComparisonContent {
  left: Resource | null;
  right: Resource | null;
  original: string;
  text: string;
  image: boolean;
}

type ComparisonState =
  | { status: 'loading' }
  | { status: 'ready'; content: ComparisonContent }
  | { status: 'failed'; error: string };

function sourceKey(source: DiffSource): string {
  return JSON.stringify(
    source.kind === 'git'
      ? [source.kind, source.repository, source.commit, source.path]
      : source.kind === 'file'
        ? [source.kind, source.path]
        : [source.kind, source.name],
  );
}

/** Equivalent records from a workspace merge do not restart an editor session. */
function useStableSource(source: DiffSource): DiffSource {
  const key = sourceKey(source);
  const previous = useRef({ key, source });
  if (previous.current.key !== key) previous.current = { key, source };
  return previous.current.source;
}

async function acquire(source: DiffSource): Promise<Resource | null> {
  if (source.kind === 'empty') return null;
  return source.kind === 'file'
    ? window.viewer.resource(source.path)
    : window.viewer.gitResource(source);
}

/** One comparison owns its grants and watch; every failure unwinds that ownership. */
export function useComparisonSession(
  paneID: string,
  leftSource: DiffSource,
  rightSource: DiffSource,
  generation: number,
): ComparisonState {
  const left = useStableSource(leftSource);
  const right = useStableSource(rightSource);
  const [state, setState] = useState<ComparisonState>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    let cancelled = false;
    let disposed = false;
    let watching = false;
    let unwatched = false;
    const held = new Map<string, Resource>();
    const released = new Set<string>();
    const subscriber = crypto.randomUUID();
    const directory =
      right.kind === 'file' ? right.path.slice(0, right.path.lastIndexOf('/')) || '/' : undefined;
    let unsubscribe = () => {};
    const unwatch = () => {
      if (!watching || unwatched) return;
      unwatched = true;
      void window.viewer.unwatch(subscriber).catch(report);
    };
    const release = async (resource: Resource) => {
      if (released.has(resource.id)) return;
      released.add(resource.id);
      await window.viewer.release(resource.id).catch(report);
    };
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      live = false;
      unsubscribe();
      unwatch();
      await Promise.all([...held.values()].map(release));
    };
    const fail = async (error: unknown) => {
      const notify = live;
      await dispose();
      if (notify && !cancelled) setState({ status: 'failed', error: errorMessage(error) });
    };
    const read = async (source: DiffSource) => {
      const resource = await acquire(source);
      if (resource) {
        held.set(resource.id, resource);
        if (!live) await release(resource);
      }
      return resource;
    };
    setState({ status: 'loading' });
    if (directory)
      void window.viewer
        .watch(directory, subscriber)
        .then(() => {
          watching = true;
          if (!live) unwatch();
        })
        .catch(report);
    unsubscribe = window.viewer.onEvent((event) => {
      if (event.type === 'folder-changed' && event.path === directory)
        editingPlane(paneID)?.changedOnDisk?.();
      if (
        event.type === 'file-access' &&
        [...held.keys()].some((id) => event.resources?.includes(id))
      )
        void fail(new Error('File access was revoked. Allow access and reload this comparison.'));
    });
    void (async () => {
      const [a, b] = await Promise.all([read(left), read(right)]);
      if (!live) return;
      const resources = [a, b].filter((value): value is Resource => !!value);
      const image =
        resources.length > 0 &&
        resources.every((resource) => resource.entry.mime.startsWith('image/'));
      const texts = image
        ? ['', '']
        : await Promise.all(
            [a, b].map(async (resource) => {
              if (!resource) return '';
              const data = await window.viewer.read(resource.id);
              if (data.binary || data.truncated)
                throw new Error('Text comparisons require complete text files of at most 4 MB.');
              return data.text;
            }),
          );
      if (live)
        setState({
          status: 'ready',
          content: { left: a, right: b, original: texts[0]!, text: texts[1]!, image },
        });
    })().catch(fail);
    return () => {
      cancelled = true;
      void dispose();
    };
  }, [paneID, left, right, generation]);
  return state;
}
