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
import { ensureElectronHeaders } from '../../tools/native-build/headers';

assert.equal(process.platform, 'darwin', 'This regression exercises native macOS windows.');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixture = await realpath(await temporaryRoot('viewer-native-hotkey-'));
const files = [
  'tests/native/fixtures/hotkey-window.ts',
  'src/desktop/windows/hotkey-window.ts',
  'src/desktop/windows/fullscreen-transition.ts',
  'src/desktop/windows/application-dispatch.ts',
] as const;
const provenance: { source: string; sha256: string; compiled: string }[] = [];
const visibilitySource = 'tests/native/fixtures/on-screen-windows.swift';
const phaseSource = 'tests/native/fixtures/window-fullscreen.mm';
const phaseHeader = 'tools/window-fullscreen.h';

// Preserve source-relative imports in an isolated CommonJS directory tree. Only these
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
provenance.push({
  source: visibilitySource,
  sha256: createHash('sha256')
    .update(await readFile(path.join(appRoot, visibilitySource)))
    .digest('hex'),
  compiled: 'on-screen-windows',
});
for (const source of [phaseSource, phaseHeader])
  provenance.push({
    source,
    sha256: createHash('sha256')
      .update(await readFile(path.join(appRoot, source)))
      .digest('hex'),
    compiled: 'window-fullscreen.node',
  });
await writeFile(
  path.join(fixture, 'provenance.json'),
  JSON.stringify({ version: 1, modules: provenance }, null, 2),
  { flag: 'wx', mode: 0o600 },
);

await promisify(execFile)('/usr/bin/xcrun', [
  'swiftc',
  path.join(appRoot, visibilitySource),
  '-o',
  path.join(fixture, 'on-screen-windows'),
]);

try {
  const runtime = await ensureElectronRuntime({ appRoot });
  const headers = await ensureElectronHeaders({
    appRoot,
    electronVersion: runtime.version,
    arch: runtime.arch,
  });
  await promisify(execFile)('/usr/bin/xcrun', [
    'clang++',
    '-std=c++17',
    '-fobjc-arc',
    '-bundle',
    '-undefined',
    'dynamic_lookup',
    '-I',
    headers,
    '-framework',
    'Foundation',
    '-framework',
    'AppKit',
    path.join(appRoot, phaseSource),
    '-o',
    path.join(fixture, 'window-fullscreen.node'),
  ]);
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
