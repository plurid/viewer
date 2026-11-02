/** Native qualification of retained provider output. Never modifies generated HTML. */
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ownedApp, until } from '../../tests/owned-app';
import { canvasFrame } from '../../tests/native/runtime/canvas';
import { pageCall } from '../../tests/native/runtime/page-function';
import { pressButton, textOf } from '../../tests/native/runtime/page';
import { screenshot } from '../docs/record';
import { readRobotSessionResult, digest } from '../robotics/rehearsal';
import { temporaryRoot } from '../temporary';
import { prepareCanvasDrawing } from '../../src/domain/canvases/drawing';
import type { CanvasDocument } from '../../src/domain/canvases/document';
import type { CanvasConnection } from '../../tests/native/runtime/canvas';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const { values } = parseArgs({
  options: {
    run: { type: 'string' },
    binary: { type: 'string' },
    stage: { type: 'string' },
    inspect: { type: 'boolean' },
  },
});
assert.ok(values.run && values.binary && ['mounting', 'comparison'].includes(values.stage ?? ''));
const root = await realpath(values.run);
const fixture = await realpath(await temporaryRoot('viewer-mounting-qualification-'));
const profile = path.join(fixture, 'Profile');
await cp(path.join(root, 'Profile'), profile, {
  recursive: true,
  errorOnExist: true,
  force: false,
});
const result = (await readRobotSessionResult(
  path.join(root, 'sessions', values.stage === 'mounting' ? '01' : '02'),
)) as { canvas: CanvasDocument };
const canvas = result.canvas;
assert.ok(canvas?.html.includes('<script'), 'The provider published executable HTML.');
const evidence = path.join(root, 'qualification-' + values.stage + '-' + Date.now());
await mkdir(evidence);
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: CanvasConnection | undefined;
const start = async () => {
  app = await ownedApp(values.binary!, profile, {
    label: 'mounting-generated',
    mode: 'hidden',
    mockKeychain: true,
  });
  main = await app.connect();
  const point = await until(
    () =>
      main!.evaluate(
        pageCall(() => {
          const rect = document.querySelector('.plane-controls')?.getBoundingClientRect();
          return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : undefined;
        }),
      ),
    Boolean,
    'plane header',
  );
  for (const type of ['mousePressed', 'mouseReleased'])
    await main.command('Input.dispatchMouseEvent', {
      type,
      ...point,
      button: 'left',
      clickCount: 1,
    });
  const frame = await canvasFrame(main, canvas.id);
  await until(
    () => frame.evaluate(pageCall(() => document.querySelectorAll('button').length)),
    (n) => n > 0,
    'generated controls',
  );
  await until(
    () =>
      main!.evaluate(
        pageCall(() => {
          let node: Element | null = document.querySelector('.canvas-plane');
          while (node) {
            if (Number(getComputedStyle(node).opacity) < 0.99) return false;
            node = node.parentElement;
          }
          return true;
        }),
      ),
    Boolean,
    'settled plane',
  );
  return frame;
};
const stop = async () => {
  if (app) await app.close(main);
  app = undefined;
  main = undefined;
};
const saveReview = async (drawing = true) => {
  await main!.evaluate(pressButton(drawing ? 'Save drawing…' : 'Save result…', '.canvas-result'));
  await until(
    () =>
      main!.evaluate(
        pageCall(
          () =>
            !!document.querySelector(
              '.viewer-file-picker[open] .file-picker-files[aria-busy="false"]',
            ),
        ),
      ),
    Boolean,
    'save picker',
  );
  await main!.evaluate(pressButton('Save', '.viewer-file-picker footer'));
};
try {
  let frame = await start();
  const info = await frame.evaluate(
    pageCall(() => ({
      text: document.body.innerText.slice(0, 6000),
      inputs: [...document.querySelectorAll('input')].map((input) => ({
        id: input.id,
        name: input.name,
        type: input.type,
        value: input.value,
        label: input.labels?.[0]?.textContent,
      })),
      buttons: [...document.querySelectorAll('button')].map((button) => ({
        id: button.id,
        text: button.textContent,
        disabled: button.disabled,
      })),
      canvases: [...document.querySelectorAll('canvas')].map((node) => ({
        width: node.width,
        height: node.height,
      })),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    })),
  );
  await writeFile(path.join(evidence, 'interface.json'), JSON.stringify(info, null, 2), {
    flag: 'wx',
  });
  await screenshot(main!, path.join(evidence, 'interface.png'));
  if (!values.inspect && values.stage === 'mounting') {
    await frame.evaluate(
      pageCall(() => {
        const field = [...document.querySelectorAll<HTMLInputElement>('input')].find((input) =>
          /width/i.test(input.labels?.[0]?.textContent ?? input.id),
        );
        if (!field) throw new Error('Width control missing.');
        field.value = '180';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }),
    );
    await frame.evaluate(pressButton('Review draft drawing'));
    await until(
      () => main!.evaluate(textOf('.canvas-drawing-result')),
      (text) => text.includes('180 mm') && text.includes('140 mm'),
      'host measured edited drawing',
    );
    await screenshot(main!, path.join(evidence, 'drawing-review.png'));
    await saveReview();
    const drawing = path.join(root, 'mounting-plate.dxf');
    const bytes = await until(
      () => readFile(drawing).catch(() => Buffer.alloc(0)),
      (bytes) => bytes.length > 0,
      'saved DXF',
    );
    const measurement = prepareCanvasDrawing(bytes.toString('utf8')).measurement;
    assert.equal(measurement.width, 180);
    assert.equal(measurement.height, 140);
    assert.equal(measurement.holes.length, 4);
    assert.ok(measurement.holes.every((hole) => Math.abs(hole.diameter - 6.5) < 0.001));
    await main!.evaluate(pressButton('Open saved file'));
    await until(
      () => main!.evaluate(pageCall(() => !!document.querySelector('.dxf-viewer'))),
      Boolean,
      'native DXF preview',
    );
    await screenshot(main!, path.join(evidence, 'reopened-drawing.png'));
    await stop();
    frame = await start();
    const width = await frame.evaluate(
      pageCall(
        () =>
          [...document.querySelectorAll<HTMLInputElement>('input')].find((input) =>
            /width/i.test(input.labels?.[0]?.textContent ?? input.id),
          )?.value,
      ),
    );
    assert.equal(width, '180');
    await writeFile(
      path.join(evidence, 'result.json'),
      JSON.stringify(
        {
          status: 'passed',
          stage: 'mounting',
          htmlHash: digest(canvas.html),
          drawing,
          drawingHash: digest(bytes),
          measurement,
          restartWidth: width,
          modelRequests: 0,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
  }
  if (!values.inspect && values.stage === 'comparison') {
    const eligibility = await frame.evaluate(
      pageCall(() => {
        const row = [...document.querySelectorAll('tr')].find((row) =>
          row.textContent?.includes('Economy'),
        );
        const choice = row?.querySelector<HTMLInputElement | HTMLButtonElement>('input,button');
        return { disabled: choice?.disabled, text: row?.textContent };
      }),
    );
    assert.equal(eligibility.disabled, true, 'Economy cannot meet the initial three-day deadline.');
    await frame.evaluate(
      pageCall(() => {
        const deadline = [...document.querySelectorAll<HTMLInputElement>('input')].find((input) =>
          /deadline/i.test((input.labels?.[0]?.textContent ?? '') + input.id),
        );
        if (!deadline) throw new Error('Deadline control missing.');
        deadline.value = '7';
        deadline.dispatchEvent(new Event('input', { bubbles: true }));
        deadline.dispatchEvent(new Event('change', { bubbles: true }));
        const row = [...document.querySelectorAll('tr')].find((row) =>
          row.textContent?.includes('Economy'),
        );
        const choice = row?.querySelector<HTMLInputElement | HTMLButtonElement>('input,button');
        if (!choice || choice.disabled)
          throw new Error('Economy should be eligible at seven days.');
        choice.click();
      }),
    );
    await frame.evaluate(pressButton('Review selected quote'));
    await until(
      () => main!.evaluate(textOf('.canvas-result pre')),
      (text) => text.includes('Economy') && text.includes('40'),
      'selected offer review',
    );
    await screenshot(main!, path.join(evidence, 'selected-review.png'));
    await saveReview(false);
    const savedFile = path.join(root, 'mounting-plate-quote.md');
    const saved = await until(
      () => readFile(savedFile, 'utf8').catch(() => ''),
      Boolean,
      'saved selected quote',
    );
    const source = canvas.sources.find((source) => source.name === 'supplier-reply.json')!;
    const reply = JSON.parse(source.data.evidence.map((item) => item.text).join('\n'));
    assert.ok(saved.includes(reply.attachment.sha256));
    assert.ok(saved.includes(source.hash));
    assert.ok(saved.includes('Economy') && saved.includes('40') && saved.includes('7'));
    await stop();
    frame = await start();
    const persisted = await frame.evaluate(
      pageCall(() => ({
        deadline: [...document.querySelectorAll<HTMLInputElement>('input')].find((input) =>
          /deadline/i.test((input.labels?.[0]?.textContent ?? '') + input.id),
        )?.value,
        selected: [...document.querySelectorAll<HTMLInputElement>('input:checked')].map(
          (input) => input.value,
        ),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      })),
    );
    assert.equal(persisted.deadline, '7');
    assert.ok(persisted.selected.includes('economy'));
    assert.equal(persisted.overflow, false);
    await main!.command('Emulation.setDeviceMetricsOverride', {
      width: 780,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await until(
      () => frame.evaluate(pageCall(() => document.documentElement.scrollWidth <= innerWidth + 1)),
      Boolean,
      'narrow comparison',
    );
    await screenshot(main!, path.join(evidence, 'narrow-reopened.png'));
    await writeFile(
      path.join(evidence, 'result.json'),
      JSON.stringify(
        {
          status: 'passed',
          stage: 'comparison',
          htmlHash: digest(canvas.html),
          savedFile,
          attachmentHash: reply.attachment.sha256,
          sourceHash: source.hash,
          persisted,
          modelRequests: 0,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
  }
  console.log(
    JSON.stringify({ evidence, profile, inspectionOnly: !!values.inspect, interface: info }),
  );
} catch (error) {
  await writeFile(path.join(evidence, 'failure.json'), JSON.stringify({ error: String(error) }), {
    flag: 'wx',
  });
  console.error('Retained qualification: ' + evidence);
  throw error;
} finally {
  await stop();
}
