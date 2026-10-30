import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { VRMLLoader } from 'three/addons/loaders/VRMLLoader.js';
import { sceneObjectLimit } from './mesh-data';
import { unzipModelPackage } from './packages';
import { parseX3D } from './x3d';

/** Scene formats read on the renderer thread: their loaders decode images and XML through the
 * DOM, as glTF, FBX and 3MF do. */
export type SceneFormat = 'dae' | '3ds' | 'usdz' | 'wrl' | 'x3d';
export const sceneFormats: readonly string[] = ['dae', '3ds', 'usdz', 'wrl', 'x3d'];
export const isSceneFormat = (extension: string): extension is SceneFormat =>
  sceneFormats.includes(extension);

export interface LoadedScene {
  object: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Files the model names, which the preview does not read. */
  references: string[];
  /** Parts of the model the preview does not draw. */
  skipped: string[];
}

const formatNames: Record<SceneFormat, string> = {
  dae: 'Collada',
  '3ds': '3DS',
  usdz: 'USDZ',
  wrl: 'VRML',
  x3d: 'X3D',
};
/** In MB. Text formats match the mesh parser's limit; the VRML parser keeps a token for each
 * value, about 40 bytes for every byte read. */
const fileLimits: Record<SceneFormat, number> = {
  dae: 64,
  '3ds': 128,
  usdz: 128,
  wrl: 16,
  x3d: 64,
};
const geometryLimit = () => new Error('This model exceeds the geometry limit for previews.');
const depthLimit = 1000;

function fileName(url: string): string {
  const name = url.split(/[?#]/)[0]!.split(/[\\/]/).pop() || url;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Loads what a file embeds and nothing it names. A named file resolves to an empty data URL
 * that fails to decode, so its texture never gets an image and is removed afterwards. */
export function embeddedAssets() {
  const refused = new Set<string>();
  let loading = false;
  let finish = () => {};
  const idle = new Promise<void>((resolve) => (finish = resolve));
  const manager = new THREE.LoadingManager(() => {
    loading = false;
    finish();
  });
  manager.onStart = () => {
    loading = true;
  };
  manager.setURLModifier((url) => {
    if (/^(data|blob):/i.test(url)) return url;
    refused.add(fileName(url));
    return 'data:,';
  });
  return {
    manager,
    refused,
    /** Loaders start every request while parsing, so idle means every image has settled. */
    settled: (signal: AbortSignal) =>
      loading
        ? new Promise<void>((resolve, reject) => {
            void idle.then(resolve);
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          })
        : Promise.resolve(),
  };
}

/** A texture that never received an image would sample black; draw its material without it. */
export function withoutMissingTextures(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(child.material) ? child.material : [child.material])
      for (const [key, value] of Object.entries(material))
        if (value instanceof THREE.Texture && value.version === 0) {
          Object.assign(material, { [key]: null });
          material.needsUpdate = true;
          value.dispose();
        }
  });
}

const tdsMagic = [0x4d4d, 0x3daa, 0xc23d];
const tdsNamedObject = 0x4000;
const tdsFaceArray = 0x4120;
/** The chunk lists TDSLoader walks, by the chunk holding them. */
const tdsLists = new Map<number, number[]>([
  ...tdsMagic.map((magic): [number, number[]] => [magic, [0x3d3d]]),
  [0x3d3d, [tdsNamedObject, 0xafff]],
  [tdsNamedObject, [0x4100]],
  [0x4100, [tdsFaceArray]],
  [tdsFaceArray, []],
  [0xafff, [0xa200, 0xa204, 0xa210, 0xa230]],
  ...[0xa200, 0xa204, 0xa210, 0xa230].map((map): [number, number[]] => [map, []]),
]);

/** TDSLoader reads a chunk's children by their sizes until it reaches the chunk's end, so a
 * child of size zero would repeat forever. Check every list it walks before it runs. */
