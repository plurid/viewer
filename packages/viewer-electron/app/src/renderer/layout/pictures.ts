/**
 * Pictures for the preview: photo thumbnails from the desktop, PDF pages drawn by pdf.js. Each is
 * read once, when an item showing it is drawn, a few at a time; large pictures are kept for the
 * most recent few dozen only.
 */
import { useSyncExternalStore } from 'react';
import type { LayoutDocument } from './pdf';
import { smallThumbnail } from './measure';

export type PictureSize = 'small' | 'large';
const largeThumbnail = 512;
const pageLongest: Record<PictureSize, number> = { small: 200, large: 900 };
const kept: Record<PictureSize, number> = { small: 600, large: 48 };

export class LayoutPictures {
  private pictures: Record<PictureSize, Map<string, string>> = {
    small: new Map(),
    large: new Map(),
  };
  private pending = new Set<string>();
  private queue: (() => Promise<void>)[] = [];
  private running = 0;
  private listeners = new Set<() => void>();
  private closed = false;
  constructor(
    private documents: ReadonlyMap<string, LayoutDocument>,
    thumbnails: ReadonlyMap<string, string>,
  ) {
    for (const [path, url] of thumbnails) this.pictures.small.set(key(path), url);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  /** The picture, when it has been read; asking starts reading it. A large picture not yet read
   * is stood in for by the small one. */
  get(path: string, page: number | undefined, size: PictureSize): string | undefined {
    const name = key(path, page);
    const found = this.pictures[size].get(name);
    if (found !== undefined) {
      // most recently used last
      this.pictures[size].delete(name);
      this.pictures[size].set(name, found);
      return found || undefined;
    }
    this.request(path, page, size);
    return size === 'large' ? this.get(path, page, 'small') : undefined;
  }
  close() {
    this.closed = true;
    this.queue = [];
    this.listeners.clear();
  }
  private request(path: string, page: number | undefined, size: PictureSize) {
    const name = size + ':' + key(path, page);
    if (this.pending.has(name) || this.closed) return;
    this.pending.add(name);
    this.queue.push(async () => {
      let url = '';
      try {
        const document = this.documents.get(path);
        url = document
          ? await document.picture(page ?? 1, pageLongest[size])
          : await window.viewer.thumbnail(path, size === 'small' ? smallThumbnail : largeThumbnail);
      } catch {
        // a picture that cannot be read leaves its frame's placeholder
      }
      this.pending.delete(name);
      if (this.closed) return;
      const pictures = this.pictures[size];
      pictures.set(key(path, page), url);
      for (const old of pictures.keys()) {
        if (pictures.size <= kept[size]) break;
        pictures.delete(old);
      }
      for (const listener of this.listeners) listener();
    });
    this.drain();
  }
  private drain() {
    while (this.running < 3 && this.queue.length) {
      const work = this.queue.shift()!;
      this.running++;
      void work().finally(() => {
        this.running--;
        this.drain();
      });
    }
  }
}
const key = (path: string, page?: number) => (page ? `${path}#${page}` : path);

/** A picture for one item, redrawn when it arrives. */
export function usePicture(
  pictures: LayoutPictures,
  path: string,
  page: number | undefined,
  size: PictureSize,
): string | undefined {
  return useSyncExternalStore(pictures.subscribe, () => pictures.get(path, page, size));
}
