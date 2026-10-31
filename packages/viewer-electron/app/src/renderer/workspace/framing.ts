import type { RefObject } from 'react';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import { PLURID_PUBSUB_TOPIC, type CameraDelta } from '@plurid/plurid-data';
import { flattenTree, hostID } from './tree';

const pending = new WeakMap<PluridApplicationHandle, () => void>();
const generations = new WeakMap<PluridApplicationHandle, number>();
const framed = new WeakMap<PluridApplicationHandle, { targets?: string[]; viewpoint: string }>();
const stableLayoutFrames = 3;
const maximumLayoutFrames = 90;

/** An authored camera placement takes ownership from an earlier fit or restore. */
export function cancelWorkspaceFraming(api: PluridApplicationHandle): void {
  pending.get(api)?.();
  generations.set(api, (generations.get(api) || 0) + 1);
  framed.delete(api);
}

/**
 * Whether other planes cover most of `planeID` on screen. Linked planes can turn back in space
 * and land behind another plane, where framing shows only the plane in front.
 */
function covered(element: HTMLElement, planeID: string): boolean {
  const plane = Array.from(element.querySelectorAll<HTMLElement>('[data-plurid-plane]')).find(
    (box) => box.dataset.pluridPlane === planeID,
  );
  if (!plane) return false;
  const box = plane.getBoundingClientRect();
  let hidden = 0;
  for (const x of [0.25, 0.5, 0.75])
    for (const y of [0.25, 0.5, 0.75]) {
      const hit = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y);
      const owner = hit?.closest('[data-plurid-plane]');
      if (owner && owner !== plane) hidden++;
    }
  return hidden > 4;
}

