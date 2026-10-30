export interface EPUBChapter {
  title: string;
  html: string;
  path?: string;
}
export interface EPUBImage {
  path: string;
  size: number;
  /** A FictionBook's picture, carried as a checked `data:` URL; an EPUB's loads from the book. */
  data?: string;
}
export interface EPUBReference {
  path: string;
  fragment: string;
}
export const epubImageLimit = 8_000_000;
export const epubImagePath = (path: string) => /\.(png|jpe?g|gif|webp)$/i.test(path);

/** Book references resolve only inside the archive, never to a network or filesystem URL. */
export function epubReference(base: string, reference: string): EPUBReference | undefined {
  if (
    reference.length > 4096 ||
    /[\u0000-\u001f\\]/.test(reference) ||
    /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(reference)
  )
    return;
  try {
    const hash = reference.indexOf('#');
    const raw = (hash < 0 ? reference : reference.slice(0, hash)).split('?')[0]!;
    const fragment = hash < 0 ? '' : decodeURIComponent(reference.slice(hash + 1));
    const part = decodeURIComponent(raw);
    if (/[\u0000-\u001f\\]/.test(part) || part.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(part))
      return;
    const segments = raw ? base.split('/').slice(0, -1) : [];
    if (!raw) return { path: base, fragment };
    for (const segment of part.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (!segments.length) return;
        segments.pop();
      } else segments.push(segment);
    }
    return { path: segments.join('/'), fragment };
  } catch {
    return;
  }
}
