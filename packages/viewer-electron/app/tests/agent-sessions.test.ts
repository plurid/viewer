import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { AgentSessions } from '../src/desktop/agents/sessions';
import { temporaryRoot } from '../tools/temporary';

it('namespaces sessions by authenticated client, preserves message IDs and sequence, and restores without replay', async () => {
  const root = await realpath(await temporaryRoot('viewer-session-reports-'));
  const directory = path.join(root, 'Checkout');
  await mkdir(directory);
  await writeFile(path.join(directory, 'source.txt'), 'Generated source\n');
  const changed: string[] = [];
  const sessions = new AgentSessions(root, (id) => changed.push(id));
  const report = {
    sessionID: 'same-external-id',
    title: 'Task',
    directory,
    sequence: 1,
    status: 'working' as const,
    entries: [
      {
        id: 'a',
        role: 'assistant' as const,
        text: 'Starting.',
        links: [{ kind: 'file' as const, path: path.join(directory, 'source.txt') }],
      },
    ],
  };
  const first = await sessions.report('client-one', 'Client one', report, realpath);
  const second = await sessions.report('client-two', 'Client two', report, realpath);
  expect(first.id).not.toBe(second.id);
  expect((await sessions.report('client-one', 'Client one', report, realpath)).id).toBe(first.id);
  expect(changed).toHaveLength(2);
  await expect(
    sessions.report('client-one', 'Client one', { ...report, status: 'failed' }, realpath),
  ).rejects.toThrow('newer');
  await expect(
    sessions.report(
      'client-one',
      'Client one',
      { ...report, sequence: 2, entries: [{ id: 'a', role: 'assistant', text: 'Rewritten' }] },
      realpath,
    ),
  ).rejects.toThrow('rewritten');
  await sessions.report(
    'client-one',
    'Client one',
    {
      ...report,
      sequence: 2,
      status: 'done',
      entries: [{ id: 'b', role: 'assistant', text: 'Finished.' }],
    },
    realpath,
  );
  const reopened = new AgentSessions(root, () => {
    throw new Error('No report should replay.');
  });
  expect(await reopened.request({ kind: 'read', id: first.id })).toMatchObject({
    session: {
      clientID: 'client-one',
      status: 'done',
      sequence: 2,
      entries: [{ id: 'a' }, { id: 'b' }],
    },
  });
  const list = await reopened.request({ kind: 'list', directory });
  expect(list.kind === 'list' && list.sessions).toHaveLength(2);
  expect(list.kind === 'list' && list.sessions[0]).not.toHaveProperty('entries');
});

it('evicts the least recently updated finished session at 100 while refusing when 100 are active', async () => {
  const root = await realpath(await temporaryRoot('viewer-session-limit-'));
  const directory = path.join(root, 'Checkout');
  await mkdir(directory);
  const changed: string[] = [];
  const sessions = new AgentSessions(root, (id) => changed.push(id));
  const ids: string[] = [];
  for (let index = 1; index <= 100; index++) {
    const saved = await sessions.report(
      'client-one',
      'Client one',
      {
        sessionID: `finished-${index}`,
        title: `Finished ${index}`,
        directory,
        sequence: 1,
        status: index === 1 ? 'failed' : 'done',
        entries: [{ id: 'a', role: 'assistant', text: `Done ${index}.` }],
      },
      realpath,
    );
    ids.push(saved.id);
  }
  const extra = await sessions.report(
    'client-one',
    'Client one',
    {
      sessionID: 'finished-101',
      title: 'Finished 101',
      directory,
      sequence: 1,
      status: 'working',
      entries: [{ id: 'a', role: 'assistant', text: 'New work.' }],
    },
    realpath,
  );
  expect(extra.title).toBe('Finished 101');
  const list = await sessions.request({ kind: 'list' });
  expect(list.kind === 'list' && list.sessions).toHaveLength(100);
  await expect(sessions.request({ kind: 'read', id: ids[0]! })).rejects.toThrow('no record');
  expect(changed).toContain(ids[0]);

  const activeRoot = await realpath(await temporaryRoot('viewer-session-active-limit-'));
  const activeSessions = new AgentSessions(activeRoot, () => {});
  for (let index = 1; index <= 100; index++)
    await activeSessions.report(
      'client-one',
      'Client one',
      {
        sessionID: `active-${index}`,
        title: `Active ${index}`,
        directory,
        sequence: 1,
        status: index % 2 === 0 ? 'waiting' : 'working',
        entries: [{ id: 'a', role: 'assistant', text: 'Active.' }],
      },
      realpath,
    );
  await expect(
    activeSessions.report(
      'client-one',
      'Client one',
      {
        sessionID: 'active-101',
        title: 'Active 101',
        directory,
        sequence: 1,
        status: 'working',
        entries: [{ id: 'a', role: 'assistant', text: 'Too many.' }],
      },
      realpath,
    ),
  ).rejects.toThrow('100');
});
