import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: { external: ['electron', 'node-pty', 'pdfjs-dist/legacy/build/pdf.mjs'] },
  },
});
