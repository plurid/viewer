// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { reviewSheet } from '../tools/review/report';
import { reviewSheetScript } from '../tools/review/sheet-script';
import type { Finding, RunResults } from '../tools/review/types';
import { across } from '../tools/review/variants';

describe('review sheet', () => {
  const variants = across('name', ['short']).slice(0, 2);
  const capture = (index: number) => ({
    variant: variants[index]!,
    image: 'list-view/' + variants[index]!.id + '.png',
    viewport: { width: 800, height: 560 },
    milliseconds: 1,
    commands: [],
    dialogs: [],
    findings: ['jpg', 'pdf'].map((extension): Finding => ({
      check: 'name-extension',
      selector: 'div.file-row' + (extension === 'pdf' ? '.is-selected' : '') + ' > span.filename',
      text: 'A long name.' + extension,
      detail: 'The name is cut at its end, so .' + extension + ' does not show.',
      box: { x: 1, y: 1, width: 10, height: 10 },
    })),
  });
  const results: RunResults = {
    version: 1,
    run: 'test',
    binary: 'packages/viewer-electron/app/out/Viewer.app',
    parallel: 3,
    commandSource: 'source',
    started: '',
    milliseconds: 1,
    samples: '',
    areas: [{ id: 'main-window', title: 'Main window' }],
    scenes: [
      {
        id: 'list-view',
        area: 'main-window',
        title: 'List view',
        mustBeTrue: ['Names keep their extension.'],
        covers: {},
        captures: [capture(0), capture(1)],
      },
    ],
    coverage: { commands: [], dialogs: [], settings: [], previews: [] },
  };

  it('groups a problem across rows and variants, and marks lines by hand', async () => {
    const page = new DOMParser().parseFromString(await reviewSheet(results, false), 'text/html');
    // the sheet's own script, run on its markup; jsdom does not run parsed scripts
    document.body.replaceChildren(...page.body.childNodes);
    reviewSheetScript();
    const problems = [...document.querySelectorAll('.problem-head')].map(
      (line) => line.textContent,
    );
    expect(problems).toEqual([
      'Name loses its extensionThe name is cut at its end, so their extensions do not show.' +
        '2 file namesall 2',
    ]);
    expect(document.querySelector('.summary tbody')!.textContent).toContain('Main window1');
    const mark = document.querySelector<HTMLButtonElement>('button.mark')!;
    mark.click();
    mark.click();
    expect(mark.textContent).toBe('Fail');
    expect(document.querySelectorAll('.captures figure')).toHaveLength(2);
  });
});
