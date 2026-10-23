/**
 * NO NATIVE DROPDOWNS (2026-10-23): every choice in the renderer uses the searchable choice menu
 * (ui/ChoiceMenu.tsx), the context menu's keyboard-first search, in place of a native `<select>`.
 */
import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('renders no native select anywhere in the renderer', async () => {
  const sources = (await readdir('src/renderer', { recursive: true })).filter((file) =>
    /\.tsx?$/.test(file),
  );
  expect(sources.length).toBeGreaterThan(0);
  const selecting = [];
  for (const file of sources)
    if ((await readFile(`src/renderer/${file}`, 'utf8')).includes('<select')) selecting.push(file);
  expect(selecting).toEqual([]);
});
