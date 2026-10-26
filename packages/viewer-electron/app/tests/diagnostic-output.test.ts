import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { protectDiagnosticOutput } from '../src/desktop/diagnostics/output';
import { temporaryRoot } from '../tools/temporary';

it('installs one closed-pipe guard and leaves other output errors visible', () => {
  const output = new EventEmitter();
  protectDiagnosticOutput([output]);
  protectDiagnosticOutput([output]);
  expect(output.listenerCount('error')).toBe(1);
  for (const code of ['EPIPE', 'ERR_STREAM_DESTROYED'])
    expect(() =>
      output.emit('error', Object.assign(new Error('Closed output'), { code })),
    ).not.toThrow();
  expect(() =>
    output.emit('error', Object.assign(new Error('Other failure'), { code: 'EIO' })),
  ).toThrow('Other failure');
});

it('survives an actual launcher closing its diagnostic read pipe', async () => {
  const root = await temporaryRoot('viewer-diagnostic-pipe-');
  const file = path.join(root, 'write-after-disconnect.mts');
  await writeFile(
    file,
    `
    import { protectDiagnosticOutput } from ${JSON.stringify(new URL('../src/desktop/diagnostics/output.ts', import.meta.url).href)};
    if (process.argv.at(-1) === 'protected') protectDiagnosticOutput([process.stdout, process.stderr]);
    process.stdin.once('data', () => {
      process.stdout.write('Diagnostic after launcher disconnect\\n');
      setTimeout(() => process.exit(0), 100);
    });
  `,
    { flag: 'wx' },
  );
  const run = async (mode: string) => {
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), file, mode], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', (bytes) => {
      error += bytes.toString();
    });
    const finished = new Promise<{ code: number | null; error: string }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, error }));
    });
    await new Promise<void>((resolve) => {
      child.stdout.once('close', resolve);
      child.stdout.destroy();
    });
    child.stdin.end('go');
    return finished;
  };
  const unprotected = await run('unprotected');
  expect(unprotected.code).not.toBe(0);
  expect(unprotected.error).toContain('EPIPE');
  expect(await run('protected')).toEqual({ code: 0, error: '' });
});
