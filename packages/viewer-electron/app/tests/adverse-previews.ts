/** Packaged preview limits and recovery. Owns every input and application profile. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { zipSync, strToU8 } from 'fflate';
import { createFixtures } from './fixtures';
import { ownedApp, until } from './owned-app';
import { attributeOf, exists, textOf } from './native/runtime/page';
import { pageCall } from './native/runtime/page-function';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { trashTemporary } from '../tools/temporary';

const binary = process.env.VIEWER_TEST_BINARY!,
  evidence = process.env.VIEWER_ADVERSE_EVIDENCE!;
assert.ok(binary && evidence);
const fixture = await createFixtures(),
  profile = path.join(fixture.root, 'adverse-preview-profile'),
  corpus = path.join(fixture.files, 'Adverse previews');
await Promise.all([mkdir(profile), mkdir(corpus)]);
const pane = fixture.state.workspaces[0].panes[0];
assert.ok(pane.type === 'folder');
pane.path = corpus;
pane.history = [corpus];
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(fixture.state));
const settings = defaultSettings(fixture.files);
settings.previews.maxImagePixels = 1000000;
await writeFile(
  path.join(profile, 'settings-v1.json'),
  JSON.stringify({ version: 1, revision: 0, settings, ui: normalizePreferences(fixture.state.ui) }),
);
type Case = {
  name: string;
  expected: string;
  kind: 'limit' | 'text' | 'archive' | 'image' | 'bounded';
  size: number;
  sha256?: string;
  symlinkTarget?: string;
};
const cases: Case[] = [],
  observations: Record<string, unknown>[] = [];
async function sparse(name: string, size: number, header: Uint8Array | string, expected: string) {
  const file = path.join(corpus, name),
    handle = await open(file, 'wx', 0o600);
  try {
    await handle.truncate(size);
    await handle.writeFile(header);
  } finally {
    await handle.close();
  }
  cases.push({ name, size, expected, kind: 'limit' });
}
let app: Awaited<ReturnType<typeof ownedApp>> | undefined,
  connection: Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>> | undefined,
  quit = false;
function png(width: number, height: number, compressed: Buffer) {
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type),
      header = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([header, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** Scrolls the match to the middle; its centre, and whether a pointer there reaches it. */
