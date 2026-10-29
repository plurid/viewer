/** The smoke runner launches this main process with one exclusively owned profile. */
import assert from 'node:assert/strict';
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { renderOffice } from '../../src/desktop/previews/office-renderer';
import { verifyOfficeRuntime } from '../../src/desktop/previews/office-assets';

const root = process.argv[2];
// Qualification failures must be retained without Electron's native error dialog.
const fatal = (error: unknown) => {
  try {
    if (root && path.isAbsolute(root))
      appendFileSync(path.join(root, 'fatal.log'), String(error) + '\n');
  } catch {
    // Exiting remains possible when even the diagnostic file cannot be written.
  }
  app.exit(1);
};
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);
assert.ok(root && path.isAbsolute(root));
app.setName('Viewer Office qualification');
app.setPath('userData', path.join(root, 'Profile'));
if (process.platform === 'darwin') app.setActivationPolicy('accessory');
app.on('window-all-closed', () => {});
const cases: unknown[] = [];
async function run() {
  try {
    const job = JSON.parse(await readFile(path.join(root, 'job.json'), 'utf8')) as {
      runtime: string;
      inputs: { name: string; sha256: string }[];
    };
    await verifyOfficeRuntime(job.runtime);
    for (const input of job.inputs) {
      assert.equal(path.basename(input.name), input.name);
      const bytes = await readFile(path.join(root, input.name));
      const hash = createHash('sha256').update(bytes).digest('hex');
      assert.equal(hash, input.sha256);
      const start = performance.now();
      const result = await renderOffice(
        job.runtime,
        bytes,
        path.extname(input.name).slice(1),
        new AbortController().signal,
        { name: input.name },
      );
      assert.equal(result.data.subarray(0, 5).toString(), '%PDF-');
      assert.ok(result.data.length > 100);
      await writeFile(path.join(root, input.name + '.pdf'), result.data, { flag: 'wx' });
      assert.equal(
        createHash('sha256')
          .update(await readFile(path.join(root, input.name)))
          .digest('hex'),
        hash,
      );
      cases.push({
        name: input.name,
        milliseconds: performance.now() - start,
        pdfBytes: result.data.length,
        office: result.office,
      });
      const alternate = result.office.sheets.find(
        (sheet) => sheet.name !== result.office.selectedSheet,
      );
      if (alternate) {
        const second = await renderOffice(
          job.runtime,
          bytes,
          path.extname(input.name).slice(1),
          new AbortController().signal,
          { name: input.name, sheet: alternate.name },
        );
        assert.equal(second.office.selectedSheet, alternate.name);
        await writeFile(path.join(root, input.name + '.second-sheet.pdf'), second.data, {
          flag: 'wx',
        });
        // Save PDF copy keeps every sheet
        const whole = await renderOffice(
          job.runtime,
          bytes,
          path.extname(input.name).slice(1),
          new AbortController().signal,
          { name: input.name, whole: true },
        );
        assert.equal(whole.office.selectedSheet, undefined);
        await writeFile(path.join(root, input.name + '.whole.pdf'), whole.data, { flag: 'wx' });
      }
    }
    await writeFile(
      path.join(root, 'result.json'),
      JSON.stringify({ passed: true, platform: process.platform, cases }, null, 2) + '\n',
      { flag: 'wx' },
    );
    app.quit();
  } catch (error) {
    await writeFile(
      path.join(root, 'failure.json'),
      JSON.stringify({ passed: false, cases, error: String(error) }, null, 2) + '\n',
      { flag: 'wx' },
    );
    app.exit(1);
  }
}
void app.whenReady().then(run);
