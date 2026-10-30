import * as THREE from 'three';
import { sceneObjectLimit } from './mesh-data';

export interface X3DScene {
  object: THREE.Group;
  /** Files the scene names, such as textures and inlined worlds; none is read. */
  references: string[];
  /** Nodes outside the subset this reader draws. */
  skipped: string[];
}

const groupingNodes = new Set([
  'Transform',
  'Group',
  'StaticGroup',
  'Collision',
  'Anchor',
  'Billboard',
  'Switch',
  'LOD',
]);
const faceSets = new Set(['IndexedFaceSet', 'IndexedTriangleSet']);
const depthLimit = 256;
const geometryLimit = () => new Error('This model exceeds the geometry limit for previews.');
const invalidIndices = () => new Error('This model has invalid geometry indices.');
const invalid = (name: string) => new Error(`This X3D scene has an invalid ${name} value.`);

function numbers(element: Element, name: string): number[] {
  const value = element.getAttribute(name)?.trim();
  if (!value) return [];
  const result = value.split(/[\s,]+/).map(Number);
  if (result.some((item) => !Number.isFinite(item))) throw invalid(name);
  return result;
}
function vector(element: Element, name: string, fallback: number[]): number[] {
  const value = numbers(element, name);
  if (!value.length) return fallback;
  if (value.length !== fallback.length) throw invalid(name);
  return value;
}
function flag(element: Element, name: string, fallback: boolean): boolean {
  const value = element.getAttribute(name)?.trim().toLowerCase();
  return value ? value === 'true' : fallback;
}
function srgb(element: Element, name: string, fallback: number[]): THREE.Color {
  const [red = 0, green = 0, blue = 0] = vector(element, name, fallback);
  return new THREE.Color().setRGB(red, green, blue, THREE.SRGBColorSpace);
}
function rotation([x = 0, y = 0, z = 1, angle = 0]: number[]): THREE.Matrix4 {
  const axis = new THREE.Vector3(x, y, z);
  return axis.lengthSq() === 0
    ? new THREE.Matrix4()
    : new THREE.Matrix4().makeRotationAxis(axis.normalize(), angle);
}
/** X3D composes translation, center, rotation, scale orientation and scale, then undoes the
 * scale orientation and center. */
function transform(element: Element): THREE.Matrix4 {
  const [tx = 0, ty = 0, tz = 0] = vector(element, 'translation', [0, 0, 0]);
  const [cx = 0, cy = 0, cz = 0] = vector(element, 'center', [0, 0, 0]);
  const [sx = 1, sy = 1, sz = 1] = vector(element, 'scale', [1, 1, 1]);
  const orientation = rotation(vector(element, 'scaleOrientation', [0, 0, 1, 0]));
  return new THREE.Matrix4()
    .makeTranslation(tx + cx, ty + cy, tz + cz)
    .multiply(rotation(vector(element, 'rotation', [0, 0, 1, 0])))
    .multiply(orientation)
    .multiply(new THREE.Matrix4().makeScale(sx, sy, sz))
    .multiply(orientation.clone().invert())
    .multiply(new THREE.Matrix4().makeTranslation(-cx, -cy, -cz));
}
/** The first of an MFString's alternatives, as a file name. */
function firstURL(element: Element): string | undefined {
  const value = element.getAttribute('url')?.trim();
  if (!value) return undefined;
  const url = /"((?:[^"\\]|\\.)*)"/.exec(value)?.[1] ?? value;
  return url.split(/[\\/]/).pop() || url;
}
/** Child nodes that draw: not metadata, nor a Collision's stand-in proxy. */
const drawnChildren = (element: Element) =>
  [...element.children].filter(
    (child) =>
      !child.localName.startsWith('Metadata') && child.getAttribute('containerField') !== 'proxy',
  );

/** The plain subset of X3D's XML encoding: grouping and Transform nodes, Shape with Material,
 * IndexedFaceSet and IndexedTriangleSet, and DEF/USE. Textures and inlined worlds are named,
 * never fetched; other geometry is listed as skipped. */
