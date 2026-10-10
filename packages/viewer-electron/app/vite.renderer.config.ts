import { defineConfig } from 'vite';
import { pdfAssets } from './tools/pdf-assets';
export default defineConfig({
  base: './',
  plugins: [pdfAssets()],
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'styled-components',
      'react-redux',
      '@plurid/plurid-data',
      '@plurid/plurid-themes',
    ],
  },
  build: { target: 'chrome148', sourcemap: true },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', watch: { ignored: ['**/.vite/**', '**/out/**'] } },
});
