export type PDFZoom = 'page' | 'width' | number;

interface Size {
  width: number;
  height: number;
}

export function pdfZoom(value: unknown): PDFZoom {
  return value === 'page' ||
    value === 'width' ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 4)
    ? value
    : 'page';
}

/** Page dimensions are measured at 100% in CSS pixels, including PDF rotation. */
export function pdfScale(page: Size, available: Size, zoom: PDFZoom): number {
  if (page.width <= 0 || page.height <= 0 || available.width <= 0 || available.height <= 0)
    return 0;
  if (typeof zoom === 'number') return zoom;
  const width = available.width / page.width;
  return zoom === 'width' ? width : Math.min(width, available.height / page.height);
}