export function check3DS(buffer: ArrayBuffer): void {
  const data = new DataView(buffer);
  const malformed = () => new Error('This 3DS file has a malformed chunk.');
  // Where a chunk's children begin, after the data the loader reads first.
  const children = (id: number, at: number): number => {
    if (id === tdsFaceArray) {
      if (at + 8 > data.byteLength) throw malformed();
      return at + 8 + data.getUint16(at + 6, true) * 8;
    }
    if (id !== tdsNamedObject) return at + 6;
    let end = at + 6;
    while (end < data.byteLength && data.getUint8(end)) end++;
    if (end >= data.byteLength) throw malformed();
    return end + 1;
  };
  const walk = (id: number, start: number, end: number) => {
    // The loader stops where another header no longer fits.
    for (let at = start; at < end && at + 6 <= data.byteLength;) {
      const child = data.getUint16(at, true);
      const size = data.getUint32(at + 2, true);
      if (size < 6) throw malformed();
      if (tdsLists.get(id)?.includes(child)) walk(child, children(child, at), at + size);
      at += size;
    }
  };
  if (data.byteLength < 6 || !tdsMagic.includes(data.getUint16(0, true)))
    throw new Error('This file is not a 3DS model.');
  walk(data.getUint16(0, true), 6, data.getUint32(2, true));
}

/** Bound the package before the loader expands it, and keep it to one USD layer: the loader
 * composes a referenced layer afresh for every reference, which could repeat without bound. */
export function checkUSDZ(bytes: Uint8Array): void {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('This USDZ file is not a package.');
  let layers = 0;
  unzipModelPackage(bytes, 'USDZ', (name) => {
    if (/\.usd[ac]?$/i.test(name)) layers++;
    return false;
  });
  if (!layers) throw new Error('This USDZ package holds no USD layer.');
  if (layers > 1)
    throw new Error('This USDZ package holds more than one USD layer; the preview reads one.');
}

interface Expansion {
  children: Expansion[];
  uses: string[];
  leaves: number;
}
const expansion = (): Expansion => ({ children: [], uses: [], leaves: 0 });
/** Objects a scene builds when each use of a named node is a copy of it. */
function expanded(scene: Expansion, named: Map<string, Expansion>, format: string): number {
  const sizes = new Map<Expansion, number>();
  const open = new Set<Expansion>();
  const size = (node: Expansion, depth: number): number => {
    const known = sizes.get(node);
    if (known !== undefined) return known;
    if (open.has(node)) throw new Error(`This ${format} scene uses a node inside itself.`);
    if (depth > depthLimit) throw new Error(`This ${format} scene is nested too deeply.`);
    open.add(node);
    let total = 1 + node.leaves;
    for (const child of node.children) total += size(child, depth + 1);
    for (const use of node.uses) {
      const target = named.get(use);
      if (target) total += size(target, depth + 1);
    }
    open.delete(node);
    // Saturate: past the limit the exact count no longer matters.
    sizes.set(node, Math.min(total, 2 * sceneObjectLimit));
    return sizes.get(node)!;
  };
  // The scene's own root is not an object the loader builds.
  return size(scene, 0) - 1;
}
const idAttribute = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const urlAttribute = /\burl\s*=\s*(?:"#?([^"]*)"|'#?([^']*)')/;
const attribute = (attributes: string, pattern: RegExp) => {
  const match = pattern.exec(attributes);
  return match ? (match[1] ?? match[2]) : undefined;
};

/** ColladaLoader builds every visual scene and copies a node for each instance_node, so count
 * the objects before it runs. */
export function colladaObjects(text: string): number {
  const named = new Map<string, Expansion>();
  const scene = expansion();
  const stack: Expansion[] = [];
  const tags =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)(visual_scene|node|instance_node|instance_geometry|instance_controller)\b([^>]*)>/g;
  for (const [, closing, tag, attributes = ''] of text.matchAll(tags)) {
    if (!tag) continue;
    const parent = stack.at(-1);
    const empty = attributes.endsWith('/');
    if (closing) {
      if (tag === 'node' || tag === 'visual_scene') stack.pop();
    } else if (tag === 'visual_scene') {
      // Every visual scene shares one root; nodes outside them build only when instanced.
      if (!empty) stack.push(scene);
    } else if (tag === 'node') {
      const node = expansion();
      const id = attribute(attributes, idAttribute);
      // The loader keeps the first node of an ID.
      if (id && !named.has(id)) named.set(id, node);
      parent?.children.push(node);
      if (!empty) stack.push(node);
    } else if (parent) {
      if (tag !== 'instance_node') parent.leaves++;
      else parent.uses.push(attribute(attributes, urlAttribute) ?? '');
    }
  }
  return expanded(scene, named, 'Collada');
}

