import * as THREE from 'three';

export function cadMaterial(color?: readonly number[]): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    // OCCT's Quantity_Color components are already linear RGB.
    color: color
      ? new THREE.Color().setRGB(
          color[0] ?? 0,
          color[1] ?? 0,
          color[2] ?? 0,
          THREE.LinearSRGBColorSpace,
        )
      : 0xb5c4cc,
    roughness: 0.55,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
}

export type ModelLighting = 'studio' | 'contrast' | 'soft';
export type ModelShading = 'shaded' | 'clay' | 'normals';
export interface ModelAppearance {
  shading: ModelShading;
  lighting: ModelLighting;
  exposure: number;
  edges: boolean;
  shadows: boolean;
}
export const defaultModelAppearance: Readonly<ModelAppearance> = Object.freeze({
  shading: 'shaded',
  lighting: 'contrast',
  exposure: 0.85,
  edges: false,
  shadows: true,
});
export function normalizeModelAppearance(value: unknown): ModelAppearance {
  const input = value && typeof value === 'object' ? (value as Partial<ModelAppearance>) : {};
  return {
    shading: ['shaded', 'clay', 'normals'].includes(String(input.shading))
      ? input.shading!
      : defaultModelAppearance.shading,
    lighting: ['studio', 'contrast', 'soft'].includes(String(input.lighting))
      ? input.lighting!
      : defaultModelAppearance.lighting,
    exposure:
      typeof input.exposure === 'number' && Number.isFinite(input.exposure)
        ? THREE.MathUtils.clamp(input.exposure, 0.4, 1.6)
        : defaultModelAppearance.exposure,
    edges: typeof input.edges === 'boolean' ? input.edges : defaultModelAppearance.edges,
    shadows: typeof input.shadows === 'boolean' ? input.shadows : defaultModelAppearance.shadows,
  };
}
const presets = {
  studio: { ambient: 0.14, hemisphere: 0.4, key: 2, fill: 0.55, direction: [3, 4, 5] },
  contrast: { ambient: 0.08, hemisphere: 0.22, key: 2.2, fill: 0.2, direction: [-4, 5, 3] },
  soft: { ambient: 0.25, hemisphere: 0.65, key: 1.4, fill: 0.8, direction: [3, 4, 5] },
} as const;
export function modelLighting(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const ambient = new THREE.AmbientLight(0xffffff, 0.08);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xa6aab0, 0.22);
  hemisphere.position.copy(camera.up);
  scene.add(ambient, hemisphere, camera);

  // Both targets share the camera's transform: orbit/pan moves the studio rig
  // without changing its direction relative to the viewer or model scale.
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  const fill = new THREE.DirectionalLight(0xffffff, 0.2);
  camera.add(key, key.target, fill, fill.target);
  key.shadow.mapSize.set(2048, 2048);
  const center = new THREE.Vector3(),
    local = new THREE.Vector3();
  const direction = new THREE.Vector3(-4, 5, 3).normalize();
  const fillDirection = new THREE.Vector3(4, -2, 5).normalize();
  let radius = 1;
  const update = () => {
    camera.updateWorldMatrix(true, false);
    local.copy(center).applyMatrix4(camera.matrixWorldInverse);
    key.target.position.copy(local);
    fill.target.position.copy(local);
    key.position.copy(local).addScaledVector(direction, radius * 5);
    fill.position.copy(local).addScaledVector(fillDirection, radius * 5);
  };
  return {
    apply(profile: ModelLighting, shadows: boolean) {
      const value = presets[profile];
      ambient.intensity = value.ambient;
      hemisphere.intensity = value.hemisphere;
      key.intensity = value.key;
      fill.intensity = value.fill;
      direction.fromArray(value.direction).normalize();
      key.castShadow = shadows;
      update();
    },
    fit(bounds: THREE.Box3) {
      bounds.getCenter(center);
      radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.001);
      Object.assign(key.shadow.camera, {
        left: -radius * 1.2,
        right: radius * 1.2,
        top: radius * 1.2,
        bottom: -radius * 1.2,
        near: radius * 3,
        far: radius * 7,
      });
      key.shadow.camera.updateProjectionMatrix();
      key.shadow.normalBias = radius * 0.004;
      key.shadow.bias = -0.0005;
      update();
    },
    update,
    dispose() {
      key.shadow.dispose();
    },
  };
}
