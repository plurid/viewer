/** Genuine POSIX refusal and cold recovery in a generated profile. No removals. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CURRENT_STATE_VERSION,
  type OperationJob,
  type SavedState,
} from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { operationJournal } from '../../src/desktop/operations/operation-journal';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-operation-recovery-');
const files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
const blocked = path.join(files, 'Read-only destination'),
  destination = path.join(files, 'Writable destination');
await Promise.all([mkdir(files), mkdir(profile)]);
await Promise.all([mkdir(blocked), mkdir(destination)]);
const source = path.join(files, 'Original.txt'),
  staging = path.join(destination, '.viewer-transfer-partial');
await writeFile(source, 'original bytes remain intact\n', { flag: 'wx' });
await writeFile(staging, 'retained partial bytes\n', { flag: 'wx' });
const interrupted = randomUUID();
await operationJournal(profile).save({
  version: 1,
  records: [
    {
      job: {
        id: interrupted,
        revision: 1,
        kind: 'copy',
        status: 'running',
        sources: [source],
        destination,
        bytesDone: 3,
        bytesTotal: 28,
        itemsDone: 0,
        itemsTotal: 1,
        completed: [],
        errors: [],
        errorCount: 0,
        undoable: false,
      },
      request: { kind: 'copy', sources: [source], destination },
      undo: [],
      intent: { source, destination: path.join(destination, 'Original.txt'), staging },
    },
  ],
});
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'recovery',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'recovery',
      name: 'Operation recovery',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: files,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [files],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const observations: unknown[] = [];
let failedID = '';
await chmod(blocked, 0o555);
try {
  for (let launch = 0; launch < 2; launch++) {
    const app = await ownedApp(binary, profile);
    let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
    try {
      connection = await app.connect();
      const { evaluate } = connection;
      const recovered = await until(
        () => evaluate<OperationJob[]>('window.viewer.jobs()'),
        (jobs) => jobs.some((job) => job.id === interrupted),
        'interrupted receipt loaded',
      );
      const prior = recovered.find((job) => job.id === interrupted)!;
      assert.equal(prior.status, 'failed');
      assert.equal(prior.recovery?.staging, staging);
      assert.match(prior.errors.at(-1)!.message, /Interrupted operation/);
      if (launch === 0) {
        failedID = await evaluate<string>(
          `window.viewer.operate({kind: 'mkdir', sources: [], destination: ${JSON.stringify(blocked)}, name: 'Must not appear'})`,
        );
        const jobs = await until(
          () => evaluate<OperationJob[]>('window.viewer.jobs()'),
          (jobs) => jobs.some((job) => job.id === failedID && job.status === 'failed'),
          'POSIX write refusal',
        );
        const failed = jobs.find((job) => job.id === failedID)!;
        assert.equal(failed.completed.length, 0);
        assert.ok(failed.errors.length > 0);
        observations.push({ kind: 'permission-refusal', job: failed });
        const nextID = await evaluate<string>(
          `window.viewer.operate({kind: 'mkdir', sources: [], destination: ${JSON.stringify(destination)}, name: 'Queue still works'})`,
        );
        const next = await until(
          () => evaluate<OperationJob[]>('window.viewer.jobs()'),
          (jobs) => jobs.some((job) => job.id === nextID && job.status === 'completed'),
          'queue recovers after failure',
        );
        observations.push({ kind: 'later-success', job: next.find((job) => job.id === nextID) });
        assert.ok((await lstat(path.join(destination, 'Queue still works'))).isDirectory());
      } else {
        assert.equal(recovered.find((job) => job.id === failedID)?.status, 'failed');
        observations.push({ kind: 'cold-restore', recovered: prior, failedID });
      }
      await app.close(connection);
      connection = undefined;
    } finally {
      if (connection) await app.close(connection);
    }
    await chmod(blocked, 0o755);
    assert.equal(await readFile(source, 'utf8'), 'original bytes remain intact\n');
    assert.equal(await readFile(staging, 'utf8'), 'retained partial bytes\n');
    await assert.rejects(lstat(path.join(destination, 'Original.txt')), { code: 'ENOENT' });
    await assert.rejects(lstat(path.join(blocked, 'Must not appear')), { code: 'ENOENT' });
  }
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ pass: true, binary, observations }, null, 2),
    { flag: 'wx' },
  );
  console.log('Packaged operation recovery acceptance passed:', root);
} finally {
  await chmod(blocked, 0o755);
}