export function parseX3D(text: string): X3DScene {
  // An entity declaration can expand without bound; X3D scenes do not need one.
  if (/<!ENTITY/i.test(text)) throw new Error('X3D files that declare entities are not supported.');
  const document = new DOMParser().parseFromString(text, 'application/xml');
  const root = document.documentElement;
  const scene = [...(root?.children ?? [])].find((element) => element.localName === 'Scene');
  if (document.getElementsByTagName('parsererror').length || root?.localName !== 'X3D' || !scene)
    throw new Error('This file is not a valid X3D scene.');

  const references = new Set<string>();
  const skipped = new Set<string>();
  const defined = new Map<string, unknown>();
  const sizes = new WeakMap<THREE.Object3D, number>();
  let objects = 0;
  const count = (amount: number) => {
    objects += amount;
    if (objects > sceneObjectLimit) throw geometryLimit();
  };
  /** A USE names an earlier DEF, whose value must be the kind this field holds. */
  function shared<T>(
    element: Element,
    kind: abstract new (...args: never[]) => T,
    build: () => T | undefined,
  ): T | undefined {
    const use = element.getAttribute('USE');
    if (use) {
      const value = defined.get(use);
      return value instanceof kind ? value : undefined;
    }
    const value = build();
    const name = element.getAttribute('DEF');
    if (name && value !== undefined) defined.set(name, value);
    return value;
  }
  /** A reused subtree is copied, so it counts toward the budget each time. */
  function instance(object: THREE.Object3D): THREE.Object3D {
    let size = sizes.get(object);
    if (size === undefined) {
      let items = 0;
      object.traverse(() => items++);
      sizes.set(object, (size = items));
    }
    count(size);
    return object.clone();
  }

  function coordinates(set: Element): Float32Array | undefined {
    const element = [...set.children].find((child) =>
      /^Coordinate(Double)?$/.test(child.localName),
    );
    if (!element) return undefined;
    return shared(element, Float32Array, () => {
      const points = numbers(element, 'point');
      if (points.length % 3) throw invalid('point');
      return new Float32Array(points);
    });
  }
  function colors(element: Element): Float32Array {
    const values = numbers(element, 'color');
    const size = element.localName === 'ColorRGBA' ? 4 : 3;
    if (values.length % size) throw invalid('color');
    const result = new Float32Array((values.length / size) * 3);
    const shade = new THREE.Color();
    for (let item = 0; item < values.length / size; item++)
      shade
        .setRGB(
          values[item * size]!,
          values[item * size + 1]!,
          values[item * size + 2]!,
          THREE.SRGBColorSpace,
        )
        .toArray(result, item * 3);
    return result;
  }
  function surface(set: Element): THREE.BufferGeometry | undefined {
    const points = coordinates(set);
    if (!points) return undefined;
    let index: number[] = [];
    if (set.localName === 'IndexedTriangleSet') {
      index = numbers(set, 'index');
      if (index.length % 3) throw invalidIndices();
    } else {
      let polygon: number[] = [];
      for (const corner of [...numbers(set, 'coordIndex'), -1]) {
        if (corner !== -1) {
          polygon.push(corner);
          continue;
        }
        for (let item = 1; item < polygon.length - 1; item++)
          index.push(polygon[0]!, polygon[item]!, polygon[item + 1]!);
        polygon = [];
      }
    }
    const vertices = points.length / 3;
    if (index.some((corner) => !Number.isInteger(corner) || corner < 0 || corner >= vertices))
      throw invalidIndices();
    if (!flag(set, 'ccw', true))
      for (let item = 0; item < index.length; item += 3)
        [index[item + 1], index[item + 2]] = [index[item + 2]!, index[item + 1]!];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
    // Colors indexed apart from the coordinates, or given per face, keep the material color.
    const color = [...set.children].find((child) => /^Color(RGBA)?$/.test(child.localName));
    if (color && flag(set, 'colorPerVertex', true) && !set.getAttribute('colorIndex')?.trim()) {
      const values = shared(color, Float32Array, () => colors(color));
      if (values && values.length >= points.length)
        geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
    }
    geometry.computeVertexNormals();
    return geometry;
  }
  function material(element: Element): THREE.MeshPhongMaterial {
    const transparency = numbers(element, 'transparency')[0] ?? 0;
    return new THREE.MeshPhongMaterial({
      name: element.getAttribute('DEF') ?? '',
      color: srgb(element, 'diffuseColor', [0.8, 0.8, 0.8]),
      emissive: srgb(element, 'emissiveColor', [0, 0, 0]),
      specular: srgb(element, 'specularColor', [0, 0, 0]),
      shininess: (numbers(element, 'shininess')[0] ?? 0.2) * 128,
      opacity: 1 - transparency,
      transparent: transparency > 0,
    });
  }
  function appearance(element: Element): THREE.MeshPhongMaterial | undefined {
    return shared(element, THREE.MeshPhongMaterial, () => {
      let result = new THREE.MeshPhongMaterial({ color: 0xcccccc });
      for (const child of element.children) {
        if (child.localName === 'Material')
          result = shared(child, THREE.MeshPhongMaterial, () => material(child)) ?? result;
        else if (child.localName === 'ImageTexture') {
          const url = firstURL(child);
          if (url) references.add(url);
        }
      }
      return result;
    });
  }
  function shape(element: Element): THREE.Mesh | undefined {
    let look: THREE.MeshPhongMaterial | undefined;
    let geometry: THREE.BufferGeometry | undefined;
    let set: Element | undefined;
    for (const child of element.children) {
      if (child.localName === 'Appearance') look = appearance(child);
      else if (faceSets.has(child.localName)) {
        set = child;
        geometry = shared(child, THREE.BufferGeometry, () => surface(child));
      } else if (!child.localName.startsWith('Metadata')) skipped.add(child.localName);
    }
    if (!geometry || !set) return undefined;
    // Sidedness and shading are the geometry's fields, so a shared material is copied.
    const drawn = look?.clone() ?? new THREE.MeshPhongMaterial({ color: 0xb5c4cc });
    drawn.side = flag(set, 'solid', true) ? THREE.FrontSide : THREE.DoubleSide;
    drawn.flatShading = (numbers(set, 'creaseAngle')[0] ?? 0) <= 0;
    // A Color node replaces the diffuse color.
    if (geometry.attributes.color) {
      drawn.vertexColors = true;
      drawn.color.set(0xffffff);
    }
    count(1);
    const mesh = new THREE.Mesh(geometry, drawn);
    mesh.name = element.getAttribute('DEF') ?? '';
    return mesh;
  }
  function group(element: Element, depth: number): THREE.Group {
    count(1);
    const result = new THREE.Group();
    result.name = element.getAttribute('DEF') ?? '';
    if (element.localName === 'Transform') {
      result.matrixAutoUpdate = false;
      result.matrix.copy(transform(element));
    }
    let members = drawnChildren(element);
    // A Switch draws its chosen child; an LOD its most detailed level.
    if (element.localName === 'Switch') {
      const choice = numbers(element, 'whichChoice')[0] ?? -1;
      members = choice >= 0 ? members.slice(choice, choice + 1) : [];
    } else if (element.localName === 'LOD') members = members.slice(0, 1);
    for (const member of members) {
      const object = node(member, depth + 1);
      if (object) result.add(object);
    }
    return result;
  }
  function node(element: Element, depth: number): THREE.Object3D | undefined {
    if (depth > depthLimit) throw new Error('This X3D scene is nested too deeply.');
    const name = element.localName;
    if (name === 'Inline' || name === 'ExternProtoDeclare') {
      const url = firstURL(element);
      if (url) references.add(url);
      return undefined;
    }
    if (name === 'ProtoInstance') skipped.add(name);
    if (name !== 'Shape' && !groupingNodes.has(name)) return undefined;
    const use = element.getAttribute('USE');
    if (use) {
      const value = defined.get(use);
      return value instanceof THREE.Object3D ? instance(value) : undefined;
    }
    const object = name === 'Shape' ? shape(element) : group(element, depth);
    const definition = element.getAttribute('DEF');
    if (definition && object) defined.set(definition, object);
    return object;
  }

  const object = new THREE.Group();
  for (const element of drawnChildren(scene)) {
    const child = node(element, 1);
    if (child) object.add(child);
  }
  return { object, references: [...references], skipped: [...skipped] };
}
