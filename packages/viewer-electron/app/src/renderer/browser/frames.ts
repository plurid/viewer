type Frame = { frame?: VideoFrame; pixels?: Uint8Array; width?: number; height?: number };
const targets = new Map<string, (frame: Frame) => void>();
// Installed for the lifetime of the renderer. A late frame is closed even after
// its plane unmounts, avoiding leaked native texture references during culling.
window.addEventListener('message', (event) => {
  const value = event.data as Frame & { type?: string; id?: string };
  if (
    event.source !== window ||
    value?.type !== 'viewer-browser-frame' ||
    typeof value.id !== 'string'
  )
    return;
  try {
    targets.get(value.id)?.(value);
  } finally {
    value.frame?.close();
  }
});
export function browserFrames(id: string, canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext('2d', { alpha: false })!;
  const draw = (value: Frame) => {
    canvas.dataset.frames = String(Number(canvas.dataset.frames || 0) + 1);
    if (value.frame) {
      if (canvas.width !== value.frame.displayWidth) canvas.width = value.frame.displayWidth;
      if (canvas.height !== value.frame.displayHeight) canvas.height = value.frame.displayHeight;
      context.drawImage(value.frame, 0, 0);
    } else if (
      value.pixels &&
      value.width &&
      value.height &&
      value.width * value.height <= 16_777_216 &&
      value.pixels.length === value.width * value.height * 4
    ) {
      const rgba = new Uint8ClampedArray(value.pixels.length);
      for (let index = 0; index < rgba.length; index += 4) {
        rgba[index] = value.pixels[index + 2]!;
        rgba[index + 1] = value.pixels[index + 1]!;
        rgba[index + 2] = value.pixels[index]!;
        rgba[index + 3] = value.pixels[index + 3]!;
      }
      if (canvas.width !== value.width) canvas.width = value.width;
      if (canvas.height !== value.height) canvas.height = value.height;
      context.putImageData(new ImageData(rgba, value.width, value.height), 0, 0);
    }
  };
  targets.set(id, draw);
  return () => {
    if (targets.get(id) === draw) targets.delete(id);
  };
}
