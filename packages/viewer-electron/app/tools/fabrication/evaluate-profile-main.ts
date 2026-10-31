import { app, safeStorage } from 'electron';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorMessage } from '../../src/domain/errors';
import {
  configuredEvaluationProvider,
  inspectEvaluationProviders,
  readEvaluationProviders,
} from '../../src/desktop/fabrication/evaluation';
import { Credentials } from '../../src/desktop/models/providers';
import { profileEvaluationOptions } from './profile-options';

// This entry opens no renderer, IPC endpoint or model key export. Electron keeps OS key access here.
app.setName('Viewer');
const originalProfile = app.getPath('userData');
const retained = mkdtempSync(path.join(os.tmpdir(), 'viewer-evaluation-desktop-'));
const isolated = path.join(retained, 'electron');
mkdirSync(isolated, { mode: 0o700 });
app.setPath('userData', isolated);
if (process.platform === 'darwin') app.setActivationPolicy('accessory');

let publicText = (value: string) => value;
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = profileEvaluationOptions(args[0] === '--' ? args.slice(1) : args);
  await app.whenReady();
  const out = options.mode !== 'inspect' ? evaluationOutput(options.out!) : undefined;
  if (options.mode === 'replay') {
    const { replayLive } = await import('./replay-live');
    const report = await replayLive({
      source: options.source!,
      out: out!,
      log: (line) => console.log(line),
    });
    console.log(
      JSON.stringify({
        execution: 'recorded-replay',
        metrics: report.metrics,
        files: report.files,
        retained,
      }),
    );
    app.exit(0);
    return;
  }
  const profile = path.resolve(options.profile ?? originalProfile);
  const providers = await readEvaluationProviders(profile);
  const credentials = new Credentials(
    profile,
    async () => {
      throw new Error('An evaluation does not change Viewer credentials.');
    },
    async (value) => {
      if (!(await safeStorage.isAsyncEncryptionAvailable()))
        throw new Error(
          'The operating system key store is unavailable. Open Viewer and try again.',
        );
      return (await safeStorage.decryptStringAsync(value)).result;
    },
  );
  if (options.mode === 'inspect') {
    console.log(
      JSON.stringify({ providers: await inspectEvaluationProviders(providers, credentials) }),
    );
  } else {
    const authentication = await configuredEvaluationProvider(
      providers,
      credentials,
      options.provider,
    );
    publicText = authentication.publicText;
    const { evaluateLive } = await import('./evaluate-live');
    const report = await evaluateLive({
      out: out!,
      authentication,
      jobs: options.jobs,
      repeat: options.repeat,
      retries: options.retries,
      log: (line) => console.log(line),
    });
    console.log(JSON.stringify({ metrics: report.metrics, files: report.files, retained }));
  }
  app.exit(0);
}
function evaluationOutput(value: string): string {
  const repository = path.resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
  const out = path.resolve(value);
  const relative = path.relative(repository, out);
  if (
    !relative ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  )
    throw new Error('Choose an output folder outside the Viewer repository.');
  return out;
}
void main().catch((error: unknown) => {
  console.error(publicText(errorMessage(error)));
  app.exit(1);
});
