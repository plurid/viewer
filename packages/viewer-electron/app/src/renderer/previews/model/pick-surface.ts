import * as THREE from 'three';

export function pickModelSurface(
  object: THREE.Object3D,
  camera: THREE.Camera,
  pointer: { clientX: number; clientY: number },
  rect: { left: number; top: number; width: number; height: number },
): THREE.Vector3 | undefined {
  if (rect.width <= 0 || rect.height <= 0) return;
  // Picking can precede the first GPU frame after fitting or changing a model.
  camera.updateWorldMatrix(true, false);
  object.updateWorldMatrix(true, true);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(
      ((pointer.clientX - rect.left) / rect.width) * 2 - 1,
      (-(pointer.clientY - rect.top) / rect.height) * 2 + 1,
    ),
    camera,
  );
  return ray.intersectObject(object, true).find((hit) => hit.object instanceof THREE.Mesh)?.point;
}
