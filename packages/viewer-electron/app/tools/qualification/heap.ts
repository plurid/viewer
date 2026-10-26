import { readFile } from 'node:fs/promises';

/** The retained native audit uses this after measurement, outside the app process. */
export async function modelHeapSummary(file: string) {
  const heap = JSON.parse(await readFile(file, 'utf8')) as {
    snapshot: { meta: { node_fields: string[]; node_types: (string | string[])[] } };
    nodes: number[];
    strings: string[];
  };
  const fields = heap.snapshot.meta.node_fields;
  const stride = fields.length;
  const name = fields.indexOf('name');
  const detached = fields.indexOf('detachedness');
  if (!stride || name < 0 || detached < 0) throw new Error('Unsupported heap snapshot metadata.');
  let detachedModelStages = 0;
  let detachedModelCanvases = 0;
  let webGLContexts = 0;
  for (let index = 0; index < heap.nodes.length; index += stride) {
    const label = heap.strings[heap.nodes[index + name]!];
    if (label === 'WebGL2RenderingContext') webGLContexts += 1;
    if (heap.nodes[index + detached] !== 2) continue;
    if (label === '<div class="model-stage">') detachedModelStages += 1;
    if (label?.startsWith('<canvas data-engine="three.js')) detachedModelCanvases += 1;
  }
  return { file, detachedModelStages, detachedModelCanvases, webGLContexts };
}
