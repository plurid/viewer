import * as THREE from 'three';

/** Conservative decoded allocations, with shared storage counted once. File
 * size alone cannot bound expanded geometry, morph data or image textures. */
export function modelMemory(object: THREE.Object3D) {
  const buffers = new Set<ArrayBufferLike>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (!(
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.Points
    ))
      return;
    const geometry = child.geometry;
    for (const attribute of [
      ...Object.values(geometry.attributes),
      ...Object.values(geometry.morphAttributes).flat(),
      ...(geometry.index ? [geometry.index] : []),
    ])
      buffers.add(attribute.array.buffer);
    if (child instanceof THREE.InstancedMesh) {
      buffers.add(child.instanceMatrix.array.buffer);
      if (child.instanceColor) buffers.add(child.instanceColor.array.buffer);
    }
    for (const material of Array.isArray(child.material) ? child.material : [child.material])
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
  });
  let textureBytes = 0;
  for (const texture of textures) {
    const images = Array.isArray(texture.source.data) ? texture.source.data : [texture.source.data];
    for (const image of images) {
      if (!image) continue;
      const width = Number(image.naturalWidth || image.width || 0),
        height = Number(image.naturalHeight || image.height || 0),
        depth = Number(image.depth || 1);
      const sample =
        texture.type === THREE.FloatType
          ? 4
          : texture.type === THREE.HalfFloatType || texture.type === THREE.UnsignedShortType
            ? 2
            : 1;
      const bytes = Math.max(
        width * height * depth * sample * 4,
        Number(image.data?.byteLength || 0),
      );
      if (!Number.isFinite(bytes) || bytes < 0)
        throw new Error('This model has invalid texture dimensions.');
      textureBytes += Math.ceil(bytes * (texture.generateMipmaps ? 4 / 3 : 1));
    }
  }
  return {
    geometryBytes: [...buffers].reduce((bytes, buffer) => bytes + buffer.byteLength, 0),
    textureBytes,
  };
}
export function assertModelMemory(object: THREE.Object3D, limit = 128 * 1024 * 1024) {
  const usage = modelMemory(object);
  if (usage.geometryBytes > limit)
    throw new Error('This model exceeds the 128 MB decoded geometry limit.');
  if (usage.textureBytes > limit)
    throw new Error('This model exceeds the 128 MB decoded texture limit.');
  return usage;
}
