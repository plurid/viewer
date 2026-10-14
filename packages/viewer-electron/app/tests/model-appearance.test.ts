import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  defaultModelAppearance,
  modelLighting,
  normalizeModelAppearance,
} from '../src/renderer/previews/model/appearance';
import { modelSurfaceAppearance } from '../src/renderer/previews/model/surface-appearance';

it('recovers invalid retained shading values and bounds exposure', () => {
  expect(
    normalizeModelAppearance({
      shading: 'missing',
      lighting: 'invalid',
      exposure: NaN,
      edges: 'yes',
    }),
  ).toEqual(defaultModelAppearance);
  expect(normalizeModelAppearance({ exposure: 100 })).toMatchObject({ exposure: 1.6 });
  expect(normalizeModelAppearance({ exposure: -5 })).toMatchObject({ exposure: 0.4 });
});
it('fits the shadow rig to offset geometry and keeps lighting stable relative to the orbiting camera', () => {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  camera.up.set(0, 0, 1);
  camera.position.set(100, 300, 200);
  camera.lookAt(20, 30, 40);
  const rig = modelLighting(scene, camera),
    bounds = new THREE.Box3(new THREE.Vector3(10, 20, 30), new THREE.Vector3(30, 40, 50));
  try {
    rig.fit(bounds);
    rig.apply('contrast', true);
    scene.updateMatrixWorld(true);
    const key = camera.children.find(
      (node) => node instanceof THREE.DirectionalLight,
    ) as THREE.DirectionalLight;
    expect(
      key.target.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(20, 30, 40)),
    ).toBeLessThan(1e-10);
    expect(key.shadow.camera.right).toBeGreaterThan(
      bounds.getSize(new THREE.Vector3()).length() / 2,
    );
    const direction = key.position.clone().sub(key.target.position).normalize();
    camera.position.set(-300, 100, -200);
    camera.lookAt(20, 30, 40);
    rig.update();
    scene.updateMatrixWorld(true);
    expect(
      key.position.clone().sub(key.target.position).normalize().distanceTo(direction),
    ).toBeLessThan(1e-12);
    expect(
      key.target.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(20, 30, 40)),
    ).toBeLessThan(1e-10);
    rig.apply('soft', false);
    expect(key.castShadow).toBe(false);
  } finally {
    rig.dispose();
  }
});
it('changes surface presentation without replacing geometry, source colors or textures', () => {
  const geometry = new THREE.BoxGeometry(20, 80, 60),
    texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ color: 0xff9900, map: texture });
  const mesh = new THREE.Mesh(geometry, material),
    surfaces = modelSurfaceAppearance(mesh);
  const positions = geometry.attributes.position.array.slice();
  try {
    surfaces.apply({ ...defaultModelAppearance, shading: 'clay' }, false);
    expect(mesh.material).not.toBe(material);
    expect(mesh.geometry).toBe(geometry);
    expect(material.color.getHexString()).toBe('ff9900');
    expect(material.map).toBe(texture);
    surfaces.apply({ ...defaultModelAppearance, shading: 'normals' }, false);
    expect(mesh.material).toBeInstanceOf(THREE.MeshNormalMaterial);
    expect(mesh.castShadow).toBe(false);
    surfaces.apply({ ...defaultModelAppearance }, true);
    expect(mesh.material).toBe(material);
    expect(material.wireframe).toBe(true);
    surfaces.apply({ ...defaultModelAppearance }, false);
    expect(material.wireframe).toBe(false);
    expect(mesh.receiveShadow).toBe(true);
    expect(geometry.attributes.position.array).toEqual(positions);
  } finally {
    surfaces.dispose();
    geometry.dispose();
    material.dispose();
    texture.dispose();
  }
});
it('caches feature edges, omits coplanar triangle diagonals and releases only its own overrides', () => {
  const geometry = new THREE.BoxGeometry(),
    material = new THREE.MeshStandardMaterial(),
    mesh = new THREE.Mesh(geometry, material);
  const originalDisposed = vi.fn();
  material.addEventListener('dispose', originalDisposed);
  const surfaces = modelSurfaceAppearance(mesh);
  try {
    surfaces.apply({ ...defaultModelAppearance, edges: true }, false);
    const line = mesh.children[0] as THREE.LineSegments;
    expect(line.geometry.attributes.position.count).toBe(24);
    surfaces.apply({ ...defaultModelAppearance, edges: false }, false);
    expect(line.visible).toBe(false);
    surfaces.apply({ ...defaultModelAppearance, edges: true, shading: 'clay' }, false);
    expect(mesh.children).toEqual([line]);
    const edgeDisposed = vi.fn();
    line.geometry.addEventListener('dispose', edgeDisposed);
    surfaces.dispose();
    expect(edgeDisposed).toHaveBeenCalledOnce();
    expect(originalDisposed).not.toHaveBeenCalled();
    expect(mesh.children).toHaveLength(0);
    expect(mesh.material).toBe(material);
  } finally {
    geometry.dispose();
    material.dispose();
  }
});
it('does not present undeformed feature edges on skinned or morphing meshes', () => {
  const geometry = new THREE.BoxGeometry(),
    material = new THREE.MeshStandardMaterial();
  const skinned = new THREE.SkinnedMesh(geometry, material),
    morphed = new THREE.Mesh(geometry, material);
  morphed.morphTargetInfluences = [0.5];
  const object = new THREE.Group();
  object.add(skinned, morphed);
  const surfaces = modelSurfaceAppearance(object);
  try {
    expect(surfaces.hasDeformingMeshes).toBe(true);
    surfaces.apply({ ...defaultModelAppearance, edges: true }, false);
    expect(skinned.children).toHaveLength(0);
    expect(morphed.children).toHaveLength(0);
  } finally {
    surfaces.dispose();
    geometry.dispose();
    material.dispose();
  }
});
