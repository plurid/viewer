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

`PreviewContext` contains file metadata and a resource URL, an abort signal, active/interactive flags, the current look, and a fixed read/archive interface. Optional `metadata()` and `thumbnail()` hooks share that contract. Explorer, filesystem and Plurid state stay outside a preview module.

Use `services.read()` for bounded UTF-8 data. Use `fetch(resource.url, { signal })` or the resource URL directly for binary files, PDF or media. Range requests support seeking. Model companions resolve relative to the resource URL inside its granted local directory. Archive entries receive child grants and use the same registry.

The host owns the top-level grant and releases it when closed. Release child grants a module creates. Abort in-flight work, remove observers/listeners, dispose workers, textures, geometry and graphics contexts, and stop media/animation when inactive. `interactive: false` yields gestures to the spatial engine. Virtualize large datasets and expose bounded-read and unsupported-feature messages clearly.

Do not import Electron, Node, explorer state or engine state into a viewer. Do not execute document HTML, scripts, macros or embedded URLs. A format needing conversion should introduce a narrow, validated desktop service and a worker boundary rather than expanding renderer privileges.