/** Fit after the live viewport and measured plane boxes settle; new input cancels the request. */
export function frameWorkspace(
  engine: RefObject<PluridApplicationHandle | null>,
  surface: RefObject<HTMLDivElement | null>,
  targets?: string[],
  options: { dock?: boolean; recover?: boolean; camera?: CameraDelta } = {},
): void {
  const api = engine.current;
  const element = surface.current;
  if (!api || !element) return;
  pending.get(api)?.();
  // A new request owns the destination immediately. A resize must not restore the preceding
  // placement while this target is still waiting for its measured layout.
  framed.delete(api);
  const generation = (generations.get(api) || 0) + 1;
  generations.set(api, generation);
  let cancelled = false;
  let previous = '';
  let stable = 0;
  let revealedUnmeasured = false;
  let remainingFrames = maximumLayoutFrames;
  const cancel = () => {
    cancelled = true;
    cleanup();
    framed.delete(api);
  };
  const cleanup = () => {
    window.removeEventListener('pointerdown', cancel, true);
    window.removeEventListener('wheel', cancel, true);
    if (pending.get(api) === cancel) pending.delete(api);
  };
  pending.set(api, cancel);
  window.addEventListener('pointerdown', cancel, true);
  window.addEventListener('wheel', cancel, { capture: true, passive: true });
  const frame = () => {
    if (cancelled || engine.current !== api || !element.isConnected) {
      cleanup();
      return;
    }
    // Bound actual measurement work, rather than elapsed wall time. A busy or hidden renderer
    // cannot consume its readiness budget while the browser is unable to deliver layout frames.
    if (remainingFrames-- === 0) {
      cleanup();
      return;
    }
    const inspection = api.inspect();
    if (inspection.motion === 'gesture' || inspection.motion === 'fling') {
      cancel();
      return;
    }
    const nodes = flattenTree(api.tree.get()).filter(
      (node) =>
        !node.pinned &&
        (node.show || options.recover) &&
        (!targets || targets.includes(hostID(node))),
    );
    if (options.recover && nodes.some((node) => !node.show)) {
      for (const node of nodes) if (!node.show) api.tree.open(node.planeID);
      requestAnimationFrame(frame);
      return;
    }
    const expected = !targets || targets.every((id) => nodes.some((node) => hostID(node) === id));
    const boxes = new Map(
      Array.from(element.querySelectorAll<HTMLElement>('[data-plurid-plane]')).map((plane) => [
        plane.dataset.pluridPlane,
        plane,
      ]),
    );
    const measured =
      nodes.length > 0 &&
      nodes.every((node) => {
        const box = boxes.get(node.planeID);
        return (
          !!box &&
          node.width > 0 &&
          node.height > 0 &&
          Math.abs(box.offsetWidth - node.width) <= 1 &&
          Math.abs(box.offsetHeight - node.height) <= 1
        );
      });
    const viewport =
      inspection.view.width === element.clientWidth &&
      inspection.view.height === element.clientHeight;
    const resolved = api.getSnapshot().space.resolvedLayout;
    const signature = JSON.stringify([
      inspection.view,
      nodes.map((node) => [node.planeID, node.width, node.height, node.location]),
    ]);
    stable = signature === previous ? stable + 1 : 0;
    previous = signature;
    if (
      !revealedUnmeasured &&
      !options.camera &&
      resolved &&
      expected &&
      viewport &&
      targets?.length === 1 &&
      nodes.length === 1 &&
      stable >= stableLayoutFrames &&
      (!nodes[0]!.width || !nodes[0]!.height)
    ) {
      // A new distant child can be culled before its first measurement. Reveal
      // it through the engine's configured-size fallback, then wait for its real
      // box before the final fit. Never invent or persist substitute dimensions.
      revealedUnmeasured = true;
      const node = nodes[0]!;
      if (options.dock) api.camera.dock(node.planeID, { animate: !options.recover });
      else api.camera.frame({ planeID: node.planeID }, { animate: !options.recover });
      stable = 0;
      previous = '';
      requestAnimationFrame(frame);
      return;
    }
    if (!(resolved && expected && measured && viewport && stable >= stableLayoutFrames)) {
      requestAnimationFrame(frame);
      return;
    }
    cleanup();
    if (options.recover) {
      // Restore a useful saved view verbatim. Only recover an active plane that the
      // old camera or changed viewport would leave clipped or completely offscreen.
      const view = element.getBoundingClientRect();
      if (
        nodes.every((node) => {
          const box = boxes.get(node.planeID)!.getBoundingClientRect();
          return (
            box.left >= view.left - 1 &&
            box.top >= view.top - 1 &&
            box.right <= view.right + 1 &&
            box.bottom <= view.bottom + 1
          );
        })
      )
        return;
    }
    const motion = { animate: !options.recover };
    const [node] = nodes;
    if (options.camera) {
      // Returning focus from a menu can scroll overflow-hidden engine wrappers.
      // The camera owns these containers; folder scrollers inside the sheets stay local.
      const containers = new Set<HTMLElement>();
      for (const node of nodes) {
        let parent = boxes.get(node.planeID)?.parentElement;
        while (parent && parent !== element) {
          containers.add(parent);
          parent = parent.parentElement;
        }
      }
      for (const container of containers) {
        if (container.scrollTop) container.scrollTop = 0;
        if (container.scrollLeft) container.scrollLeft = 0;
      }
      api.camera.moveBy(options.camera, motion);
    } else if (options.dock && targets?.length === 1 && node) api.camera.dock(node.planeID, motion);
    else if (targets?.length === 1 && node) api.camera.frame({ planeID: node.planeID }, motion);
    else if (targets?.length)
      api.pubsub.publish({
        topic: PLURID_PUBSUB_TOPIC.SPACE_FRAME,
        data: { planeIDs: nodes.map((node) => node.planeID), yaw: 'best', ...motion },
      });
    else api.camera.fit(motion);
    // A one-time authored placement does not own future viewport resizing.
    if (options.camera) return;
    const record = () => {
      if (
        engine.current !== api ||
        generations.get(api) !== generation ||
        api.camera.motion() === 'gesture' ||
        api.camera.motion() === 'fling'
      )
        return;
      if (api.camera.motion() === 'tween') {
        requestAnimationFrame(record);
        return;
      }
      // Docked, the plane is shown whole; a dock is never refit.
      if (!options.dock && targets?.length === 1 && node && covered(element, node.planeID)) {
        api.camera.dock(node.planeID, motion);
        return;
      }
      framed.set(api, { targets, viewpoint: api.getViewpoint({ version: 2 }) });
    };
    requestAnimationFrame(record);
  };
  requestAnimationFrame(frame);
}

/**
 * Resolves once the camera is at rest: no framing request still waiting for layout, and no tween,
 * gesture or fling for a few frames. Bounded by a timer, not by frames, so a busy renderer or a
 * hidden window (which draws no frames) cannot hold a caller; an abort ends the wait at once.
 */
export function whenWorkspaceAtRest(
  engine: RefObject<PluridApplicationHandle | null>,
  signal?: AbortSignal,
  limit = 6000,
): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0;
    let still = 0;
    let request = 0;
    const done = () => {
      clearTimeout(timer);
      cancelAnimationFrame(request);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, limit);
    signal?.addEventListener('abort', done, { once: true });
    const check = () => {
      const api = engine.current;
      if (signal?.aborted || !api) return done();
      still = !pending.has(api) && api.camera.motion() === 'idle' ? still + 1 : 0;
      // A camera command's tween starts in a later frame than the request that issued it.
      if (++frames > 2 && still >= stableLayoutFrames) done();
      else request = requestAnimationFrame(check);
    };
    if (signal?.aborted) return done();
    request = requestAnimationFrame(check);
  });
}
/** A resize refits only the framing we still own; a deliberate camera move remains intact. */
export function refitWorkspace(
  engine: RefObject<PluridApplicationHandle | null>,
  surface: RefObject<HTMLDivElement | null>,
): void {
  const api = engine.current;
  if (!api || api.camera.docked()) return;
  const last = framed.get(api);
  if (last && last.viewpoint === api.getViewpoint({ version: 2 }))
    frameWorkspace(engine, surface, last.targets);
}
