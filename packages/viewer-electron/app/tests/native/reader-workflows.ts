/** Owned search, worksheet and EPUB interactions. Fixtures, profiles and captures are retained. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { Pane, SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { readerBookFixture } from '../fixtures/reader-book';
import { officeFixture } from '../office-fixtures';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-reader-workflows-');
const files = path.join(root, 'Files');
await mkdir(files);
const fixtures = {
  'Book.epub': readerBookFixture(),
  'Worksheet.xlsx': Buffer.from(
    officeFixture('workbook', {
      'xl/worksheets/data.xml':
        '<worksheet><sheetData>' +
        Array.from({ length: 300 }, (_, index) => {
          const row = index + 1;
          return `<row r="${row}"><c r="A${row}"><v>${row}</v></c><c r="B${row}"><f>${row}+1</f><v>${row + 1}</v></c></row>`;
        }).join('') +
        '</sheetData></worksheet>',
    }),
  ),
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
for (const [name, bytes] of Object.entries(fixtures))
  await writeFile(path.join(files, name), bytes, { flag: 'wx' });
const checks: string[] = [];
type Connection = Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>>;

async function run(
  name: string,
  pane: Pane,
  check: (connection: Connection, profile: string) => Promise<void>,
) {
  const profile = path.join(root, name);
  await mkdir(profile);
  const settings = defaultSettings(files),
    ui = normalizePreferences();
  settings.hotkey.enabled = false;
  settings.providers = [];
  settings.search = {
    roots: [files],
    contentRoots: [],
    exclusions: ['node_modules'],
    paused: false,
  };
  ui.sidebar.inNewPlanes = false;
  ui.space.opening = 'dock';
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    look: 'dark',
    activeWorkspace: name,
    favorites: [],
    recents: [],
    ui,
    workspaces: [
      {
        id: name,
        name,
        roots: [pane.id],
        activePane: pane.id,
        arrangement: {},
        panes: [pane],
        layout: {
          placements: [
            {
              id: pane.id,
              location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
              width: 1100,
              height: 760,
              show: true,
            },
          ],
          active: pane.id,
          docked: pane.id,
        },
      },
    ],
  };
  await writeFile(
    path.join(profile, 'config.jsonc'),
    JSON.stringify({ version: 1, settings, ui }),
    { flag: 'wx' },
  );
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), {
    flag: 'wx',
  });
  const app = await ownedApp(binary!, profile);
  let connection: Connection | undefined;
  try {
    connection = await app.connect();
    await check(connection, profile);
  } finally {
    await app.close(connection);
  }
}

function helpers(connection: Connection) {
  const { evaluate, command } = connection;
  return {
    text: () => evaluate<string>('document.body.innerText'),
    click: (selector: string) =>
      evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),
    fill: (selector: string, value: string) =>
      evaluate(
        `(() => { const field = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      ),
    key: async (key: string, code: string, virtual: number, modifiers = 0) => {
      for (const type of ['keyDown', 'keyUp'])
        await command('Input.dispatchKeyEvent', {
          type,
          key,
          code,
          windowsVirtualKeyCode: virtual,
          modifiers,
        });
    },
    capture: async (label: string, width: number, height: number) => {
      await command('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      await evaluate(`document.querySelector('[aria-label="Layout"]').click()`);
      await until(
        () =>
          evaluate<boolean>(
            `Array.from(document.querySelectorAll('[role="menuitem"]')).some(item => item.textContent.trim() === 'Fill workspace')`,
          ),
        Boolean,
        'Plane size action',
      );
      await evaluate(
        `Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent.trim() === 'Fill workspace').click()`,
      );
      await until(
        () =>
          evaluate<{ opacity: number; motion: boolean }>(`(() => {
        let element = document.querySelector('.search-explorer, .data-viewer, .epub-viewer'), opacity = 1;
        while (element) { opacity *= Number(getComputedStyle(element).opacity); element = element.parentElement; }
        const header = document.querySelector('.plane-controls').getBoundingClientRect();
        const footer = document.querySelector('.folder-status, .preview-plane > footer, .preview-status')?.getBoundingClientRect();
        return { opacity, motion: !!document.querySelector('[data-plurid-motion]'), fits: header.left >= 0 && header.right <= innerWidth + 1 && (!footer || footer.bottom <= innerHeight + 1) };
      })()`),
        (state) => state.opacity > 0.999 && !state.motion && 'fits' in state && state.fits === true,
        'Settled capture ' + label,
      );
      const { data } = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(root, label + '.png'), Buffer.from(data, 'base64'), { flag: 'wx' });
      const overflow = await evaluate<number>('document.documentElement.scrollWidth - innerWidth');
      assert.ok(overflow <= 1, label + ' window overflow');
      if (label.startsWith('search-')) {
        const visible = await evaluate<boolean>(`(() => {
          const table = document.querySelector('.file-table').getBoundingClientRect();
          const message = document.querySelector('.empty-state strong').getBoundingClientRect();
          return message.top >= table.top && message.bottom <= table.bottom;
        })()`);
        assert.ok(visible, 'Search empty result stays visible with expanded coverage');
      }
    },
  };
}

let passed = false;
try {
  await run(
    'search',
    {
      id: 'search',
      type: 'search',
      name: 'Coverage',
      path: files,
      query: 'ext:absent',
      allLocations: false,
      recursive: true,
      content: false,
    },
    async (connection) => {
      const ui = helpers(connection);
      await until(
        ui.text,
        (text) => text.includes('Search finished') && text.includes('No matching files'),
        'Complete filename coverage',
      );
      await ui.click('.search-coverage summary');
      assert.match(await ui.text(), /node_modules/);
      await ui.capture('search-wide', 1280, 900);
      await ui.click('.search-content-option input');
      await until(
        ui.text,
        (text) =>
          text.includes('Partial coverage') &&
          text.includes('No matches in the available search data'),
        'Missing content coverage',
      );
      await ui.capture('search-minimum', 760, 540);
      checks.push('Search scope, exclusions, complete empty results and partial content coverage');
    },
  );
  await run(
    'worksheet',
    { id: 'worksheet', type: 'preview', path: path.join(files, 'Worksheet.xlsx') },
    async (connection) => {
      const { evaluate } = connection,
        ui = helpers(connection);
      await until(
        () => evaluate<boolean>('!!document.querySelector("[role=grid]")'),
        Boolean,
        'Worksheet grid',
      );
      await evaluate('document.querySelector("[role=grid]").focus()');
      await ui.key('ArrowRight', 'ArrowRight', 39);
      await until(ui.text, (text) => text.includes('Formula: 1+1'), 'Keyboard formula inspection');
      await ui.fill('[aria-label="Cell address"]', 'B101');
      await evaluate(
        `document.querySelector('[aria-label="Cell address"]').closest('form').requestSubmit()`,
      );
      await until(
        () =>
          evaluate<string>(`document.querySelector('[aria-label="Cell address"]')?.value || ''`),
        (value) => value === 'B101',
        'Address across pages',
      );
      await until(ui.text, (text) => text.includes('Formula: 101+1'), 'Loaded address formula');
      assert.equal(await evaluate('document.activeElement?.getAttribute("role")'), 'grid');
      await ui.key('PageUp', 'PageUp', 33);
      await until(
        () =>
          evaluate<string>(`document.querySelector('[aria-label="Cell address"]')?.value || ''`),
        (value) => value !== 'B101' && !!value,
        'Page up across a boundary',
      );
      await ui.key('PageUp', 'PageUp', 33, 2);
      await until(ui.text, (text) => text.includes('Hidden source'), 'Control Page Up worksheet');
      await ui.key('PageDown', 'PageDown', 34, 2);
      await until(
        () =>
          evaluate<string>(
            'document.querySelector("[role=tab][aria-selected=true]")?.textContent || ""',
          ),
        (value) => value.trim() === 'Measurements',
        'Control Page Down worksheet',
      );
      await ui.capture('worksheet-wide', 1280, 900);
      await ui.capture('worksheet-minimum', 760, 540);
      checks.push('Grid arrows, formula detail, A1 entry, page boundary and worksheet shortcuts');
    },
  );
  await run(
    'book',
    { id: 'book', type: 'preview', path: path.join(files, 'Book.epub') },
    async (connection) => {
      const { evaluate } = connection,
        ui = helpers(connection);
      await until(
        () => evaluate<boolean>('document.querySelector(".epub-image img")?.naturalWidth > 0'),
        Boolean,
        'Authorized illustration',
      );
      assert.equal(await evaluate('window.__epubUnsafe'), undefined);
      assert.equal(
        await evaluate('document.querySelectorAll(".epub-chapter img[src^=http]").length'),
        0,
      );
      await evaluate('document.querySelector(".epub-chapter").scrollTop = 320');
      const before = await evaluate<number>('document.querySelector(".epub-chapter").scrollTop');
      await ui.click('.epub-chapter a');
      await until(
        ui.text,
        (text) => text.includes('The copper circuit uses a saved reference.'),
        'Book footnote',
      );
      await ui.click('[aria-label="Back to reading position"]');
      await until(
        () => evaluate<number>('document.querySelector(".epub-chapter").scrollTop'),
        (value) => Math.abs(value - before) < 2,
        'Return to book scroll',
      );
      await evaluate(
        'Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Find in book").click()',
      );
      await ui.fill('[aria-label="Search book text"]', 'copper circuit');
      await until(ui.text, (text) => text.includes('2 matches'), 'Book search across formatting');
      await ui.click('.epub-search li:last-child button');
      await until(
        () => evaluate<string>('document.querySelector("[data-epub-match]")?.textContent || ""'),
        (value) => value === 'copper circuit',
        'Highlighted search location',
      );
      await ui.capture('book-wide', 1280, 900);
      await ui.capture('book-minimum', 760, 540);
      checks.push(
        'Safe illustrations, footnotes, reading return, cross-format text search and match highlight',
      );
    },
  );
  passed = true;
} finally {
  for (const [name, bytes] of Object.entries(fixtures))
    assert.equal(digest(await readFile(path.join(files, name))), digest(bytes), 'Source preserved');
  await writeFile(path.join(root, 'results.json'), JSON.stringify({ passed, checks }, null, 2), {
    flag: 'wx',
  });
  console.log(JSON.stringify({ passed, checks, evidence: path.basename(root) + '/results.json' }));
}
