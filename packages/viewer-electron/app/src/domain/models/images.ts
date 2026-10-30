/**
 * PICTURES A MODEL READS: photos re-encoded by the desktop and drawing pages rendered by the
 * renderer, each sent as a JPEG or PNG part of the one message. They need the `images` data level
 * (permissions.ts); the model knows each one only by the inventory ref the text gives it.
 */

export const modelImageTypes = ['image/jpeg', 'image/png'] as const;
export type ModelImageType = (typeof modelImageTypes)[number];
export interface ModelImage {
  type: ModelImageType;
  data: Uint8Array;
}

/** Bytes before base64, which adds a third. */
export const modelImageLimits = {
  count: 16,
  /** One picture. */
  bytes: 4_000_000,
  /** Every picture of one request together. */
  total: 16_000_000,
} as const;

/** Why these pictures cannot be sent together, or undefined when they can. */
export function modelImagesProblem(images: readonly ModelImage[]): string | undefined {
  if (images.length > modelImageLimits.count)
    return `A request sends at most ${modelImageLimits.count} pictures; this one has ${images.length}.`;
  let total = 0;
  for (const image of images) {
    if (!modelImageTypes.includes(image.type)) return 'Pictures are sent as JPEG or PNG.';
    if (!image.data.byteLength) return 'A picture is empty.';
    if (image.data.byteLength > modelImageLimits.bytes)
      return `A picture is larger than ${modelImageLimits.bytes / 1_000_000} MB.`;
    total += image.data.byteLength;
  }
  if (total > modelImageLimits.total)
    return `The pictures come to more than ${modelImageLimits.total / 1_000_000} MB together.`;
  return undefined;
}
