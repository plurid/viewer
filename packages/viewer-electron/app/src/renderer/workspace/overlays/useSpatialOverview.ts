import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  SpatialOverview,
  type SpatialOverviewPorts,
  type SpatialOverviewState,
} from './SpatialOverview';

const unavailable: SpatialOverviewState = { available: false, collapsed: false, expanded: false };

export interface SpatialOverviewHandle extends SpatialOverviewState {
  open(opener?: HTMLElement): void;
  close(): void;
}

export function useSpatialOverview({
  root,
  enabled,
  epoch,
  labelsVersion,
  ...ports
}: Omit<SpatialOverviewPorts, 'changed'> & {
  root: RefObject<HTMLElement | null>;
  enabled: boolean;
  epoch: string;
  /** The host pane collection: label/path changes need not change the engine tree. */
  labelsVersion?: object;
}): SpatialOverviewHandle {
  const [state, setState] = useState(unavailable);
  const adapter = useRef<SpatialOverview | undefined>(undefined);
  const current = useRef(ports);
  current.current = ports;
  useEffect(() => {
    if (!enabled || !root.current) {
      setState(unavailable);
      return;
    }
    let live = true;
    const value = new SpatialOverview(root.current, {
      subscribeEngine: (listener) => current.current.subscribeEngine(listener),
      isDocked: () => current.current.isDocked(),
      labelForPlane: (id) => current.current.labelForPlane(id),
      onNavigate: (id) => current.current.onNavigate?.(id),
      changed: (next) => {
        if (live) setState(next);
      },
    });
    adapter.current = value;
    return () => {
      live = false;
      adapter.current = undefined;
      value.destroy();
    };
  }, [enabled, epoch, root]);
  useEffect(() => adapter.current?.invalidate(), [labelsVersion]);
  const open = useCallback((opener?: HTMLElement) => adapter.current?.open(opener), []);
  const close = useCallback(() => adapter.current?.close(), []);
  return useMemo(() => ({ ...state, open, close }), [state, open, close]);
}
