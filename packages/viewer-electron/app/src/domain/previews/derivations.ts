/** Shared vocabulary for a rendered child resource. Resource contracts, caches
 * and decoders use this type rather than repeating independent string unions. */
export const PreviewDerivation = {
  Camera: 'camera',
  Raw: 'raw',
  Video: 'video',
  Image: 'image',
  Office: 'office',
} as const;
export type PreviewDerivationKind = (typeof PreviewDerivation)[keyof typeof PreviewDerivation];
