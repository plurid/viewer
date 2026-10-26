import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ownRendererLookup } from '../tools/three-renderer';

it('gives each WebGL renderer its own uploaded lookup and releases it on disposal', () => {
  const source = `class WebGLRenderer {
    constructor( parameters = {} ) {
      this.uniform = () => {
        const m_uniforms = { dfgLUT: { value: null } };
        m_uniforms.dfgLUT.value = getDFGLUT();
        return m_uniforms.dfgLUT.value;
      };
      this.dispose = function () {};
    }
  }`;
  const clones: { dispose(): void; disposed: boolean }[] = [];
  const shared = {
    clone() {
      const value = {
        disposed: false,
        dispose() {
          this.disposed = true;
        },
      };
      clones.push(value);
      return value;
    },
  };
  const Renderer = new Function('getDFGLUT', ownRendererLookup(source) + '\nreturn WebGLRenderer;')(
    () => shared,
  );
  const first = new Renderer();
  const second = new Renderer();
  expect(first.uniform()).toBe(first.uniform());
  expect(second.uniform()).not.toBe(first.uniform());
  first.dispose();
  expect(clones.map((value) => value.disposed)).toEqual([true, false]);
  expect(second.uniform()).toBe(clones[1]);
  second.dispose();
  expect(clones.every((value) => value.disposed)).toBe(true);
});

it('accepts the installed renderer and refuses drift instead of silently skipping the fix', async () => {
  const require = createRequire(import.meta.url);
  const file = path.join(path.dirname(require.resolve('three')), 'three.module.js');
  const source = await readFile(file, 'utf8');
  expect(ownRendererLookup(source)).not.toBe(source);
  expect(() => ownRendererLookup(source.replace('getDFGLUT();', 'getSomethingElse();'))).toThrow(
    'Review the Three.js',
  );
});
