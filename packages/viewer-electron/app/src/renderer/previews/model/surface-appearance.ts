import * as THREE from 'three';
import type { ModelAppearance } from './appearance';

/** Display overrides retain the source materials, textures, animation and mesh geometry. */
export function modelSurfaceAppearance(object: THREE.Object3D) {
  const meshes = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.set(child, child.material);
  });
  const clay = new THREE.MeshStandardMaterial({
    color: 0x9ca9b5,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const normals = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide, toneMapped: false });
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x18232d,
    transparent: true,
    opacity: 0.75,
    toneMapped: false,
  });
  const edgeGeometry = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();
  const edges = new Map<THREE.Mesh, THREE.LineSegments>();
  const rigid = (mesh: THREE.Mesh) =>
    !(mesh instanceof THREE.SkinnedMesh) && !mesh.morphTargetInfluences?.length;
  const hasDeformingMeshes = [...meshes.keys()].some((mesh) => !rigid(mesh));
  return {
    hasDeformingMeshes,
    apply(value: ModelAppearance, wireframe: boolean) {
      clay.wireframe = wireframe;
      normals.wireframe = wireframe;
      for (const [mesh, original] of meshes) {
        mesh.material =
          value.shading === 'clay' ? clay : value.shading === 'normals' ? normals : original;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          if ('wireframe' in material)
            (material as THREE.MeshStandardMaterial).wireframe = wireframe;
        mesh.castShadow = mesh.receiveShadow =
          value.shadows && value.shading !== 'normals' && !wireframe;
        const visible = value.edges && !wireframe && rigid(mesh);
        let line = edges.get(mesh);
        if (visible && !line) {
          let geometry = edgeGeometry.get(mesh.geometry);
          if (!geometry) {
            geometry = new THREE.EdgesGeometry(mesh.geometry, 30);
            edgeGeometry.set(mesh.geometry, geometry);
          }
          line = new THREE.LineSegments(geometry, edgeMaterial);
          line.name = 'Viewer surface edges';
          line.renderOrder = 1;
          mesh.add(line);
          edges.set(mesh, line);
        }
        if (line) line.visible = visible;
      }
    },
    dispose() {
      for (const [mesh, original] of meshes) mesh.material = original;
      for (const [mesh, line] of edges) mesh.remove(line);
      for (const geometry of edgeGeometry.values()) geometry.dispose();
      clay.dispose();
      normals.dispose();
      edgeMaterial.dispose();
    },
  };
}
