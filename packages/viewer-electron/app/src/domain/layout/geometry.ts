/** Rectangles, crops and rotations shared by the layout algorithms. Lengths are PDF points. */
export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Size {
  x: number;
  y: number;
}
/** A part of a picture, as fractions of its width and height. */
export type Crop = Rect;
export type Rotation = 0 | 90 | 180 | 270;
/** Which part of a picture a fill crop keeps. */
export type CropAnchor = 'center' | 'top' | 'bottom' | 'left' | 'right';
export const cropAnchors = ['center', 'top', 'bottom', 'left', 'right'] as const;

export const wholeCrop: Crop = { x: 0, y: 0, width: 1, height: 1 };
export const aspect = (size: Size) => size.width / size.height;
export const area = (size: Size) => size.width * size.height;
export const turned = (size: Size, rotate: Rotation): Size =>
  rotate === 90 || rotate === 270 ? { width: size.height, height: size.width } : size;
export const inset = (rect: Rect, left: number, top = left, right = left, bottom = top): Rect => ({
  x: rect.x + left,
  y: rect.y + top,
  width: Math.max(0, rect.width - left - right),
  height: Math.max(0, rect.height - top - bottom),
});
export const pageBox = (size: Size): Rect => ({ x: 0, y: 0, ...size });
export const transpose = (rect: Rect): Rect => ({
  x: rect.y,
  y: rect.x,
  width: rect.height,
  height: rect.width,
});
export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - 1e-6 &&
  b.x < a.x + a.width - 1e-6 &&
  a.y < b.y + b.height - 1e-6 &&
  b.y < a.y + a.height - 1e-6;
/** Whole numbers within a millionth count as whole: lengths converted from millimetres drift. */
export const floorClose = (value: number) => Math.floor(value + 1e-9);
export const ceilClose = (value: number) => Math.ceil(value - 1e-9);

/** The largest rectangle of `size`'s proportions inside `frame`, centred. */
export function fitInside(size: Size, frame: Rect): Rect {
  const scale = Math.min(frame.width / size.width, frame.height / size.height);
  const width = size.width * scale;
  const height = size.height * scale;
  return {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
  };
}

/** The part of a picture of `size` that fills a frame without distorting it. */
export function fillCrop(size: Size, frame: Size, anchor: CropAnchor = 'center'): Crop {
  const ratio = aspect(frame) / aspect(size);
  if (Math.abs(ratio - 1) < 1e-6) return wholeCrop;
  if (ratio < 1) {
    const x = anchor === 'left' ? 0 : anchor === 'right' ? 1 - ratio : (1 - ratio) / 2;
    return { x, y: 0, width: ratio, height: 1 };
  }
  const height = 1 / ratio;
  const y = anchor === 'top' ? 0 : anchor === 'bottom' ? 1 - height : (1 - height) / 2;
  return { x: 0, y, width: 1, height };
}

/** Points to two decimals and fractions to six keep a plan small and its numbers exact. */
export const roundLength = (value: number) => Math.round(value * 100) / 100;
export const roundRect = (rect: Rect): Rect => ({
  x: roundLength(rect.x),
  y: roundLength(rect.y),
  width: roundLength(rect.width),
  height: roundLength(rect.height),
});
export function roundCrop(crop: Crop): Crop {
  const fraction = (value: number) => Math.min(1, Math.max(0, Math.round(value * 1e6) / 1e6));
  const x = fraction(crop.x);
  const y = fraction(crop.y);
  return {
    x,
    y,
    width: Math.max(1e-6, Math.min(1 - x, fraction(crop.width))),
    height: Math.max(1e-6, Math.min(1 - y, fraction(crop.height))),
  };
}
