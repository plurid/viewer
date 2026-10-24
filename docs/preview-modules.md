# Adding a preview module

Built-in previews live in `packages/viewer-electron/app/src/renderer/previews`. The registry selects the highest `detect()` score, then loads that module on demand. Registration is an in-repository code extension; installing third-party plugins is outside the current scope.

1. Add a component under `modules/` with the `PreviewContext` contract.
2. Add its metadata and lazy `load()` to `previewModules` in `registry.ts`, or call `registerPreview()` during renderer initialization.
3. Cover detection and malformed inputs; verify the viewer with a synthetic file through the packaged app.

```tsx
// modules/ExamplePreview.tsx
import { useEffect, useState } from 'react';
import type { PreviewContext } from '../contracts';

export default function ExamplePreview({ resource, services, signal }: PreviewContext) {
  const [text, setText] = useState('Loading…');
  useEffect(() => {
    let mounted = true;
    void services.read(resource.id).then(
      result => {
        if (!mounted || signal.aborted) return;
        setText(result.binary ? 'This file requires a binary decoder.' : result.text);
      },
      error => {
        if (mounted && !signal.aborted) setText(error.message);
      },
    );
    return () => { mounted = false; };
  }, [resource.id, services, signal]);
  return <pre>{text}</pre>;
}

// registry.ts: add this entry before the fallback
{
  id: 'example',
  label: 'Example document',
  formats: ['example'],
  detect: entry => entry.extension === 'example' ? 100 : 0,
  load: () => import('./modules/ExamplePreview'),
}
```

`PreviewContext` contains file metadata and a resource URL, an abort signal, active/interactive flags, the current look, fixed read/archive/document/thumbnail interfaces, and an optional renderer command capability. A preview embedded in a folder plane (Gallery, Columns) gets that plane's active and interactive flags, as a preview plane does. `PreviewModule` also declares optional `metadata()` and `thumbnail()` hooks, but the host does not call them yet; grid thumbnails come from the desktop thumbnail service, and `formats` is descriptive only. Explorer, filesystem and Plurid state stay outside a preview module.

Use `usePreviewState(context, key, initial)` for lightweight viewer state that should survive spatial culling, such as zoom, the current page or worksheet. Workspace-owned planes persist bounded JSON values in private state; temporary previews use a bounded session cache. Source-version changes reset viewer state while preserving notes. Do not retain a decoded model, GPU renderer or original image buffer there. Modules still release resources and stop media/animation on inactive/unmount paths. EPUB's local parser returns evidence and bounded chapter markup; the reader sanitizes markup before rendering it and never evaluates document scripts. DOCX/XLSX use shared worker extraction and the table/evidence adapter; see [Office previews](office-previews.md).

## Built-in formats Chromium cannot decode

- **Rendered images** (`rendered-image`) cover TIFF, HEIC/HEIF, PSD, camera RAW (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2), JPEG 2000, OpenEXR, TGA and ICNS. Quick Look decodes the file in its own sandboxed system service. Viewer receives a bitmap of at most 4,096 pixels on the longest edge, holds it in memory as a child of the preview's resource, and frees it when the preview closes. Grid view thumbnails for these formats come from the same service.
- **DjVu** (`djvu`) decodes with the MIT-licensed `djvu-rs` (Rust compiled to WebAssembly) in a worker inside the sandboxed renderer. Files over 256 MB and renders over 40 million pixels are refused. The render resolution follows the plane's size with the same limits as PDF pages, and search reads each page's text layer. Closing the preview terminates the worker.
- **PDF** adds a page-thumbnail sidebar, which renders only visible pages, and an outline sidebar. Outline entries that only link to web addresses never open. Password-protected PDFs ask for the password, which stays in memory and is never saved with preview state. Print opens PDFKit's native print sheet for PDFs stored as files; documents whose permissions forbid printing are refused.

## Text: languages and editing

`domain/editing/languages.ts` is the one table of text languages (2026-10-23): the extensions and file names each is chosen for (`Dockerfile`, `Makefile`, `.zshrc`) and its Prism grammar. The text module's detection, its highlighting and the editor all read it. It holds no Prism, so the startup bundle can read it to choose a preview. `previews/languages.ts` loads a grammar on first use, through literal `import()` loaders so each is its own chunk, after the grammars it requires in the order `prismjs/components.json` declares (a test checks them against it). A Markdown document's fenced code is highlighted in the language its fence names.

