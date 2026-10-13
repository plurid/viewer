import * as THREE from 'three';
import { expect, it } from 'vitest';
import { pickModelSurface } from '../src/renderer/previews/model/pick-surface';

const rect = { left: 0, top: 0, width: 800, height: 600 };
const pointer = { clientX: 400, clientY: 300 };

it('picks a freshly framed model before the first renderer frame', () => {
  const camera = new THREE.PerspectiveCamera(40, 800 / 600, 0.01, 10000);
  camera.up.set(0, 0, 1);
  camera.position.set(600, 400, 900);
  camera.lookAt(0, 0, 0);
  const model = new THREE.Mesh(new THREE.BoxGeometry(300, 300, 300), new THREE.MeshBasicMaterial());
  try {
    const point = pickModelSurface(model, camera, pointer, rect);
    expect(point).toBeDefined();
    expect(point!.z).toBeCloseTo(150);
    expect(point!.x).toBeCloseTo(100);
    expect(point!.y).toBeCloseTo(200 / 3);
  } finally {
    model.geometry.dispose();
    model.material.dispose();
  }
});

it('picks the current model transform even when a render is still queued', () => {
  const camera = new THREE.PerspectiveCamera(40, 800 / 600, 0.01, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const model = new THREE.Group(),
    mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  model.add(mesh);
  model.position.x = 10;
  model.updateMatrixWorld(true);
  model.position.x = 0;
  try {
    const point = pickModelSurface(model, camera, pointer, rect);
    expect(point).toBeDefined();
    expect(point!.toArray()).toEqual([0, 0, 1]);
  } finally {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});