function pointAt(selector: string) {
  const element = document.querySelector(selector);
  if (!element) throw Error('Missing row');
  element.scrollIntoView({ block: 'center' });
  const rect = element.getBoundingClientRect(),
    x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  return { x, y, hit: element.contains(document.elementFromPoint(x, y)) };
}
/** The image stage's centre, and whether a pointer there reaches it. */
function stageCentre() {
  const stage = document.querySelector('dialog .image-stage')!;
  const rect = stage.getBoundingClientRect(),
    x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  return { x, y, hit: stage.contains(document.elementFromPoint(x, y)) };
}
/** The preview image's natural size once it has decoded, else null. */
function decodedSize() {
  const image = document.querySelector<HTMLImageElement>('dialog .image-stage img');
  return image && image.complete && image.naturalWidth > 0
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : null;
}
const dialogText = () => document.querySelector('dialog')?.innerText || '';
async function sample(name: string, data: Buffer, kind: Case['kind'], expected: string) {
  await writeFile(path.join(corpus, name), data);
  cases.push({
    name,
    size: data.length,
    kind,
    expected,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
}
try {
  await sparse(
    'Generated oversized drawing.dxf',
    33 * 1024 * 1024,
    '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n',
    'DXF preview limit (32 MB)',
  );
  await sparse(
    'Generated oversized CAD.step',
    65 * 1024 * 1024,
    'ISO-10303-21;\n',
    'conversion limit (64 MB)',
  );
  await sparse(
    'Generated oversized mesh.stl',
    257 * 1024 * 1024,
    'Generated oversized mesh',
    'model exceeds the file limit in Settings',
  );
  const image = await readFile(path.join(fixture.files, 'Images', 'Color.png'));
  await sparse('Generated oversized image.png', 64000001, image, 'Image preview unavailable');
  const stride = 2048 * 4 + 1,
    pixels = Buffer.alloc(stride * 1024),
    row = Buffer.alloc(stride - 1);
  row.fill(Buffer.from([0x82, 0xb3, 0xcf, 0xff]));
  for (let y = 0; y < 1024; y++) row.copy(pixels, y * stride + 1);
  await sample(
    'Generated bounded image.png',
    png(2048, 1024, deflateSync(pixels)),
    'bounded',
    'Large image',
  );
  const linked = 'Generated linked bounded image.png';
  const target = 'Generated bounded image.png';
  await symlink(target, path.join(corpus, linked));
  cases.push({
    name: linked,
    size: (await readFile(path.join(corpus, target))).length,
    kind: 'limit',
    expected: 'A bounded preview could not be created',
    symlinkTarget: target,
  });
  const text = Buffer.alloc(8 * 1024 * 1024, 0x61);
  await writeFile(path.join(corpus, 'Generated large text.txt'), text);
  cases.push({
    name: 'Generated large text.txt',
    size: text.length,
    expected: 'truncated',
    kind: 'text',
    sha256: createHash('sha256').update(text).digest('hex'),
  });
  const archive = zipSync({
    'Generated oversized member.txt': Buffer.alloc(33 * 1024 * 1024, 0x61),
  });
  await writeFile(path.join(corpus, 'Generated oversized member.zip'), archive);
  cases.push({
    name: 'Generated oversized member.zip',
    size: archive.length,
    expected: 'Generated oversized member.txt',
    kind: 'archive',
    sha256: createHash('sha256').update(archive).digest('hex'),
  });
  const printing = zipSync({ '3D/3dmodel.model': strToU8('x'.repeat(65 * 1024 * 1024)) });
  await writeFile(path.join(corpus, 'Generated expanded limit.3mf'), printing);
  cases.push({
    name: 'Generated expanded limit.3mf',
    size: printing.length,
    expected: '3MF archive exceeds the preview limit',
    kind: 'limit',
    sha256: createHash('sha256').update(printing).digest('hex'),
  });
  await writeFile(path.join(corpus, 'Generated recovery image.png'), image);
  cases.push({
    name: 'Generated recovery image.png',
    size: image.length,
    expected: 'decoded',
    kind: 'image',
    sha256: createHash('sha256').update(image).digest('hex'),
  });
  app = await ownedApp(binary, profile);
  connection = await app.connect();
  const { command, evaluate } = connection;
  await until(() => evaluate(exists('.folder-explorer')), Boolean, 'Adverse workspace');
  const click = async (selector: string) => {
    const point = await evaluate(pageCall(pointAt, selector));
    assert.ok(point.hit);
    for (const type of ['mousePressed', 'mouseReleased'])
      await command('Input.dispatchMouseEvent', {
        type,
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: 1,
        x: point.x,
        y: point.y,
      });
  };
  for (const item of cases) {
    const file = path.join(corpus, item.name),
      selector = `[data-file-path=${JSON.stringify(file)}]`,
      observation: Record<string, unknown> = { ...item };
    try {
      await until(() => evaluate(exists(selector)), Boolean, 'Generated adverse row');
      await click(selector);
      await until(
        () => evaluate(attributeOf(selector, 'aria-selected')),
        (value) => value === 'true',
        'Adverse selection',
      );
      for (const type of ['keyDown', 'keyUp'])
        await command('Input.dispatchKeyEvent', {
          type,
          key: ' ',
          code: 'Space',
          windowsVirtualKeyCode: 32,
        });
      await until(() => evaluate(exists('dialog .quick-preview')), Boolean, 'Adverse preview');
      if (item.kind === 'image' || item.kind === 'bounded') {
        const decoded = await until(
          () => evaluate(pageCall(decodedSize)),
          Boolean,
          'Generated image decodes',
        );
        observation.decoded = decoded;
        const point = await evaluate(pageCall(stageCentre));
        assert.ok(point.hit, 'Decoded image receives pointer input');
        await command('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          deltaX: 0,
          deltaY: -60,
          x: point.x,
          y: point.y,
        });
        observation.wheelZoom = await until(
          () =>
            evaluate(
              pageCall(() =>
                parseInt(
                  document.querySelector('dialog .preview-toolbar .tabular')?.textContent || '0',
                ),
              ),
            ),
          (value) => value > 100,
          'Image wheel zoom works after decode',
          2500,
        );
        for (const type of ['mousePressed', 'mouseMoved', 'mouseReleased'])
          await command('Input.dispatchMouseEvent', {
            type,
            button: 'left',
            buttons: type === 'mouseReleased' ? 0 : 1,
            clickCount: 1,
            x: point.x + (type === 'mousePressed' ? 0 : 32),
            y: point.y + (type === 'mousePressed' ? 0 : 18),
          });
        observation.pan = await until(
          () =>
            evaluate(
              pageCall(
                () =>
                  document.querySelector<HTMLElement>('dialog .image-stage img')?.style.transform ||
                  '',
              ),
            ),
          (value) => value.includes('translate(32px, 18px)'),
          'Image drag works after decode',
        );
        await click('dialog .preview-toolbar [aria-label="Fit image"]');
        await until(
          () => evaluate(textOf('dialog .preview-toolbar .tabular')),
          (value) => value === '100%',
          'Image resets to fit after input',
        );
        if (item.kind === 'bounded') {
          assert.ok(decoded && decoded.width <= 512 && decoded.height <= 512);
          assert.match(await evaluate(pageCall(dialogText)), /Large image/);
        }
      } else if (item.kind === 'text')
        await until(
          () => evaluate(pageCall(dialogText)),
          (v) => /truncat|first.*MB|preview limit/i.test(v),
          'Text reports its read bound',
        );
      else
        await until(
          () => evaluate(pageCall(dialogText)),
          (v) => v.includes(item.expected),
          'Adverse limit state',
          6000,
        );
      if (item.kind === 'archive')
        assert.equal(
          await evaluate(
            pageCall(
              () => document.querySelector<HTMLButtonElement>('dialog .archive-row')?.disabled,
            ),
          ),
          true,
          'Oversized archive member stays disabled',
        );
      if (item.name === 'Generated oversized image.png' || item.kind === 'bounded') {
        const shot = await command<{ data: string }>('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        });
        await writeFile(
          path.join(
            path.dirname(evidence),
            item.kind === 'bounded' ? 'image-bounded.png' : 'image-limit.png',
          ),
          Buffer.from(shot.data, 'base64'),
        );
      }
      observation.result = 'passed';
    } catch (error) {
      observation.result = 'failed';
      observation.error = String(error);
      observation.surface = await evaluate(
        pageCall(() => document.querySelector('dialog')?.innerText || document.body.innerText),
      );
      observation.image = await evaluate(
        pageCall(() => {
          const image = document.querySelector<HTMLImageElement>('dialog img');
          return image
            ? {
                src: image.getAttribute('src'),
                width: image.naturalWidth,
                height: image.naturalHeight,
              }
            : null;
        }),
      );
    } finally {
      if (await evaluate(exists('dialog [aria-label=Close]')))
        await click('dialog [aria-label=Close]');
      await until(
        () => evaluate(exists('dialog .quick-preview')),
        (v) => !v,
        'Adverse preview disposed',
      );
      observations.push(observation);
      console.log(item.name + ': ' + observation.result);
      await writeFile(
        evidence,
        JSON.stringify({ version: 1, candidate: binary, completed: false, observations }, null, 2) +
          '\n',
      );
    }
  }
  await app.close(connection);
  quit = true;
  const failed = observations.filter((v) => v.result === 'failed');
  await writeFile(
    evidence,
    JSON.stringify(
      {
        version: 1,
        candidate: binary,
        channel: 'direct',
        completed: true,
        observations,
        limitations: [
          'Generated local size limits; not a complete malformed/provider/codec corpus',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  assert.equal(failed.length, 0, JSON.stringify(failed));
} finally {
  if (app && !quit) await app.close(connection);
  await trashTemporary(fixture.root);
}
