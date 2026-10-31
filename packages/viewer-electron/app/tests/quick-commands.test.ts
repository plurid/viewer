import { afterEach, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Executions } from '../src/desktop/actions/executions';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from '../tools/temporary';
import { agentCommandID, modelLineCommandProblem } from '../src/domain/agents/safety';
import { methodWindows, schemas } from '../src/desktop/ipc/schemas';
import { settingsSchema } from '../src/desktop/preferences/settings-schema';

const services: Executions[] = [];
it('loads existing shell settings with startup enabled and preserves an explicit opt-out', () => {
  const settings = defaultSettings('/fixtures');
  expect(
    settingsSchema.parse({
      ...settings,
      terminals: { ...settings.terminals, commandStartup: undefined },
    }).terminals.commandStartup,
  ).toBe('interactive');
  settings.terminals.commandStartup = 'profile';
  expect(settingsSchema.parse(settings).terminals.commandStartup).toBe('profile');
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});
async function fixture() {
  const root = await temporaryRoot('viewer-quick-command-');
  const directory = path.join(root, "folder ' $(literal)");
  await mkdir(directory);
  const settings = defaultSettings(directory);
  settings.terminals.profiles = [
    {
      id: 'test',
      name: 'Test shell',
      executable: '/bin/sh',
      args: [],
      env: { VIEWER_QUICK_FIXTURE: 'value' },
    },
  ];
  settings.terminals.profileID = 'test';
  const confirmAction = vi.fn(async () => {}),
    confirmProfile = vi.fn(async () => {});
  const service = new Executions(
    () => settings,
    () => {},
    undefined,
    confirmAction,
    confirmProfile,
  );
  services.push(service);
  const target = {
    workspaceID: 'workspace',
    rootID: 'root',
    paneID: 'folder',
    directory,
    selection: [],
  };
  return { service, target, settings, root, confirmAction, confirmProfile };
}
it.skipIf(!existsSync('/bin/zsh'))(
  'loads zsh aliases from the configured startup folder and allows profile-only commands',
  async () => {
    const { service, target, settings, root } = await fixture();
    await writeFile(path.join(root, '.zshrc'), "alias ll='printf alias-loaded'\n");
    const profile = settings.terminals.profiles[0];
    profile.executable = '/bin/zsh';
    profile.args = ['-l'];
    profile.env = { HOME: root, ZDOTDIR: root };
    await service.startManual('ll', target, 1);
    await vi.waitFor(() => expect(service.list(1)[0].status).toBe('completed'));
    expect(service.list(1)[0]).toMatchObject({ exitCode: 0, output: 'alias-loaded' });

    settings.terminals.commandStartup = 'profile';
    await service.startManual('ll', target, 1);
    await vi.waitFor(() => expect(service.list(1)[1].status).toBe('failed'));
    expect(service.list(1)[1]).toMatchObject({ exitCode: 127 });

    profile.args.push('-i');
    await service.startManual('ll', target, 1);
    await vi.waitFor(() => expect(service.list(1)[2].status).toBe('completed'));
    expect(service.list(1)[2].output).toBe('alias-loaded');

    settings.terminals.commandStartup = 'interactive';
    for (const argument of ['+i', '-f']) {
      profile.args = ['-l', argument];
      const id = await service.startManual('ll', target, 1);
      await vi.waitFor(() =>
        expect(service.list(1).find((task) => task.id === id)?.status).toBe('failed'),
      );
      expect(service.list(1).find((task) => task.id === id)?.exitCode).toBe(127);
    }
  },
);
it('runs an explicitly submitted shell command in its captured folder without an action confirmation', async () => {
  const { service, target, confirmAction, confirmProfile } = await fixture();
  const id = await service.startManual(
    'pwd; printf "%s" "$VIEWER_QUICK_FIXTURE" | tr a-z A-Z; git init -q',
    target,
    1,
  );
  await vi.waitFor(() => expect(service.list(1)[0].status).toBe('completed'));
  const task = service.list(1)[0];
  expect(task.id).toBe(id);
  expect(task.output).toContain(target.directory);
  expect(task.output).toContain('VALUE');
  expect(task.exitCode).toBe(0);
  expect(task.ended).toBeGreaterThanOrEqual(task.started!);
  expect(confirmAction).not.toHaveBeenCalled();
  expect(confirmProfile).toHaveBeenCalledOnce();
  expect(service.list(2)).toEqual([]);
});
it('keeps failures and bounded output, and prevents another window from cancelling a run', async () => {
  const { service, target } = await fixture();
  await service.startManual('printf error >&2; exit 7', target, 1);
  await vi.waitFor(() => expect(service.list(1)[0].status).toBe('failed'));
  expect(service.list(1)[0]).toMatchObject({ exitCode: 7, output: 'error' });
  const id = await service.startManual('yes x | head -c 400000; sleep 30', target, 1);
  await vi.waitFor(() => expect(service.list(1)[1].truncated).toBe(true));
  expect(Buffer.byteLength(service.list(1)[1].output)).toBe(256 * 1024);
  expect(() => service.cancel(id, 2)).toThrow('another window');
  service.cancel(id, 1);
  await vi.waitFor(() => expect(service.list(1)[1].ended).toBeDefined());
  expect(service.list(1)[1].status).toBe('cancelled');
});
it('rejects invalid scripts and keeps manual execution out of agents, aliases and model lines', async () => {
  const { service, target } = await fixture();
  await expect(service.startManual('bad\0command', target, 1)).rejects.toThrow('null');
  await expect(service.startManual('x'.repeat(16001), target, 1)).rejects.toThrow('16 KB');
  expect(() => agentCommandID('run-command', [])).toThrow();
  expect(modelLineCommandProblem('run-command', [])).toBeTruthy();
  expect(methodWindows.runCommand).toBe('viewer');
  expect(
    schemas.runCommand.safeParse(['git init', { ...target, executable: '/bin/sh' }]).success,
  ).toBe(false);
});
it('stops commands owned by a closing window while another window keeps running', async () => {
  const { service, target } = await fixture();
  const first = await service.startManual('sleep 30', target, 1);
  const second = await service.startManual('sleep 30', target, 2);
  service.stopOwner(1);
  await vi.waitFor(() => expect(service.list(1)[0].ended).toBeDefined());
  expect(service.list(1)[0]).toMatchObject({ id: first, status: 'cancelled' });
  expect(service.list(2)[0]).toMatchObject({ id: second, status: 'running' });
});
