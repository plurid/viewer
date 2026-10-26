import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import {
  meshByteLimit,
  meshTransfers,
  type MeshFormat,
  type MeshMaterial,
  type MeshPacket,
  type MeshResult,
} from './mesh-data';

function materialData(material: THREE.Material): MeshMaterial {
  const shaded = material as THREE.MeshPhongMaterial;
  const standard = material as THREE.MeshStandardMaterial;
  const points = material as THREE.PointsMaterial;
  return {
    name: material.name,
    kind:
      material instanceof THREE.MeshStandardMaterial
        ? 'standard'
        : material instanceof THREE.LineBasicMaterial
          ? 'line'
          : material instanceof THREE.PointsMaterial
            ? 'points'
            : 'phong',
    color: shaded.color.toArray(),
    opacity: material.opacity,
    transparent: material.transparent,
    vertexColors: material.vertexColors,
    flatShading: shaded.flatShading || false,
    side: material.side,
    ...(material instanceof THREE.MeshStandardMaterial
      ? { roughness: standard.roughness, metalness: standard.metalness }
      : {}),
    ...(material instanceof THREE.PointsMaterial
      ? { size: points.size, sizeAttenuation: points.sizeAttenuation }
      : {}),
  };
}
export function parseMesh(source: string | ArrayBuffer, extension: MeshFormat): MeshResult {
  if ((typeof source === 'string' ? source.length * 2 : source.byteLength) > meshByteLimit)
    throw new Error('This mesh exceeds the 128 MB parsing limit.');
  let object: THREE.Object3D;
  if (extension === 'obj')
    object = new OBJLoader().parse(
      typeof source === 'string' ? source : new TextDecoder().decode(source),
    );
  else {
    if (!(source instanceof ArrayBuffer)) throw new Error('Binary mesh input is required.');
    const geometry =
      extension === 'stl' ? new STLLoader().parse(source) : new PLYLoader().parse(source);
    geometry.computeVertexNormals();
    object = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0xb5c4cc,
        ...(extension === 'stl' ? { roughness: 0.55, metalness: 0.08 } : {}),
        vertexColors: extension === 'ply' && !!geometry.attributes.color,
        side: THREE.DoubleSide,
      }),
    );
  }
  let vertices = 0,
    triangles = 0;
  const meshes: MeshPacket[] = [];
  object.traverse((child) => {
    if (!(
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.Points
    ))
      return;
    const geometry = child.geometry;
    const positions = geometry.attributes.position?.count || 0;
    if (
      geometry.index?.array.some(
        (index: number) => !Number.isInteger(index) || index < 0 || index >= positions,
      )
    )
      throw new Error('This model has invalid geometry indices.');
    vertices += geometry.attributes.position?.count || 0;
    if (child instanceof THREE.Mesh)
      triangles += (geometry.index?.count || geometry.attributes.position?.count || 0) / 3;
    if (
      vertices > 4000000 ||
      triangles > 2000000 ||
      meshes.length >= 10000 ||
      geometry.groups.length > 20000
    )
      throw new Error('This model exceeds the geometry limit for previews.');
    const attributes: MeshPacket['attributes'] = {};
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (!(attribute instanceof THREE.BufferAttribute))
        throw new Error('Unsupported interleaved mesh data.');
      if (name === 'position' && attribute.array.some((value) => !Number.isFinite(value)))
        throw new Error('This model has invalid geometry.');
      attributes[name] = {
        array: attribute.array,
        itemSize: attribute.itemSize,
        normalized: attribute.normalized,
      };
    }
    meshes.push({
      name: child.name,
      kind:
        child instanceof THREE.Mesh ? 'mesh' : child instanceof THREE.Points ? 'points' : 'line',
      attributes,
      index: geometry.index?.array,
      groups: geometry.groups,
      materials: (Array.isArray(child.material) ? child.material : [child.material]).map(
        materialData,
      ),
    });
  });
  const result = {
    meshes,
    libraries: [
      ...((object as THREE.Group & { materialLibraries?: string[] }).materialLibraries ?? []),
    ],
  };
  meshTransfers(result);
  return result;
}
