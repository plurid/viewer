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
      for (const module of ['kinematics', 'solver', 'replay']) {
        const file = fileURLToPath(new URL(`../src/domain/robotics/${module}.ts`, import.meta.url));
        this.addWatchFile(file);
        const compiled = transpileModule(await readFile(file, 'utf8'), {
          compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
        });
        parts.push([module + '.js', compiled.outputText]);
      }
      parts.push([
        'robotics.js',
        "export * from './kinematics.js'; export * from './solver.js'; export * from './replay.js';",
      ]);
      return `export const canvasLibraries = new Map(${JSON.stringify(parts)});`;
    },
  };
}
