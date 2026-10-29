import type { ComponentType } from 'react';
import type { FileEntry } from '../../domain/contracts';
import type { PreviewContext, PreviewModule } from './contracts';
import { choosePreview, previewModules } from './registry';
import { officeFamily, readsOfficeContent } from '../../domain/previews/documents/layout';

type PreviewComponent = ComponentType<PreviewContext>;

const loaded = new Map<string, PreviewComponent>();
const loading = new Map<string, Promise<PreviewComponent>>();

/**
 * A module whose code has arrived renders at once. A lazy module suspends on its first use, and
 * React then holds the content back until 300 ms after the fallback appeared: every format's
 * first preview paid that.
 */
export function loadedPreviewModule(module: PreviewModule): PreviewComponent | undefined {
  return loaded.get(module.id);
}

/** Starts loading a module's code, once; a failed load can be tried again. */
export function preloadPreviewModule(module: PreviewModule): Promise<PreviewComponent> {
  const ready = loaded.get(module.id);
  if (ready) return Promise.resolve(ready);
  let pending = loading.get(module.id);
  if (!pending) {
    pending = module.load().then((value) => {
      loaded.set(module.id, value.default);
      return value.default;
    });
    loading.set(module.id, pending);
    pending.catch(() => loading.delete(module.id));
  }
  return pending;
}

/** The selected file's module, so Space or a Columns preview opens without waiting for code. */
export function preloadPreviewFor(entry: FileEntry | undefined): void {
  if (!entry || entry.directory) return;
  const module = choosePreview(entry);
  void preloadPreviewModule(module).catch(() => {});
  // A document opens in its page layout, which waits seconds for the Office engine to load: it
  // starts as soon as such a file is selected. A spreadsheet Viewer reads opens in Sheet view.
  const sheet = officeFamily(entry.extension) === 'workbook' && readsOfficeContent(entry.extension);
  if (module.id === 'office' && !sheet) void window.viewer.officeWarm?.().catch(() => {});
}

/** Three.js and the CAD engine are large; they load when a model is first chosen. */
const heavy = new Set(['model']);

let preloading = false;
/** Every everyday module, one at a time while the window is idle after its first rows. */
export function preloadPreviewModulesWhenIdle(): void {
  // only a browser window has idle time to give; a test document has none
  if (preloading || typeof requestIdleCallback !== 'function') return;
  preloading = true;
  const queue = previewModules.filter((module) => !heavy.has(module.id));
  const next = () => {
    const module = queue.shift();
    if (!module) return;
    void preloadPreviewModule(module)
      .catch(() => {})
      .finally(() => requestIdleCallback(next, { timeout: 2000 }));
  };
  requestIdleCallback(next, { timeout: 2000 });
}
