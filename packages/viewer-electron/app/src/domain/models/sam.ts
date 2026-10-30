/**
 * SAM 3.1's WIRE GRAMMAR, as its Responses API reads and writes it. A prompt is a short noun phrase,
 * or an object prompt: `<0f>0<|box;x1=L;y1=T;x2=R;y2=B;w=W;h=H|>` in source pixels, `x2` and `y2`
 * inclusive. A reply's record is `<0f>0<|box;…;c=…|><|mask;x=0;y=0;c=…;data=H,W,!…|>`: the box SAM
 * found, and a mask raster of H × W cells laid over that box (its half-open pixel bounds), in the
 * `!` one_bit encoding that desktop/models/sam-mask.ts decodes.
 */
import type { UnitBox } from '../files/regions';

/** The SAM model the `meta` provider's Responses route segments with. */
export const samModel = 'sam-3.1';

export interface PixelBox {
  left: number;
  top: number;
  /** Exclusive. */
  right: number;
  bottom: number;
}
/** A box in page or photo fractions as whole source pixels, at least one pixel each way. */
export function pixelBox(box: UnitBox, width: number, height: number): PixelBox {
  const clamp = (value: number, most: number) => Math.max(0, Math.min(most, value));
  const left = clamp(Math.floor(box.x * width), width - 1);
  const top = clamp(Math.floor(box.y * height), height - 1);
  return {
    left,
    top,
    right: clamp(Math.ceil((box.x + box.width) * width), width) || left + 1,
    bottom: clamp(Math.ceil((box.y + box.height) * height), height) || top + 1,
  };
}
/** The object prompt for one box on a `width` × `height` picture. */
export function samBoxPrompt(box: PixelBox, width: number, height: number): string {
  const right = Math.max(box.left, box.right - 1);
  const bottom = Math.max(box.top, box.bottom - 1);
  return `<0f>0<|box;x1=${box.left};y1=${box.top};x2=${right};y2=${bottom};w=${width};h=${height}|>`;
}

export interface SamRecord {
  /** The source pixels the mask covers, right and bottom exclusive. */
  bounds: PixelBox;
  /** The picture's size as SAM read it. */
  frame: { width: number; height: number };
  mask: { width: number; height: number; payload: string };
  confidence?: number;
}
const record = /<\|box;([^|]*)\|><\|mask;([^|]*)\|>/;
function fields(body: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of body.split(';')) {
    const at = part.indexOf('=');
    if (at > 0) values.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return values;
}
const whole = (value: string | undefined) =>
  value !== undefined && /^-?\d+$/.test(value) ? Number(value) : undefined;

/** The first object's box and mask in a reply, or undefined when it has none Viewer reads. */
export function samRecord(text: string): SamRecord | undefined {
  const found = record.exec(text);
  if (!found) return undefined;
  const box = fields(found[1]!);
  const mask = fields(found[2]!);
  const [x1, y1, x2, y2, width, height] = ['x1', 'y1', 'x2', 'y2', 'w', 'h'].map((key) =>
    whole(box.get(key)),
  );
  const data = /^(\d+),(\d+),(![^|]+)$/.exec(mask.get('data') ?? '');
  if (
    x1 === undefined ||
    y1 === undefined ||
    x2 === undefined ||
    y2 === undefined ||
    !width ||
    !height ||
    x1 < 0 ||
    y1 < 0 ||
    x2 < x1 ||
    y2 < y1 ||
    x2 >= width ||
    y2 >= height ||
    mask.get('x') !== '0' ||
    mask.get('y') !== '0' ||
    !data
  )
    return undefined;
  const confidence = Number(mask.get('c') ?? box.get('c'));
  return {
    bounds: { left: x1, top: y1, right: x2 + 1, bottom: y2 + 1 },
    frame: { width, height },
    mask: { height: Number(data[1]), width: Number(data[2]), payload: data[3]! },
    ...(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? { confidence } : {}),
  };
}
