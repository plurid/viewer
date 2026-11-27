import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('uses the canvas saved-file label in qualification and both recordings', () => {
  const label = />(?:\s*)(Open Saved File)(?:\s*)<\/button>/.exec(
    readFileSync('src/renderer/canvases/CanvasPlane.tsx', 'utf8'),
  )?.[1];
  expect(label).toBe('Open Saved File');
  for (const [file, count] of [
    ['qualify', 1],
    ['record', 2],
  ] as const) {
    const source = readFileSync('tools/mounting/' + file + '.ts', 'utf8');
    expect(source.split("'" + label + "'").length - 1).toBe(count);
  }
});
