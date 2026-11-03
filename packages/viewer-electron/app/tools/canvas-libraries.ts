import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { ownRendererLookup } from './three-renderer.ts';

/** The same offline graphics modules serve packaged Viewer and standalone tool exports. */
export async function loadCanvasLibraries(addWatchFile: (file: string) => void = () => {}) {
  const root = path.dirname(path.dirname(createRequire(import.meta.url).resolve('three')));
  const files = [
    ['three.module.js', 'build/three.module.js'],
    ['three.core.js', 'build/three.core.js'],
    ...[
      'controls/OrbitControls.js',
      'loaders/GLTFLoader.js',
      'loaders/STLLoader.js',
      'utils/BufferGeometryUtils.js',
      'utils/SkeletonUtils.js',
    ].map((name) => ['addons/' + name, 'examples/jsm/' + name]),
  ];
  const parts = await Promise.all(
    files.map(async ([name, relative]): Promise<[string, string]> => {
      const file = path.join(root, relative!);
      addWatchFile(file);
      const text = await readFile(file, 'utf8');
      return [name!, name === 'three.module.js' ? ownRendererLookup(text) : text];
    }),
  );
  return new Map(parts);
}

/** Bundle the installed renderer's browser modules as offline canvas assets. */
export function canvasLibraries(): Plugin {
  const id = 'virtual:viewer-canvas-libraries';
  return {
    name: 'viewer-canvas-libraries',
    resolveId(source) {
      if (source === id) return '\0' + id;
    },
    async load(source) {
      if (source !== '\0' + id) return;
      const libraries = await loadCanvasLibraries((file) => this.addWatchFile(file));
      return `export const canvasLibraries = new Map(${JSON.stringify([...libraries])});`;
    },
  };
}
