import * as THREE from 'three';
import { PreviewWorker } from '../worker-client';
import { meshTransfers, type MeshFormat, type MeshMaterial, type MeshResult } from './mesh-data';

export async function importMesh(
  source: string | ArrayBuffer,
  extension: MeshFormat,
  signal: AbortSignal,
): Promise<MeshResult> {
  signal.throwIfAborted();
  const client = new PreviewWorker(
    () => new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' }),
    'Mesh parsing',
  );
  try {
    return await client.request<MeshResult>(
      { source, extension },
      signal,
      typeof source === 'string' ? [] : [source],
    );
  } finally {
    client.close();
  }
}
function restoreMaterial(data: MeshMaterial): THREE.Material {
  const material =
    data.kind === 'standard'
      ? new THREE.MeshStandardMaterial({ roughness: data.roughness, metalness: data.metalness })
      : data.kind === 'line'
        ? new THREE.LineBasicMaterial()
        : data.kind === 'points'
          ? new THREE.PointsMaterial({ size: data.size, sizeAttenuation: data.sizeAttenuation })
          : new THREE.MeshPhongMaterial({ flatShading: data.flatShading });
  material.name = data.name;
  material.color.fromArray(data.color);
  material.opacity = data.opacity;
  material.transparent = data.transparent;
  material.vertexColors = data.vertexColors;
  material.side = data.side as THREE.Side;
  return material;
}
export function meshObjects(
  result: MeshResult,
  creator?: { create(name: string): THREE.Material },
): THREE.Group {
  meshTransfers(result);
  const group = new THREE.Group();
  for (const part of result.meshes) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(part.attributes))
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized),
      );
    if (part.index) geometry.setIndex(new THREE.BufferAttribute(part.index, 1));
    for (const item of part.groups) geometry.addGroup(item.start, item.count, item.materialIndex);
    const materials = part.materials.map((data) => {
      const source = creator?.create(data.name) as THREE.MeshPhongMaterial | undefined;
      if (!source) return restoreMaterial(data);
      if (part.kind === 'mesh') return source;
      const material =
        part.kind === 'points'
          ? new THREE.PointsMaterial({ size: 10, sizeAttenuation: false })
          : new THREE.LineBasicMaterial();
      THREE.Material.prototype.copy.call(material, source);
      material.color.copy(source.color);
      if (material instanceof THREE.PointsMaterial) material.map = source.map;
      return material;
    });
    const material = materials.length === 1 ? materials[0]! : materials;
    const object =
      part.kind === 'mesh'
        ? new THREE.Mesh(geometry, material)
        : part.kind === 'line'
          ? new THREE.LineSegments(
              geometry,
              material as THREE.LineBasicMaterial | THREE.LineBasicMaterial[],
            )
          : new THREE.Points(geometry, material as THREE.PointsMaterial);
    object.name = part.name;
    group.add(object);
  }
  return group;
}
