import type { RefObject } from 'react';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import { PLURID_PUBSUB_TOPIC } from '@plurid/plurid-data';

const pending = new WeakMap<PluridApplicationHandle, () => void>();
const generations = new WeakMap<PluridApplicationHandle, number>();
const framed = new WeakMap<PluridApplicationHandle, { targets?: string[]; viewpoint: string }>();
const hostID = (node: ReturnType<PluridApplicationHandle['tree']['get']>[number]) =>
  node.routeDivisions.plane.parameters.id || node.routeDivisions.path.parameters.id;
const flatten = (
  nodes: ReturnType<PluridApplicationHandle['tree']['get']>,
): ReturnType<PluridApplicationHandle['tree']['get']> =>
  nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);

/** Fit after the live viewport and measured plane boxes settle; new input cancels the request. */
export function frameWorkspace(
  engine: RefObject<PluridApplicationHandle | null>,
  surface: RefObject<HTMLDivElement | null>,
  targets?: string[],
  options: { dock?: boolean; recover?: boolean } = {},
): void {
  const api = engine.current;
  const element = surface.current;
  if (!api || !element) return;
  pending.get(api)?.();
  const generation = (generations.get(api) || 0) + 1;
  generations.set(api, generation);
  let cancelled = false;
  let previous = '';
  let stable = 0;
  const deadline = performance.now() + 1500;
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
    const inspection = api.inspect();
    if (inspection.motion === 'gesture' || inspection.motion === 'fling') {
      cancel();
      return;
    }
    const nodes = flatten(api.tree.get()).filter(
      (node) => (node.show || options.recover) && (!targets || targets.includes(hostID(node))),
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
    if (!(resolved && expected && measured && viewport && stable >= 3)) {
      if (performance.now() < deadline) requestAnimationFrame(frame);
      else cleanup();
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
    if (options.dock && targets?.length === 1) api.camera.dock(nodes[0].planeID, motion);
    else if (targets?.length === 1) api.camera.frame({ planeID: nodes[0].planeID }, motion);
    else if (targets?.length)
      api.pubsub.publish({
        topic: PLURID_PUBSUB_TOPIC.SPACE_FRAME,
        data: { planeIDs: nodes.map((node) => node.planeID), yaw: 'best', ...motion },
      });
    else api.camera.fit(motion);
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
      framed.set(api, { targets, viewpoint: api.getViewpoint({ version: 2 }) });
    };
    requestAnimationFrame(record);
  };
  requestAnimationFrame(frame);
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
