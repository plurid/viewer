/**
 * SEGMENTERS: what outlines a feature for a check's tour (domain/models/segmentation.ts). SAM 3.1
 * outlines it from the reading model's box; when SAM is not there or gives no outline, the box
 * itself stands in, as a rectangle labelled as the model's box. Viewer never guesses an outline
 * (docs/reference/fabrication.md).
 */
import type {
  Segmentation,
  SegmentationPicture,
  SegmentationPrompt,
} from '../../domain/models/segmentation';
import { boxRegion } from '../../domain/files/regions';
import { maskPolygon } from '../../domain/models/mask-polygon';
import { pixelBox, samBoxPrompt, samRecord } from '../../domain/models/sam';
import { modelBoxLabel, samLabel } from '../../domain/models/segmentation';
import { errorMessage } from '../../domain/errors';
import { decodeOneBitMask } from './sam-mask';

export interface Segmenter {
  /** The outline, or undefined when this segmenter cannot answer the prompt. */
  segment(
    picture: SegmentationPicture,
    prompt: SegmentationPrompt,
    signal: AbortSignal,
  ): Promise<Segmentation | undefined>;
}
/** Sends a SAM prompt with its picture and returns the reply's text. */
export type SamRequest = (
  picture: SegmentationPicture,
  prompt: string,
  signal: AbortSignal,
) => Promise<string>;

/** The box the reading model gave, as a rectangle; words give nothing. */
export function boxSegmenter(reader: string): Segmenter {
  return {
    async segment(_picture, prompt, signal) {
      signal.throwIfAborted();
      if (prompt.kind !== 'box') return undefined;
      return { polygon: boxRegion(prompt.box), source: 'model-box', label: modelBoxLabel(reader) };
    },
  };
}

/** SAM 3.1's outline of what the box holds, or the box itself, said, when SAM gives none. */
export function samSegmenter(request: SamRequest, reader: string): Segmenter {
  const fallback = boxSegmenter(reader);
  return {
    async segment(picture, prompt, signal) {
      const text =
        prompt.kind === 'text'
          ? prompt.text
          : samBoxPrompt(
              pixelBox(prompt.box, picture.width, picture.height),
              picture.width,
              picture.height,
            );
      let note: string;
      try {
        const found = samRecord(await request(picture, text, signal));
        const raster =
          found && decodeOneBitMask(found.mask.payload, found.mask.width, found.mask.height);
        const polygon =
          found && raster && maskPolygon(raster, found.mask.width, found.mask.height, found);
        if (found && polygon)
          return {
            polygon,
            source: 'segmentation',
            label: samLabel,
            ...(found.confidence === undefined ? {} : { confidence: found.confidence }),
          };
        note = found ? 'SAM 3.1 found an empty outline.' : 'SAM 3.1 gave no outline.';
      } catch (error) {
        signal.throwIfAborted();
        note = `SAM 3.1 gave no outline: ${errorMessage(error)}`;
      }
      const box = await fallback.segment(picture, prompt, signal);
      return box && { ...box, note };
    },
  };
}
