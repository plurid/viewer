import { describe, expect, it } from 'vitest';
import type { OperationJob } from '../src/domain/contracts';
import { JournalActivity } from '../src/desktop/journal/activity';
import { JournalStore } from '../src/desktop/journal/store';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const job = (status: OperationJob['status']): OperationJob => ({
  id: 'job-one',
  revision: 1,
  kind: 'copy',
  status,
  sources: ['/private-content'],
  bytesDone: 0,
  bytesTotal: 0,
  itemsDone: 0,
  itemsTotal: 1,
  completed: [],
  errors: [],
  errorCount: 0,
  undoable: false,
});

describe('authoritative Journal lifecycle projection', () => {
  it('uses validated service targets and records one Git outcome through duplicate/error/cancel races', async () => {
    const events: Parameters<JournalStore['record']>[0][] = [];
    const activity = new JournalActivity({
      record: (event) => {
        events.push(event);
      },
    });
    await activity.within({ windowID: 'window-a', workspaceID: 'old', planeID: 'old-plane' }, () =>
      activity.at({ workspaceID: 'new', planeID: 'new-plane' }, () =>
        activity.git('one', 'commit', async () => {}),
      ),
    );
    await activity.git('one', 'commit', async () => {});
    activity.cancelGit('one', 'another-window');
    expect(events).toHaveLength(1);
    activity.cancelGit('one', 'window-a');
    activity.terminal({ id: 'one', type: 'exit', code: 1 });
    expect(events.map((event) => event.phase)).toEqual(['started', 'cancelled']);
    expect(
      events.every(
        (event) => event.origin.workspaceID === 'new' && event.origin.planeID === 'new-plane',
      ),
    ).toBe(true);
    const failure = new Error('private error details');
    await expect(
      activity.git('two', 'push', async () => {
        activity.terminal({ type: 'error', id: 'two', message: failure.message });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(events.filter((event) => event.taskID === 'two').map((event) => event.phase)).toEqual([
      'started',
      'failed',
    ]);
  });
  it('retains independent captured origins across concurrent operations and late callbacks', async () => {
    const directory = await temporaryRoot('viewer-journal-origins-');
    const store = new JournalStore(directory);
    const activity = new JournalActivity(store);
    let finish!: () => void;
    const pending = activity.within(
      { windowID: 'window-a', workspaceID: 'alpha', planeID: 'plane-a' },
      () =>
        activity.run(
          'workspace',
          'save',
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        ),
    );
    await activity.within(
      { windowID: 'window-b', workspaceID: 'beta', planeID: 'plane-b' },
      async () => {
        await activity.run('server', 'start', async () => {});
        activity.job(job('queued'));
        await activity.git('git-session', 'commit', async () => {});
        await activity.send('conversation', async () => {});
      },
    );
    // The window can switch or close before these service callbacks arrive.
    activity.terminal({ type: 'data', id: 'git-session', data: 'SECRET_TERMINAL_BYTES' });
    activity.terminal({ type: 'exit', id: 'git-session', code: 0 });
    activity.job({ ...job('completed'), completed: [{ source: 'SECRET_FILE_PATH' }] });
    activity.chat({ id: 'conversation', status: 'failed' });
    finish();
    await pending;
    await store.flush();
    const events = (await store.query({ filter: {} })).records;
    expect(events).toHaveLength(10);
    for (const event of events)
      expect(event.origin).toEqual(
        event.source === 'workspace'
          ? { windowID: 'window-a', workspaceID: 'alpha', planeID: 'plane-a' }
          : { windowID: 'window-b', workspaceID: 'beta', planeID: 'plane-b' },
      );
    for (const source of ['workspace', 'git', 'chat', 'server', 'files']) {
      const pair = events.filter((event) => event.source === source);
      expect(new Set(pair.map((event) => event.traceID)).size).toBe(1);
      expect(pair.map((event) => event.phase).sort()).toEqual(
        source === 'chat' ? ['failed', 'started'] : ['started', 'succeeded'],
      );
    }
    expect(JSON.stringify(events)).not.toMatch(/SECRET|private-content/);
    await store.close();
    await trashTemporary(directory);
  });

  it('preserves original failures, cancellation and decisions without serializing their messages', async () => {
    const captured: Parameters<JournalStore['record']>[0][] = [];
    const activity = new JournalActivity({
      record: (record) => {
        captured.push(record);
      },
    });
    const failure = new Error('Bearer SECRET_PROVIDER_BODY and PRIVATE_KEY');
    await expect(
      activity.run('server', 'start', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    const aborted = new Error('sensitive cancelled prompt');
    aborted.name = 'AbortError';
    await expect(
      activity.run('chat', 'send', async () => {
        throw aborted;
      }),
    ).rejects.toBe(aborted);
    activity.within({ workspaceID: 'alpha' }, () => activity.job(job('queued')));
    activity.job(job('collision'));
    activity.job(job('collision'));
    activity.job(job('cancelled'));
    expect(captured.map((event) => event.phase)).toEqual([
      'started',
      'failed',
      'started',
      'cancelled',
      'started',
      'waiting',
      'cancelled',
    ]);
    expect(JSON.stringify(captured)).not.toMatch(/SECRET|PRIVATE|sensitive/);
    const broken = new JournalActivity({
      record: () => {
        throw new Error('sink unavailable');
      },
    });
    await expect(broken.run('workspace', 'save', async () => 42)).resolves.toBe(42);
  });

  it('does not replay completed operation receipts as new activity', () => {
    const events: unknown[] = [];
    const activity = new JournalActivity({
      record: (event) => {
        events.push(event);
      },
    });
    activity.within({ workspaceID: 'alpha' }, () => activity.job(job('completed')));
    activity.chat({ id: 'restored-chat', status: 'idle' });
    activity.terminal({ type: 'exit', id: 'old-terminal', code: 0 });
    expect(events).toEqual([]);
  });
});
