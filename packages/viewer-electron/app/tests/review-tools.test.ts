import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyAllowances } from '../tools/review/allowlist';
import type { Allowance } from '../tools/review/allowlist';
import { coverage, readCatalog } from '../tools/review/coverage';
import { comparePictures, decodePNG, encodePNG } from '../tools/review/png';
import type { Picture } from '../tools/review/png';
import { reviewSheet } from '../tools/review/report';
import { deepFolder, longName } from '../tools/review/samples';
import { reviewAreas } from '../tools/review/scenes';
import type { Finding, RunResults, SceneResult } from '../tools/review/types';
import { across, standardVariants } from '../tools/review/variants';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const emDash = String.fromCharCode(0x2014);

function picture(width: number, height: number, fill: number): Picture {
  const pixels = new Uint8Array(width * height * 4).fill(fill);
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
  return { width, height, pixels };
}

describe('review captures', () => {
  it('reads back the PNG it writes and counts changed pixels', () => {
    const before = picture(7, 5, 40);
    const after = picture(7, 5, 40);
    after.pixels.set([250, 250, 250], 4 * 9);
    const decoded = decodePNG(encodePNG(after));
    expect(decoded).toEqual(after);
    const difference = comparePictures(before, after);
    expect(difference.changed).toBeCloseTo(1 / 35);
    expect([...difference.picture.pixels.subarray(4 * 9, 4 * 9 + 3)]).toEqual([255, 40, 40]);
  });

  it('ignores antialiasing noise and refuses pictures of different sizes', () => {
    const before = picture(4, 4, 100);
    const after = picture(4, 4, 110);
    expect(comparePictures(before, after).changed).toBe(0);
    expect(() => comparePictures(before, picture(5, 4, 100))).toThrow(/different sizes/);
  });
});

describe('review samples and scenes', () => {
  it('names a long file with exactly 180 characters and keeps its extension', () => {
    for (const extension of ['jpg', 'pdf', 'txt', 'mp4']) {
      const name = longName(extension);
      expect(name).toHaveLength(180);
      expect(name.endsWith('.' + extension)).toBe(true);
    }
  });

  it('keeps the deepest long path inside the system path limit', () => {
    // a macOS temporary folder, a run folder and the sample home
    const prefix =
      '/private/var/folders/ab/abcdefghijklmnopqrstuvwxyz0000gn/T/viewer-review-abcdef/Home';
    expect(path.join(prefix, deepFolder, longName('jpg')).length).toBeLessThan(1024);
    expect(deepFolder.split('/').length).toBe(21);
  });

  it('gives every scene a unique id, plain must-be-true lines and steps', () => {
    const scenes = reviewAreas.flatMap((area) => area.scenes);
    const ids = scenes.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scene of scenes) {
      expect(scene.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(scene.mustBeTrue.length).toBeGreaterThan(0);
      for (const text of [scene.title, ...scene.mustBeTrue]) expect(text).not.toContain(emDash);
    }
  });

  it('names variants uniquely, with a scene choice in the id', () => {
    const variants = across('name', ['short', 'long']);
    expect(new Set(variants.map((variant) => variant.id)).size).toBe(8);
    expect(variants.map((variant) => variant.id)).toContain('narrow-light-long');
    expect(standardVariants.map((variant) => [variant.width, variant.look])).toEqual([
      [1600, 'dark'],
      [800, 'dark'],
      [800, 'light'],
      [1600, 'light'],
    ]);
  });
});

describe('review findings', () => {
  const finding = (check: Finding['check'], selector: string, text = ''): Finding => ({
    check,
    selector,
    text,
    detail: 'detail',
  });

  it('marks only the findings an allowance names, with its reason', () => {
    const list: Allowance[] = [
      { check: 'wrap', selector: /grid-tile/, scene: /^grid/, reason: 'Finder wraps icon names.' },
    ];
    const marked = applyAllowances(
      [finding('wrap', 'div.grid-tile > span'), finding('clipped', 'div.grid-tile > span')],
      'grid-view',
      'wide-dark',
      list,
    );
    expect(marked.map((item) => item.allowed)).toEqual(['Finder wraps icon names.', undefined]);
    expect(
      applyAllowances([finding('wrap', 'div.grid-tile')], 'list-view', 'wide-dark', list)[0]!
        .allowed,
    ).toBeUndefined();
  });
});

describe('review coverage and sheet', () => {
  it('reads the command registry, dialogs, Settings sections and preview kinds', async () => {
    const catalog = await readCatalog(app);
    expect(catalog.commands.length).toBeGreaterThan(150);
    expect(catalog.commands.map((entry) => entry.id)).toContain('image-tools');
    expect(catalog.dialogs.map((entry) => entry.id)).toContain('ImageToolsDialog');
    expect(catalog.settings.map((entry) => entry.id)).toContain('Browsing');
    expect(catalog.previews.map((entry) => entry.id)).toContain('pdf');
  });

  it('covers a command run from the palette and a dialog open in a capture, in any case', () => {
    const scene: SceneResult = {
      id: 'image-tools',
      area: 'exports',
      title: 'Image tools',
      mustBeTrue: ['Fields fill their row.'],
      covers: {},
      captures: [
        {
          variant: standardVariants[0]!,
          findings: [],
          milliseconds: 1,
          commands: ['Image tools…'],
          dialogs: ['image tools · Forest.jpg'],
        },
      ],
    };
    const result = coverage(
      {
        commands: [{ id: 'image-tools', label: 'Image Tools…', source: '' }],
        dialogs: [{ id: 'ImageToolsDialog', label: 'Image Tools · *', source: '' }],
        settings: [],
        previews: [],
      },
      [scene],
    );
    expect(result.commands[0]!.scenes).toEqual(['image-tools']);
    expect(result.dialogs[0]!.scenes).toEqual(['image-tools']);
  });

  it('writes a sheet whose data cannot end its script element', async () => {
    const results: RunResults = {
      version: 1,
      run: '20261117-120000',
      binary: 'Viewer',
      started: '2026-11-17T12:00:00.000Z',
      milliseconds: 61000,
      samples: 'samples',
      areas: [{ id: 'exports', title: 'Output dialogs' }],
      scenes: [
        {
          id: 'image-tools',
          area: 'exports',
          title: 'Image tools </script><b>',
          mustBeTrue: ['Fields fill their row.'],
          covers: {},
          captures: [],
        },
      ],
      coverage: { commands: [], dialogs: [], settings: [], previews: [] },
    };
    const html = await reviewSheet(results, false);
    expect(html).toContain('Image tools <\\/script><b>');
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).not.toContain(emDash);
  });
});
