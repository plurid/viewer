/** Document-specific recovery uses mutable copies; pinned public originals remain unchanged. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { SavedState } from '../../src/domain/contracts';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { qualificationSamples } from '../../tools/playground/qualification-samples';
import { readerSamples } from '../../tools/playground/reader-samples';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-document-recovery-');
const book = readerSamples.find((sample) => sample.path.endsWith('idpf-wasteland.epub'))!;
const workbook = qualificationSamples.find((sample) =>
  sample.path.endsWith('poi-large-workbook.xlsx'),
)!;
const cases = [
  {
    kind: 'epub',
    sample: book,
    source: path.join(
      process.env.VIEWER_TEST_READER_CORPUS ?? defaultPlaygroundDirectory,
      book.path,
    ),
    selector: '.epub-chapter',
  },
  {
    kind: 'xlsx',
    sample: workbook,
    source: path.join(defaultPlaygroundDirectory, workbook.path),
    selector: '[role="grid"]',
  },
] as const;
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const checks: string[] = [];
const marker = 'Externally updated document qualification marker';
let passed = false;
try {
  for (const scenario of cases) {
    assert.equal(await hash(scenario.source), scenario.sample.sha256);
    const directory = path.join(root, scenario.kind),
      files = path.join(directory, 'Files'),
      profile = path.join(directory, 'Profile');
    await Promise.all([mkdir(files, { recursive: true }), mkdir(profile, { recursive: true })]);
    const original = path.join(files, 'Original.' + scenario.kind),
      renamed = path.join(files, 'Renamed.' + scenario.kind);
    await copyFile(scenario.source, original, 1);
    const settings = defaultSettings(files),
      ui = normalizePreferences();
    settings.hotkey.enabled = false;
    settings.providers = [];
    ui.sidebar.inNewPlanes = false;
    ui.space.opening = 'dock';
    const state: SavedState = {
      version: CURRENT_STATE_VERSION,
      look: 'dark',
      activeWorkspace: scenario.kind,
      favorites: [],
      recents: [],
      ui,
      workspaces: [
        {
          id: scenario.kind,
          name: 'Document recovery',
          roots: ['document'],
          activePane: 'document',
          arrangement: {},
          panes: [{ id: 'document', type: 'preview', path: original }],
          layout: {
            placements: [
              {
                id: 'document',
                width: 1100,
                height: 760,
                show: true,
                location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
              },
            ],
            active: 'document',
            docked: 'document',
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
    const app = await ownedApp(binary, profile);
    let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
    try {
      connection = await app.connect();
      const { evaluate } = connection;
      const text = () => evaluate<string>('document.body.innerText');
      const click = (label: string) =>
        evaluate(
          `Array.from(document.querySelectorAll('.preview-recovery button')).find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`,
        );
      const focus = () => evaluate(`window.dispatchEvent(new Event('focus'))`);
      const ready = () =>
        until(
          () =>
            evaluate<boolean>(
              `!!document.querySelector(${JSON.stringify(scenario.selector)}) && !document.querySelector('.preview-body .loading')`,
            ),
          Boolean,
          'Document ready ' + scenario.kind,
          20000,
        );
      await ready();
      if (scenario.kind === 'epub') {
        await evaluate(`document.querySelectorAll('.epub-body nav button')[0].click()`);
        await evaluate(
          `(() => { const chapter = document.querySelector('.epub-chapter'); chapter.scrollTop = 480; chapter.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('viewer-preview-flush')); })()`,
        );
      } else {
        await evaluate(
          `(() => { const input = document.querySelector('[aria-label="Cell address"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'B5000'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
        );
        await evaluate(
          `document.querySelector('[aria-label="Cell address"]').closest('form').requestSubmit()`,
        );
        await until(
          () =>
            evaluate<string>(`document.querySelector('[aria-label="Cell address"]')?.value || ''`),
          (value) => value === 'B5000',
          'Deep workbook position',
        );
        await until(
          () =>
            evaluate<string>(
              `document.querySelector('.worksheet-navigation [role="status"]')?.textContent || ''`,
            ),
          (value) => value.startsWith('Rows 5,000'),
          'Deep worksheet loaded',
        );
      }
      const position = (): Promise<string | number> =>
        scenario.kind === 'epub'
          ? evaluate<number>(`document.querySelector('.epub-chapter')?.scrollTop ?? -1`)
          : evaluate<string>(`document.querySelector('[aria-label="Cell address"]')?.value || ''`);
      const previous = await position();
      const emptySelected =
        scenario.kind === 'xlsx' &&
        (await evaluate<boolean>(`(() => {
        const cell = document.querySelector('.workbook-cell[aria-label$=": Empty"]');
        if (!cell) return false;
        cell.click(); return true;
      })()`));
      const retainedPosition = emptySelected ? await position() : previous;
      await rename(original, renamed);
      await focus();
      await until(
        text,
        (value) => value.includes('last loaded version'),
        'Renamed document notice',
      );
      assert.equal(await position(), retainedPosition, 'Retained position while renamed');
      await click('Find renamed file');
      await until(
        async () =>
          JSON.parse(
            await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8'),
          ) as SavedState,
        (saved) => saved.workspaces[0]?.panes[0]?.path === renamed,
        'Rename identity recovery',
      );
      await ready();
      await until(
        position,
        (value) => value === retainedPosition,
        'Rename retained reader position',
      );
      if (emptySelected)
        assert.ok((await text()).includes('Empty cell'), 'Restored empty-cell inspection');
      const parked = path.join(directory, 'Parked Files');
      await rename(files, parked);
      await focus();
      await until(
        text,
        (value) => value.includes('last loaded version'),
        'Unavailable document location',
      );
      assert.equal(await position(), retainedPosition, 'Retained position while unavailable');
      await rename(parked, files);
      await click('Check again');
      await until(
        () => evaluate<boolean>('!document.querySelector(".preview-recovery")'),
        Boolean,
        'Returned location',
      );
      await ready();
      assert.equal(
        await position(),
        retainedPosition,
        'Recovered location retained reader position',
      );
      const bytes = await readFile(renamed);
      await writeFile(path.join(directory, 'Before external edit.' + scenario.kind), bytes, {
        flag: 'wx',
      });
      const archive = unzipSync(bytes);
      if (scenario.kind === 'epub') {
        for (const [name, content] of Object.entries(archive))
          if (/\.(xhtml|html|htm)$/.test(name))
            archive[name] = strToU8(
              strFromU8(content).replace(/<\/body>/i, '<p>' + marker + '</p></body>'),
            );
      } else {
        const part = 'xl/worksheets/sheet1.xml';
        assert.ok(archive[part]);
        const content = strFromU8(archive[part]);
        const updated = content.replace(
          /<c\b[^>]*\br="A1"[^>]*>[\s\S]*?<\/c>/,
          '<c r="A1" t="inlineStr"><is><t>' + marker + '</t></is></c>',
        );
        assert.notEqual(updated, content, 'Mutable workbook has source cell A1');
        archive[part] = strToU8(updated);
      }
      const edited = zipSync(archive);
      await writeFile(renamed, edited);
      await focus();
      await until(
        text,
        (value) => value.includes(marker),
        'Modified document refreshes current version',
        20000,
      );
      assert.equal(await evaluate('!!document.querySelector(".preview-recovery")'), false);
      await writeFile(renamed, 'An external application has not finished writing this archive.');
      await focus();
      await until(
        text,
        (value) =>
          value.includes('EPUB could not be opened') ||
          value.includes('Office preview unavailable'),
        'Interrupted external save is explicit',
      );
      await writeFile(renamed, edited);
      await focus();
      await until(
        text,
        (value) => value.includes(marker),
        'Repaired external save recovers automatically',
        20000,
      );
      checks.push(
        scenario.kind +
          ': rename and unavailable location retain position; changed bytes invalidate cached content; interrupted external saves recover after valid bytes return',
      );
    } catch (error) {
      if (connection) {
        const image = await connection.command<{ data: string }>('Page.captureScreenshot', {
          format: 'png',
        });
        await writeFile(path.join(directory, 'failure.png'), Buffer.from(image.data, 'base64'), {
          flag: 'wx',
        });
        await writeFile(
          path.join(directory, 'failure.txt'),
          await connection.evaluate<string>('document.body.innerText'),
          { flag: 'wx' },
        );
      }
      throw error;
    } finally {
      await app.close(connection);
    }
  }
  passed = true;
} finally {
  for (const scenario of cases) assert.equal(await hash(scenario.source), scenario.sample.sha256);
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ passed, checks }, null, 2), {
    flag: 'wx',
  });
  console.log(JSON.stringify({ passed, checks, evidence: path.basename(root) + '/result.json' }));
}
