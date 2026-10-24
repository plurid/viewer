interface DifferenceInput {
  left: ImageBitmap | null;
  right: ImageBitmap | null;
  width: number;
  height: number;
  maxPixels: number;
}

self.onmessage = (event: MessageEvent<DifferenceInput>) => {
  const { left, right, width, height, maxPixels } = event.data;
  try {
    if (width < 1 || height < 1 || width * height * 3 > maxPixels)
      throw new Error('The image pair exceeds the decoded comparison budget.');
    const first = new OffscreenCanvas(width, height);
    const second = new OffscreenCanvas(width, height);
    const a = first.getContext('2d');
    const b = second.getContext('2d');
    if (!a || !b) throw new Error('Pixel comparison is unavailable.');
    if (left) a.drawImage(left, 0, 0);
    if (right) b.drawImage(right, 0, 0);
    const source = a.getImageData(0, 0, width, height);
    const target = b.getImageData(0, 0, width, height);
    for (let index = 0; index < source.data.length; index += 4) {
      const alphaA = source.data[index + 3]!;
      const alphaB = target.data[index + 3]!;
      const alphaDifference = Math.abs(alphaA - alphaB);
      for (let channel = 0; channel < 3; channel++) {
        source.data[index + channel] = Math.max(
          Math.abs(
            (source.data[index + channel]! * alphaA) / 255 -
              (target.data[index + channel]! * alphaB) / 255,
          ),
          alphaDifference,
        );
      }
      source.data[index + 3] = 255;
    }
    a.putImageData(source, 0, 0);
    const bitmap = first.transferToImageBitmap();
    self.postMessage({ bitmap }, { transfer: [bitmap] });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  } finally {
    left?.close();
    right?.close();
  }
};

export {};
