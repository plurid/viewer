import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

/** Build an explicitly attached plugin asset, never an application runtime library. */
export async function buildRoboticsPlugin() {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      emptyOutDir: false,
      minify: false,
      lib: { entry: fileURLToPath(new URL('./library.ts', import.meta.url)), formats: ['es'] },
    },
  });
  assert.ok(!('on' in result));
  const output = Array.isArray(result) ? result.flatMap((part) => part.output) : result.output;
  const chunks = output.filter((part) => part.type === 'chunk');
  assert.equal(chunks.length, 1, 'The plugin library must be one self-contained module.');
  const library = chunks[0]!;
  assert.equal(library.imports.length, 0, 'All domain dependencies belong to the plugin asset.');
  assert.equal(library.dynamicImports.length, 0);
  const markup = await readFile(new URL('./workbench.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('./workbench.js', import.meta.url), 'utf8');
  const html = markup + '<script type="module">\n' + script + '\n</script>';
  assert.doesNotMatch(html, /viewer\/robotics|requestRobotCheck|requestPlacementCheck|data\.robot/);
  return { html, library: library.code, modules: Object.keys(library.modules) };
}
