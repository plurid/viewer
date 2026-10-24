/** Exercise native window visibility without synthesizing a global shortcut. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import { temporaryRoot } from '../../tools/temporary';
import { ensureElectronRuntime } from '../../tools/native-build/runtime';

assert.equal(process.platform, 'darwin', 'This regression exercises native macOS windows.');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixture = await realpath(await temporaryRoot('viewer-native-hotkey-'));
const files = [
  'tests/native/fixtures/hotkey-window.ts',
  'src/desktop/windows/hotkey-window.ts',
  'src/desktop/windows/application-dispatch.ts',
] as const;
const provenance: { source: string; sha256: string; compiled: string }[] = [];

// Preserve source-relative imports in an isolated CommonJS directory tree. Only these three
// modules are emitted; the application and its native addons are not built by this probe.
for (const relative of files) {
  const sourcePath = path.join(appRoot, relative);
  const source = await readFile(sourcePath, 'utf8');
  const compiled = relative.replace(/\.ts$/, '.js');
  const emitted = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  const errors =
    emitted.diagnostics?.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    ) ?? [];
  assert.equal(
    errors.length,
    0,
    errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n'),
  );
  const output = path.join(fixture, compiled);
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, emitted.outputText, { flag: 'wx', mode: 0o600 });
  provenance.push({
    source: relative,
    sha256: createHash('sha256').update(source).digest('hex'),
    compiled,
  });
}
await writeFile(
  path.join(fixture, 'provenance.json'),
  JSON.stringify({ version: 1, modules: provenance }, null, 2),
  { flag: 'wx', mode: 0o600 },
);

try {
  const runtime = await ensureElectronRuntime({ appRoot });
  await promisify(execFile)(
    runtime.executable,
    [path.join(fixture, 'tests/native/fixtures/hotkey-window.js')],
    {
      cwd: fixture,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        VIEWER_HOTKEY_FIXTURE_ROOT: fixture,
      },
      timeout: 45_000,
    },
  );
  const result = JSON.parse(await readFile(path.join(fixture, 'result.json'), 'utf8')) as {
    passed?: boolean;
    error?: string;
  };
  assert.equal(result.passed, true, result.error ?? 'The native fixture did not report success.');
  console.log('Native hotkey visibility regression passed.');
} finally {
  console.log('Retained native hotkey evidence: ' + fixture);
}
