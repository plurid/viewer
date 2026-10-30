/**
 * SEGMENTATION: the outline of one feature on a drawing page or photo, found from a box or words,
 * as SAM 3.1 answers it, in the picture's unit coordinates. The desktop's segmenters
 * (desktop/models/segmentation.ts) answer it.
 */
import type { EvidenceRegion } from '../files/inspection';
import type { UnitBox } from '../files/regions';
import type { ModelImage } from './images';

/** What the feature is found from: a box around it, or a short noun phrase naming it. */
export type SegmentationPrompt = { kind: 'box'; box: UnitBox } | { kind: 'text'; text: string };
export type SegmentationPromptKind = SegmentationPrompt['kind'];
/** The picture a feature is outlined on, as the reading model saw it. */
export interface SegmentationPicture {
  image: ModelImage;
  width: number;
  height: number;
}
/** Who drew the outline: SAM, or the box the reading model gave. */
export type SegmentationSource = 'segmentation' | 'model-box';
export interface Segmentation {
  polygon: EvidenceRegion;
  source: SegmentationSource;
  /** What the outline is, as the check shows it: "outline from SAM 3.1", "box from Muse Spark". */
  label: string;
  /** SAM's confidence, from 0 to 1. */
  confidence?: number;
  /** Why SAM's outline was not used, when the box stands in for it. */
  note?: string;
}
/** "box from Muse Spark". */
export const modelBoxLabel = (reader: string) => `box from ${reader}`;
/** SAM 3.1, as the check names it while it outlines. */
export const samName = 'SAM 3.1';
export const samLabel = `outline from ${samName}`;
