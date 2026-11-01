import type { CanvasDocument } from '../../domain/canvases/document';
import { canvasAssetFile } from '../../domain/canvases/document';

/** Serialized into the opaque frame. It has no desktop authority or credentials. */
function runtime(initial: {
  id: string;
  revision: number;
  state: Record<string, unknown>;
  assets: { id: string; name: string; url: string; mime: string }[];
}) {
  let state = initial.state;
  let port: MessagePort | undefined;
  const listeners = new Set<(state: Record<string, unknown>) => void>();
  const pending: Record<string, unknown>[] = [];
  const send = (value: Record<string, unknown>) => {
    if (port) port.postMessage(value);
    else if (pending.length < 32) pending.push(value);
  };
  const announce = () => listeners.forEach((listener) => listener(structuredClone(state)));
  const api = Object.freeze({
    version: 1,
    assets: Object.freeze(initial.assets),
    getState: () => structuredClone(state),
    setState: (patch: Record<string, unknown>) => {
      if (
        !patch ||
        Array.isArray(patch) ||
        typeof patch !== 'object' ||
        JSON.stringify(patch).length > 128000
      )
        throw new Error('Invalid canvas state.');
      state = { ...state, ...patch };
      send({ kind: 'state', patch });
      announce();
    },
    subscribe: (listener: (state: Record<string, unknown>) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openSource: (assetID: string) => send({ kind: 'source', assetID }),
    propose: (text: string) => send({ kind: 'proposal', text }),
  });
  Object.defineProperty(window, 'viewerCanvas', { value: api, writable: false });
  window.addEventListener('message', (event) => {
    if (
      event.source !== parent ||
      event.data?.kind !== 'viewer-canvas-connect' ||
      port ||
      !event.ports[0]
    )
      return;
    port = event.ports[0];
    port.onmessage = (message) => {
      if (message.data?.kind === 'state') {
        state = message.data.state;
        announce();
      }
      if (message.data?.kind === 'error')
        window.dispatchEvent(
          new CustomEvent('viewer-canvas-error', { detail: message.data.message }),
        );
    };
    port.start();
    pending.splice(0).forEach((item) => port!.postMessage(item));
    port.postMessage({ kind: 'ready' });
  });
  parent.postMessage(
    { kind: 'viewer-canvas-ready', id: initial.id, revision: initial.revision },
    '*',
  );
  window.addEventListener('error', (event) =>
    send({ kind: 'error', message: event.message.slice(0, 1000) }),
  );
  window.addEventListener('unhandledrejection', () =>
    send({ kind: 'error', message: 'A canvas task failed. Open Source to inspect this revision.' }),
  );
}

export function canvasHTML(document: CanvasDocument): string {
  const initial = JSON.stringify({
    id: document.id,
    revision: document.revision,
    state: document.state,
    assets: document.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      mime: asset.mime,
      url: './' + canvasAssetFile(asset),
    })),
  }).replace(/</g, '\\u003c');
  const bootstrap = `<script>(${runtime.toString()})(${initial})</script>`;
  const imports =
    '<script type="importmap">{"imports":{"three":"./runtime/three.module.js","three/addons/":"./runtime/addons/"}}</script>';
  return (
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    imports +
    bootstrap +
    document.html
  );
}

export const canvasInstructions = `Canvas tools create a private interactive HTML app beside this conversation.
canvas_read returns the current revision, source and persisted state. canvas_write uses text as COMPLETE HTML (inline CSS/JS), query as title, commandID as the expected revision number (0 for first creation), and patches as default state values (path is a stable state key). canvas_asset attaches one inspected file from path and returns its local asset ID.
Use window.viewerCanvas.getState(), setState({key:value}), subscribe(listener), assets [{id,name,mime,url}], openSource(assetID), propose(text). Store every user input and camera/view value with this API. Never change a saved key's type. Use normal selectable HTML, SVG and accessible controls. No network, CDN, storage, filesystem or Node access. Images and models must use approved asset URLs. Three is available via import 'three'; OrbitControls and GLTFLoader via 'three/addons/controls/OrbitControls.js' and 'three/addons/loaders/GLTFLoader.js'. Native changes are proposals only. Publish a complete working revision, not partial code. Read before revising and keep existing state keys. Use at most one repair revision after an error.`;
