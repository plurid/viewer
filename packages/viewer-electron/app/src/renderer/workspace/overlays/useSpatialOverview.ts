import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SpatialOverviewPorts, SpatialOverviewState } from './SpatialOverview';
import { SpatialOverview } from './SpatialOverview';

const unavailable: SpatialOverviewState = { available: false, collapsed: false, expanded: false };

export interface SpatialOverviewHandle extends SpatialOverviewState {
  requested: boolean;
  open(opener?: HTMLElement): void;
  close(): void;
}

export function useSpatialOverview({
  root,
  enabled,
  epoch,
  labelsVersion,
  ...ports
}: Omit<SpatialOverviewPorts, 'changed' | 'requestMinimap'> & {
  root: RefObject<HTMLElement | null>;
  enabled: boolean;
  epoch: string;
  /** The host pane collection: label/path changes need not change the engine tree. */
  labelsVersion?: object;
}): SpatialOverviewHandle {
  const [state, setState] = useState(unavailable);
  const [requestedEpoch, setRequestedEpoch] = useState<string>();
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
      hasPlanes: () => current.current.hasPlanes?.() ?? true,
      minimapApplied: () => current.current.minimapApplied?.() ?? true,
      minimapShown: () => current.current.minimapShown(),
      viewcubeConcealed: () => current.current.viewcubeConcealed?.(),
      corner: () => current.current.corner(),
      requestMinimap: (shown) => {
        setRequestedEpoch(shown ? epoch : undefined);
      },
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
  const corner = ports.corner();
  const minimap = ports.minimapShown();
  useEffect(() => adapter.current?.invalidate(), [labelsVersion, corner, minimap]);
  const open = useCallback((opener?: HTMLElement) => adapter.current?.open(opener), []);
  const close = useCallback(() => adapter.current?.close(), []);
  const requested = enabled && requestedEpoch === epoch;
  return useMemo(() => ({ ...state, requested, open, close }), [state, requested, open, close]);
}
