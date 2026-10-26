/** Application documents and assets keep JavaScript evaluation disabled. */
export function applicationCSP(pathname: string, development = false): string {
  // OCCT's Embind bindings generate functions. Give only this isolated worker
  // that permission; it has no DOM/Node bridge and may fetch only its own WASM.
  if (
    /^\/assets\/cad\.worker-[A-Za-z0-9_-]+\.js$/.test(pathname) ||
    (development && pathname === '/src/renderer/previews/model/cad.worker.ts')
  )
    return "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'";
  // ImageBitmapLoader fetches embedded glTF images through owned blob/data URLs.
  // These grant no filesystem or network authority and do not enable script evaluation.
  const connections = ["'self'", 'viewer-resource:', 'blob:', 'data:'];
  if (development)
    connections.push(
      'ws://127.0.0.1:*',
      'http://127.0.0.1:*',
      'ws://localhost:*',
      'http://localhost:*',
    );
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' viewer-resource: blob: data:",
    "media-src 'self' viewer-resource: blob:",
    `connect-src ${connections.join(' ')}`,
    "worker-src 'self' blob:",
    "font-src 'self' blob: data:",
    "object-src 'none'",
    'frame-src viewer-html:',
    "base-uri 'none'",
  ].join('; ');
}
