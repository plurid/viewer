import { defineConfig } from 'vite';
import { pdfAssets } from './tools/pdf-assets';
import { threeRendererOwnership } from './tools/three-renderer.ts';
export default defineConfig({
  base: './',
  plugins: [pdfAssets(), threeRendererOwnership()],
  optimizeDeps: { exclude: ['three'] },
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'styled-components',
      'react-redux',
      '@plurid/plurid-data',
      '@plurid/plurid-themes',
      // one CodeMirror: a second copy of its state or view breaks every extension (2026-10-23)
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@lezer/highlight',
    ],
  },
  build: { target: 'chrome148', sourcemap: true },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', watch: { ignored: ['**/.vite/**', '**/out/**'] } },
});
