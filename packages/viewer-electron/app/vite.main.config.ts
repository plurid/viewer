import { canvasLibraries } from './tools/canvas-libraries.ts';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [canvasLibraries()],
  build: { sourcemap: true, rollupOptions: { external: ['electron'] } },
});
