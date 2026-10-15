import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DiagnosticLog } from '../src/desktop/diagnostics';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-diagnostics-');
});
afterEach(async () => {
  await trashTemporary(root);
});
describe('diagnostic log', () => {
  it('appends bounded entries and keeps the most recent half past its limit', async () => {
    const log = new DiagnosticLog(path.join(root, 'Logs', 'diagnostics.log'), 20000);
    await log.record('renderer-error', 'x'.repeat(20000));
    let lines = (await readFile(log.file, 'utf8')).trim().split('\n');
    expect(JSON.parse(lines[0]).detail).toHaveLength(8000);
    for (let index = 0; index < 400; index++)
      await log.record('main-rejection', `failure ${index}`);
    const text = await readFile(log.file, 'utf8');
    expect(text.length).toBeLessThanOrEqual(20000);
    lines = text.trim().split('\n');
    // Whole entries only, ending with the latest.
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(JSON.parse(lines.at(-1)!).detail).toBe('failure 399');
    expect(await readdir(path.dirname(log.file))).toEqual(['diagnostics.log']);
  });
  it('keeps the newest entry even when it alone exceeds the limit', async () => {
    const log = new DiagnosticLog(path.join(root, 'small.log'), 1000);
    await log.record('renderer-error', 'first');
    await log.record('renderer-error', 'y'.repeat(5000));
    const lines = (await readFile(log.file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).detail).toHaveLength(5000);
  });
});
