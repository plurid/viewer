import { expect, it } from 'vitest';
import * as THREE from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { parseMesh } from '../src/renderer/previews/model/mesh-parser';
import { meshObjects } from '../src/renderer/previews/model/mesh';
import { meshTransfers } from '../src/renderer/previews/model/mesh-data';
import { assertModelMemory, modelMemory } from '../src/renderer/previews/model/memory';

it('transfers OBJ geometry, groups and material identity without copying numeric vertex arrays', () => {
  const parsed = parseMesh(
    'mtllib sample.mtl\no sample\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl red\nf 1/1 2/2 3/3\n',
    'obj',
  );
  expect(parsed.libraries).toEqual(['sample.mtl']);
  const transfers = meshTransfers(parsed);
  const cloned = structuredClone(parsed, { transfer: transfers });
  expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
  const materials = new MTLLoader().parse('newmtl red\nKd 1 0 0\n', '');
  const group = meshObjects(cloned, materials);
  const mesh = group.children[0] as THREE.Mesh;
  expect(mesh.geometry.getAttribute('position').count).toBe(3);
  expect(mesh.geometry.getAttribute('uv').count).toBe(3);
  expect((mesh.material as THREE.MeshPhongMaterial).color.getHexString()).toBe('ff0000');
  expect(mesh.name).toBe('sample');
  expect(new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).toArray()).toEqual([
    1, 1, 0,
  ]);
});

it('parses STL and PLY off-thread packets with valid normals and the original surface defaults', () => {
  const stl =
    'solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid test';
  const ply =
    'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n';
  for (const [format, text] of [
    ['stl', stl],
    ['ply', ply],
  ] as const) {
    const mesh = meshObjects(parseMesh(new TextEncoder().encode(text).buffer, format))
      .children[0] as THREE.Mesh;
    expect(mesh.geometry.getAttribute('normal').count).toBe(3);
    expect((mesh.material as THREE.MeshStandardMaterial).roughness).toBe(
      format === 'stl' ? 0.55 : 1,
    );
    expect(mesh.material).toMatchObject({ side: THREE.DoubleSide });
  }
});

it('rejects invalid coordinates before GPU geometry is constructed', () => {
  expect(() => parseMesh('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 99\n', 'obj')).toThrow(
    'invalid geometry',
  );
});

it('counts shared geometry and textures once and rejects decoded texture/morph growth', () => {
  const group = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const storage = new Float32Array(24);
  geometry.setAttribute('position', new THREE.BufferAttribute(storage.subarray(0, 9), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(storage.subarray(9, 18), 3));
  const texture = new THREE.DataTexture(new Uint8Array(64), 4, 4);
  texture.generateMipmaps = false;
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
  group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  expect(modelMemory(group)).toEqual({ geometryBytes: 96, textureBytes: 64 });
  expect(() => assertModelMemory(group, 100)).not.toThrow();
  geometry.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(30), 3)];
  expect(() => assertModelMemory(group, 100)).toThrow('geometry');
  geometry.morphAttributes = {};
  texture.source.data = { width: 20000, height: 20000, data: new Uint8Array(0) };
  expect(() => assertModelMemory(group)).toThrow('texture');
});
