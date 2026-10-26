import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CommandReceipts } from '../src/desktop/actions/receipts';
import type { ExecutionTask } from '../src/domain/automation/actions';
import { receiptMarkdown } from '../src/domain/automation/receipts';
import { temporaryRoot } from '../tools/temporary';
it('coalesces output, preserves final process evidence privately and reopens it after restart', async () => {
  const root = await temporaryRoot('viewer-command-receipts-'),
    service = new CommandReceipts(root),
    id = randomUUID();
  const task: ExecutionTask = {
    id,
    title: 'Generated command',
    command: 'printf first && printf second',
    directory: root,
    folderIdentity: '1:2',
    status: 'running',
    output: 'first',
    started: 1000,
    workspaceID: 'space',
    paneID: 'folder',
  };
  const first = service.record(task),
    second = service.record({
      ...task,
      output: 'firstsecond',
      status: 'completed',
      exitCode: 0,
      ended: 1100,
    });
  await Promise.all([first, second]);
  await service.flush();
  const file = path.join(root, 'command-receipts', id + '.json');
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  const reopened = new CommandReceipts(root),
    reply = await reopened.request({ kind: 'read', id });
  expect(reply).toMatchObject({
    kind: 'receipt',
    receipt: {
      output: 'firstsecond',
      command: task.command,
      status: 'completed',
      exitCode: 0,
      ended: 1100,
      folderIdentity: '1:2',
    },
  });
  const summary = await reopened.request({ kind: 'summary', id });
  expect(summary.kind === 'summary' && 'command' in summary.receipt).toBe(false);
  expect(summary.kind === 'summary' && 'output' in summary.receipt).toBe(false);
  expect((await readFile(file, 'utf8')).includes('firstsecond')).toBe(true);
});
it('reports unfinished work as interrupted without changing or replaying the recorded command', async () => {
  const root = await temporaryRoot('viewer-command-interrupted-'),
    service = new CommandReceipts(root),
    id = randomUUID();
  await service.record({
    id,
    title: 'Running',
    command: 'generated command',
    status: 'running',
    output: 'partial',
    directory: root,
    started: 1000,
    workspaceID: 'space',
    paneID: 'folder',
  });
  await service.flush();
  const file = path.join(root, 'command-receipts', id + '.json'),
    before = await readFile(file);
  const reopened = new CommandReceipts(root);
  expect(await reopened.request({ kind: 'read', id })).toMatchObject({
    receipt: { status: 'interrupted', error: expect.stringContaining('not replayed') },
  });
  expect(await readFile(file)).toEqual(before);
  expect(await reopened.request({ kind: 'list' })).toMatchObject({
    kind: 'list',
    receipts: [{ status: 'interrupted' }],
  });
});
it('refuses linked receipt data without reading or replacing its target', async () => {
  const root = await temporaryRoot('viewer-command-linked-'),
    service = new CommandReceipts(root),
    id = randomUUID();
  await service.record({
    id,
    title: 'Done',
    command: 'generated',
    status: 'completed',
    output: '',
    directory: root,
    started: 1,
    workspaceID: 'space',
    paneID: 'folder',
  });
  const target = path.join(root, 'private-source'),
    aliasID = randomUUID();
  await writeFile(target, 'retained secret');
  await symlink(target, path.join(root, 'command-receipts', aliasID + '.json'));
  await expect(new CommandReceipts(root).request({ kind: 'read', id: aliasID })).rejects.toThrow();
  expect(await readFile(target, 'utf8')).toBe('retained secret');
});
it('exports command and output as literal fenced data even when they contain Markdown or HTML', () => {
  const text = receiptMarkdown({
    id: randomUUID(),
    title: 'Literal',
    command: 'printf "````"',
    status: 'completed',
    output: '<script>not executable</script>\n```\ntext',
    directory: '/a *literal* folder',
    started: 0,
    ended: 0,
    exitCode: 0,
    workspaceID: 'space',
    paneID: 'folder',
  });
  expect(text).toContain('`````sh\nprintf "````"\n`````');
  expect(text).toContain('````\n<script>not executable</script>\n```\ntext\n````');
  expect(text).toContain('Ended: 1970-01-01T00:00:00.000Z');
});
