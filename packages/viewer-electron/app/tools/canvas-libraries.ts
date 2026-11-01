import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { ownRendererLookup } from './three-renderer.ts';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { fileURLToPath } from 'node:url';

/** Bundle the installed renderer's browser modules as offline canvas assets. */
export function canvasLibraries(): Plugin {
  const id = 'virtual:viewer-canvas-libraries';
  const root = path.dirname(path.dirname(createRequire(import.meta.url).resolve('three')));
  return {
    name: 'viewer-canvas-libraries',
    resolveId(source) {
      if (source === id) return '\0' + id;
    },
    async load(source) {
      if (source !== '\0' + id) return;
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
        files.map(async ([name, relative]) => {
          const file = path.join(root, relative!);
          this.addWatchFile(file);
          const text = await readFile(file, 'utf8');
          return [name, name === 'three.module.js' ? ownRendererLookup(text) : text];
        }),
      );
      const robotics = fileURLToPath(
        new URL('../src/domain/robotics/kinematics.ts', import.meta.url),
      );
      this.addWatchFile(robotics);
      const compiled = transpileModule(await readFile(robotics, 'utf8'), {
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
      });
      parts.push(['robotics.js', compiled.outputText]);
      return `export const canvasLibraries = new Map(${JSON.stringify(parts)});`;
    },
  };
}