/** VRMLLoader copies a DEF'd node for each USE, so count the objects before it runs. */
export function vrmlObjects(text: string): number {
  const named = new Map<string, Expansion>();
  const scene = expansion();
  const stack = [scene];
  let definition: string | undefined;
  // VRML97 identifiers, as the loader's lexer reads them.
  const identifier =
    '[^\\x30-\\x39\\0-\\x20\\x22\\x27\\x23\\x2b\\x2c\\x2d\\x2e\\x5b\\x5d\\x5c\\x7b\\x7d][^\\0-\\x20\\x22\\x27\\x23\\x2c\\x2e\\x5b\\x5d\\x5c\\x7b\\x7d]*';
  const tokens = new RegExp(
    `"(?:[^"\\\\]|\\\\.)*"|#[^\\n\\r]*|\\b(DEF|USE)\\s+(${identifier})|[{}]`,
    'g',
  );
  for (const [token, keyword, name] of text.matchAll(tokens)) {
    const parent = stack.at(-1) ?? scene;
    if (keyword === 'DEF') definition = name;
    else if (keyword === 'USE') parent.uses.push(name ?? '');
    else if (token === '}') {
      if (stack.length > 1) stack.pop();
    } else if (token === '{') {
      const node = expansion();
      // The loader keeps the last node of a name.
      if (definition) named.set(definition, node);
      definition = undefined;
      parent.children.push(node);
      stack.push(node);
    }
  }
  return expanded(scene, named, 'VRML');
}

/** A few names, then how many more. */
function names(items: string[]): string {
  const shown = items.slice(0, 6).join(', ');
  return items.length > 6 ? `${shown} and ${items.length - 6} more` : shown;
}
export function sceneNotices(scene: LoadedScene): string[] {
  return [
    ...(scene.references.length
      ? [`Files this model links to are not loaded: ${names(scene.references)}`]
      : []),
    ...(scene.skipped.length ? [`Not drawn in this preview: ${names(scene.skipped)}`] : []),
  ];
}

function disposeMeshes(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material])
      material.dispose();
  });
}

/** Read a self-contained scene. The file is read once the size check passes. */
export async function loadScene(
  format: SceneFormat,
  size: number,
  response: Response,
  signal: AbortSignal,
): Promise<LoadedScene> {
  const name = formatNames[format];
  if (size > fileLimits[format] * 1024 * 1024)
    throw new Error(`This ${name} file exceeds the ${fileLimits[format]} MB preview limit.`);
  const assets = embeddedAssets();
  const references: string[] = [];
  let skipped: string[] = [];
  let object: THREE.Object3D;
  if (format === '3ds') {
    const buffer = await response.arrayBuffer();
    check3DS(buffer);
    object = new TDSLoader(assets.manager).parse(buffer, '');
  } else if (format === 'usdz') {
    const buffer = await response.arrayBuffer();
    checkUSDZ(new Uint8Array(buffer));
    // Resolves once the package's own images have decoded.
    object = await new Promise<THREE.Group>((resolve, reject) => {
      new USDLoader(assets.manager).parse(buffer, '', resolve, reject);
    });
  } else {
    const text = await response.text();
    if (format === 'x3d') {
      const scene = parseX3D(text);
      object = scene.object;
      references.push(...scene.references);
      skipped = scene.skipped;
    } else if (format === 'dae') {
      // An entity declaration can expand without bound; Collada does not need one.
      if (/<!ENTITY/i.test(text))
        throw new Error('Collada files that declare entities are not supported.');
      if (colladaObjects(text) > sceneObjectLimit) throw geometryLimit();
      const collada = new ColladaLoader(assets.manager).parse(text, '');
      if (!collada) throw new Error('This Collada file is not valid XML.');
      object = collada.scene;
    } else {
      if (!text.includes('#VRML V2.0')) throw new Error('Only VRML 2.0 files are supported.');
      if (vrmlObjects(text) > sceneObjectLimit) throw geometryLimit();
      const world = new VRMLLoader(assets.manager).parse(text, '');
      object = new THREE.Group();
      for (const child of [...world.children]) {
        // The loader draws a Background as a sky sphere of radius 10,000, first in order;
        // framing it would shrink the model to a point.
        if (child.renderOrder === -Infinity) disposeMeshes(child);
        else object.add(child);
      }
    }
  }
  await assets.settled(signal);
  withoutMissingTextures(object);
  return {
    object,
    clips: object.animations,
    references: [...new Set([...assets.refused, ...references])],
    skipped,
  };
}
