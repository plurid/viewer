import * as THREE from 'three';

export function cadMaterial(color?: readonly number[]): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    // OCCT's Quantity_Color components are already linear RGB.
    color: color
      ? new THREE.Color().setRGB(color[0], color[1], color[2], THREE.LinearSRGBColorSpace)
      : 0xb5c4cc,
    roughness: 0.55,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
}

export function modelLighting(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
  // Neutral ambient fill keeps reverse-facing CAD surfaces readable.
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const ambient = new THREE.HemisphereLight(0xffffff, 0xa6aab0, 1);
  ambient.position.copy(camera.up);
  scene.add(ambient, camera);

  // Both targets share the camera's transform: orbit/pan moves the studio rig
  // without changing its direction relative to the viewer or model scale.
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(3, 4, 5);
  const fill = new THREE.DirectionalLight(0xffffff, 1.2);
  fill.position.set(-4, -2, 3);
  camera.add(key, key.target, fill, fill.target);
}