A workspace preview plane passes `editing: { paneID }` in its `PreviewContext`; Quick Preview and folder galleries pass none. With it, the text module offers **Edit** (⌘E) and shows `editing/FileEditor.tsx`, which asks the desktop whether the file can be edited where it is (`textOpen`) and shows why not when it cannot, with **Allow folder access…** when only its folder is missing. The CodeMirror editor (`previews/editor/TextEditor.tsx`) loads only when a plane edits text, with its language from `previews/editor/languages.ts` (one entry per table id; `null` edits as plain text). It emits Prism's token classes, so reading and editing share one palette in both looks. A preview plane follows its file (2026-10-23): `PreviewHost` watches the file's folder and, when the file's version changes (another app saved it), tells the plane's registered `changedOnDisk`, or opens a fresh resource for a module that registers none. The text module reads the file again in place, keeping its scroll; the editor shows the new version when nothing is unsaved, asks with its changed-on-disk bar when something is, and recognizes its own saves by their version. A plane that edits registers with `editing/planes.ts`, which routes the Edit menu's Undo, Redo and Select All to its editor and offers its Save, Save As, Revert and Done to the window's commands.

## Contextual controls and commands

Use `PreviewToolbar` for primary controls. It places them in the plane's header when the host supplies a slot, or inline for a quick preview or gallery. Keep document-specific controls such as a timeline or data filter in the content. Register secondary or searchable actions with `usePreviewCommands`:

```tsx
import { useMemo, useState } from 'react';
import { PreviewToolbar, usePreviewCommands } from '../controls';

// Inside the module component, with its PreviewContext named context:
const [wrap, setWrap] = useState(false);
usePreviewCommands(
  context,
  useMemo(
    () => [
      {
        id: 'example-wrap',
        label: wrap ? 'Disable line wrap' : 'Enable line wrap',
        aliases: ['wrap', 'lw'],
        primary: true,
        available: true,
        run: () => setWrap((value) => !value),
      },
    ],
    [wrap],
  ),
);

return (
  <>
    <PreviewToolbar context={context}>
      <button aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>
        Wrap lines
      </button>
    </PreviewToolbar>
    <pre style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>{text}</pre>
  </>
);
```

Use stable module-local IDs and memoize definitions on the state their labels, availability and handlers depend on. The host supplies preview scope, resource/pane lifetime checks, ID namespacing and registry cleanup. `register()` returns a disposer; the hook releases commands on replacement or unmount. Set `available: false` while an action cannot run. Commands appear only for the active preview; recent IDs cannot carry a previous resource target. The optional capability keeps modules usable outside a spatial plane without engine or explorer imports.

Use `services.read()` for bounded UTF-8 data. Use `fetch(resource.url, { signal })` or the resource URL directly for binary files, PDF or media. Range requests support seeking. Model companions resolve relative to the resource URL inside its granted local directory. Archive entries receive child grants and use the same registry.

Treat resource IDs as revocable capabilities. The host aborts and unmounts an affected module when folder access stops or a volume is ejected; do not retain decoded bytes outside the component. Root cleanup preserves independent previews and accounts for canonical aliases, archive children and loaded companion assets. Resources are bounded at 256 open handles and 256 recorded companion paths per primary resource; in-flight preview/thumbnail requests are bounded at 512. Thumbnail data remains bounded at 128 entries / 16 MB. A new module must handle expiration as an unavailable preview rather than retrying an old ID indefinitely.

The host owns the top-level grant and releases it when closed. Release child grants a module creates. Abort in-flight work, remove observers/listeners, dispose workers, textures, geometry and graphics contexts, and stop media/animation when inactive. `interactive: false` yields gestures to the spatial engine. Virtualize large datasets and expose bounded-read and unsupported-feature messages clearly.

Image pixels have a configurable soft limit; the separate file-byte limit is 64,000,000 bytes. A file above that byte limit has an explicit unavailable state and can still be opened in another app. A high-pixel image within the byte limit requests a bounded thumbnail, with loading and unavailable states when that request cannot produce an image. Never render an empty `src` while claiming a bounded preview is visible. Text reads disclose their 4 MiB bound; DXF has a 32 MiB limit, CAD conversion has a 64 MiB limit, and ordinary model loading also uses the configured file limit. `tests/adverse-previews.ts` qualifies these transitions against the packaged app.

Do not import Electron, Node, explorer or engine state into a viewer; the store's `report` and `getState().bootstrap.platform` are the only exceptions. Do not execute document HTML, scripts, macros or embedded URLs. A format needing conversion should introduce a narrow, validated desktop service and a worker boundary rather than expanding renderer privileges.

DXF is a worker-based example: `dxf/geometry.ts` owns parsing/normalization, `dxf/math.ts` and `units.ts` expose geometry and measurement contracts without the parser, `dxf/canvas.ts` owns dirty rendering and projected input, and `modules/DXFPreview.tsx` owns controls/readouts. See [drawing support](drawings.md) and the [format priorities](preview-roadmap.md).
