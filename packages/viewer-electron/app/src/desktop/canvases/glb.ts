import { z } from 'zod';
import { imageDimensions } from '../previews/image-dimensions';
const index = z.number().int().nonnegative();
const schema = z.object({
  asset: z.object({ version: z.literal('2.0') }),
  buffers: z.array(z.object({ byteLength: index, uri: z.string().optional() })).max(1),
  bufferViews: z
    .array(z.object({ buffer: z.literal(0), byteOffset: index.default(0), byteLength: index }))
    .max(100000)
    .default([]),
  accessors: z
    .array(
      z.object({
        count: index,
        componentType: index,
        type: z.enum(['SCALAR', 'VEC2', 'VEC3', 'VEC4', 'MAT2', 'MAT3', 'MAT4']),
      }),
    )
    .max(100000),
  meshes: z
    .array(
      z.object({
        primitives: z
          .array(z.object({ attributes: z.object({ POSITION: index }) }))
          .min(1)
          .max(10000),
      }),
    )
    .min(1)
    .max(10000),
  images: z
    .array(z.object({ bufferView: index, uri: z.never().optional() }))
    .max(256)
    .default([]),
});

/** Reject external companions and bound decoded allocations before a generated model is attached. */
export function validateReconstructedGLB(bytes: Buffer): void {
  if (
    bytes.length < 28 ||
    bytes.length > 32 * 1024 * 1024 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw new Error('The reconstruction did not return a valid GLB file.');
  const jsonLength = bytes.readUInt32LE(12);
  if (
    jsonLength > 4 * 1024 * 1024 ||
    bytes.readUInt32LE(16) !== 0x4e4f534a ||
    28 + jsonLength > bytes.length
  )
    throw new Error('The GLB metadata is invalid or too large.');
  const document = schema.parse(JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')));
  const binStart = 28 + jsonLength;
  const binSize = bytes.readUInt32LE(20 + jsonLength);
  if (
    bytes.readUInt32LE(24 + jsonLength) !== 0x004e4942 ||
    binStart + binSize !== bytes.length ||
    document.buffers.some((buffer) => buffer.uri || buffer.byteLength > binSize)
  )
    throw new Error('The GLB must contain all of its geometry and textures.');
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const geometry = document.accessors.reduce(
    (sum, accessor) => sum + accessor.count * components[accessor.type] * 4,
    0,
  );
  if (geometry > 128_000_000)
    throw new Error('This model exceeds the 128 MB decoded geometry limit.');
  for (const mesh of document.meshes)
    for (const primitive of mesh.primitives) {
      const positions = document.accessors[primitive.attributes.POSITION];
      if (
        !positions ||
        positions.type !== 'VEC3' ||
        !positions.count ||
        positions.count > 5_000_000
      )
        throw new Error('The GLB contains invalid or oversized mesh geometry.');
    }
  let textureBytes = 0;
  for (const view of document.bufferViews)
    if (view.byteOffset + view.byteLength > binSize)
      throw new Error('The GLB contains invalid buffer ranges.');
  for (const image of document.images) {
    const view = document.bufferViews[image.bufferView];
    const size =
      view &&
      imageDimensions(
        bytes.subarray(binStart + view.byteOffset, binStart + view.byteOffset + view.byteLength),
      );
    if (!size) throw new Error('The GLB contains an unsupported embedded texture.');
    textureBytes += (size.width * size.height * 4 * 4) / 3;
  }
  if (textureBytes > 128_000_000)
    throw new Error('This model exceeds the 128 MB decoded texture limit.');
}
