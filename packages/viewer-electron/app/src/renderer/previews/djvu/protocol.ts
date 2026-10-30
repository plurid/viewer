/** Messages between the DjVu preview and its decoding worker. */
export type DjVuRequest =
  | { kind: 'open'; id: number; url: string }
  | { kind: 'size'; id: number; page: number }
  | { kind: 'render'; id: number; page: number; dpi: number }
  | { kind: 'text'; id: number; page: number };
export type DjVuReply =
  | { kind: 'opened'; id: number; pages: number }
  | { kind: 'size'; id: number; width: number; height: number }
  | { kind: 'rendered'; id: number; width: number; height: number; pixels: Uint8ClampedArray }
  | { kind: 'text'; id: number; text: string }
  | { kind: 'error'; id: number; message: string };
/** The largest file and rendering the worker accepts. */
export const djvuLimits = { bytes: 256_000_000, pixels: 40_000_000 };
/** CSS pixels are 96 per inch, so a page's size at 100% is its size at 96 dpi. */
export const cssDPI = 96;
