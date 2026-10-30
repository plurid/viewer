import type { TypedArray } from 'three';

export type MeshFormat = 'obj' | 'stl' | 'ply' | 'off';
export interface MeshMaterial {
  name: string;
  kind: 'phong' | 'standard' | 'line' | 'points';
  color: number[];
  opacity: number;
  transparent: boolean;
  vertexColors: boolean;
  flatShading: boolean;
  side: number;
  roughness?: number;
  metalness?: number;
  size?: number;
  sizeAttenuation?: boolean;
}
export interface MeshPacket {
  name: string;
  kind: 'mesh' | 'line' | 'points';
  attributes: Record<string, { array: TypedArray; itemSize: number; normalized: boolean }>;
  index?: TypedArray;
  groups: { start: number; count: number; materialIndex?: number }[];
  materials: MeshMaterial[];
}
export interface MeshResult {
  meshes: MeshPacket[];
  libraries: string[];
}
export const meshByteLimit = 128 * 1024 * 1024;
export const meshVertexLimit = 4000000;
export const meshTriangleLimit = 2000000;
/** Objects a scene may build. Collada, VRML and X3D reuse nodes by reference, and each reuse
 * is a copy, so a small file could otherwise expand without bound. */
export const sceneObjectLimit = 100000;

/** Count shared buffers once; these are decoded geometry bytes, not file sizes. */
export function meshTransfers(result: MeshResult): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const mesh of result.meshes) {
    for (const attribute of Object.values(mesh.attributes)) {
      if (!(attribute.array.buffer instanceof ArrayBuffer))
        throw new Error('Unsupported mesh buffer.');
      buffers.add(attribute.array.buffer);
    }
    if (mesh.index) {
      if (!(mesh.index.buffer instanceof ArrayBuffer)) throw new Error('Unsupported mesh index.');
      buffers.add(mesh.index.buffer);
    }
  }
  if ([...buffers].reduce((size, buffer) => size + buffer.byteLength, 0) > meshByteLimit)
    throw new Error('This model exceeds the 128 MB decoded geometry limit.');
  return [...buffers];
}
