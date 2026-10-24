import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GitActions,
  gitActionEnvironment,
  type GitActionsOptions,
  type GitTerminalLaunch,
} from '../src/desktop/comparison/git-actions';
import { entry } from '../src/desktop/files/filesystem';
import { runGit, type GitRunner } from '../src/desktop/comparison/git';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { GitActionRequest } from '../src/domain/comparison/git-actions';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const execute = promisify(execFile);
const roots: string[] = [];
const services: GitActions[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  for (const root of roots.splice(0)) await trashTemporary(root);
});

async function fixture(name = 'repository') {
  const holder = await temporaryRoot('viewer-git-actions-');
  roots.push(holder);
  const root = path.join(holder, name);
  await mkdir(root);
  const env = {
    PATH: '/usr/bin:/bin',
    HOME: holder,
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };
  const git = (...args: string[]) => execute('/usr/bin/git', ['-C', root, ...args], { env });
  await git('init', '--initial-branch=main');
  await git('config', 'core.hooksPath', '/dev/null');
  await git('config', 'core.fsmonitor', 'false');
  await git('config', 'commit.gpgSign', 'false');
  await git('config', 'user.name', 'Viewer fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(root, 'tracked.txt'), 'original\n');
  await git('add', '--', 'tracked.txt');
  await git('commit', '-m', 'Fixture baseline');
  const target: CapturedTarget = {
    workspaceID: 'workspace',
    rootID: 'folder-root',
    paneID: 'folder',
    originID: 'window-origin',
    directory: root,
    panePath: root,
    selection: [],
  };
  const launch = vi.fn(async (_program: GitTerminalLaunch, _owner: number) => {});
  const readGit = vi.fn<GitRunner>(runGit);
  const validateTarget = vi.fn(async (_owner: number, _target: CapturedTarget) => {});
  const access = vi.fn(async (_paths: readonly string[]) => {});
  const options: GitActionsOptions = {
    direct: true,
    access,
    validateTarget,
    readGit,
    launch,
    environment: () => env,
  };
  const service = new GitActions(options);
  services.push(service);
  const request = (
    kind: Exclude<GitActionRequest['kind'], 'commit'>,
    id = 'git-job',
  ): GitActionRequest => ({ id, kind, target });
  const program = () => {
    const last = launch.mock.calls.at(-1);
    if (!last) throw new Error('Expected a compiled Git launch.');
    return last[0];
  };
  const run = (program: GitTerminalLaunch) =>
    execute(program.executable, program.args, { cwd: root, env: program.env });
  return {
    holder,
    root,
    env,
    git,
    target,
    launch,
    readGit,
    validateTarget,
    access,
    options,
    service,
    request,
    program,
    run,
  };
}

describe('fixed human Git actions', () => {
  it('preserves spaces and embedded newlines in repository paths', async () => {
    const f = await fixture('a repository\nwith spaces');
    const reply = await f.service.start(f.request('status'), 7);
    expect(reply.root).toBe(f.program().request.cwd);
    expect(reply.root.endsWith('/a repository\nwith spaces')).toBe(true);
    expect((await f.run(f.program())).stdout).toContain('main');
  });
  it('does no probing in the store build and requires window-target validation', async () => {
    const access = vi.fn();
    const validateTarget = vi.fn(async () => {
      throw new Error('Window target changed');
    });
    const launch = vi.fn();
    const options: GitActionsOptions = {
      direct: false,
      access,
      validateTarget,
      launch,
    };
    const service = new GitActions(options);
    services.push(service);
    const request = {
      id: 'job',
      kind: 'status',
      target: { directory: '/not-a-repository' },
    } as GitActionRequest;
    await expect(service.start(request, 7)).rejects.toThrow('direct build');
    expect(access).not.toHaveBeenCalled();
    expect(validateTarget).not.toHaveBeenCalled();
    options.direct = true;
    await expect(service.start(request, 7)).rejects.toThrow('Window target changed');
    expect(validateTarget).toHaveBeenCalledWith(7, request.target);
    expect(access).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it('hardens status and history independently of the badge opt-in and preserves the index', async () => {
    const f = await fixture();
    await f.git('config', 'core.fsmonitor', '/a-monitor-that-must-never-start');
    await writeFile(path.join(f.root, 'tracked.txt'), 'edited\n');
    const index = path.join(f.root, '.git', 'index');
    const before = await readFile(index);
    const modified = (await stat(index)).mtimeMs;
    for (const kind of ['status', 'log'] as const) {
      await f.service.start(f.request(kind, kind), 4);
      const program = f.program();
      expect(program.args).toEqual(
        expect.arrayContaining([
          '--no-pager',
          '--no-optional-locks',
          'core.fsmonitor=false',
          'core.hooksPath=/dev/null',
          'credential.helper=',
          'protocol.allow=never',
          'color.ui=false',
        ]),
      );
      expect(program.outputLimit).toBe(256 * 1024);
      expect(program.timeoutMs).toBe(15000);
      expect(program.env).toMatchObject({
        GIT_TERMINAL_PROMPT: '0',
        GIT_NO_LAZY_FETCH: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
      });
      const output = await f.run(program);
      expect(output.stdout).toContain(kind === 'status' ? 'tracked.txt' : 'Fixture baseline');
    }
    expect(await readFile(index)).toEqual(before);
    expect((await stat(index)).mtimeMs).toBe(modified);
    expect(f.validateTarget.mock.calls).toEqual([
      [4, f.target],
      [4, f.target],
      [4, f.target],
      [4, f.target],
    ]);
  });

  it('stages literal selected names without expanding pathspecs or shell syntax', async () => {
    const f = await fixture();
    const names = ['--force', ':(glob)*', 'two words\nand a tab\t.txt', '$(touch marker).txt'];
    for (const name of [...names, 'leave-untracked.txt'])
      await writeFile(path.join(f.root, name), name);
    f.target.selection = await Promise.all(names.map((name) => entry(path.join(f.root, name))));
    await f.service.start(f.request('stage-selected'), 5);
    const program = f.program();
    expect(program.args.slice(-names.length - 2)).toEqual(['add', '--', ...names]);
    expect(program.args).toContain('--literal-pathspecs');
    expect(f.launch).toHaveBeenCalledOnce();
    await f.run(program);
    const staged = (await f.git('diff', '--cached', '--name-only', '-z')).stdout
      .split('\0')
      .filter(Boolean);
    expect(staged.sort()).toEqual([...names].sort());
    expect((await f.git('ls-files', '--others', '--exclude-standard')).stdout).toBe(
      'leave-untracked.txt\n',
    );
  });

  it('commits only staged content and preserves the literal message', async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, 'staged.txt'), 'staged\n');
    await f.git('add', '--', 'staged.txt');
    await writeFile(path.join(f.root, 'tracked.txt'), 'leave this edit unstaged\n');
    const message = 'literal $(touch marker) "quotes"\n\nsecond paragraph';
    await f.service.start({ id: 'commit-job', kind: 'commit', message, target: f.target }, 6);
    const program = f.program();
    expect(program.args.slice(-3)).toEqual(['commit', '-m', message]);
    expect(program.args).not.toContain('--all');
    await f.run(program);
    expect((await f.git('log', '-1', '--format=%B')).stdout.trimEnd()).toBe(message);
    expect((await f.git('status', '--porcelain')).stdout).toBe(' M tracked.txt\n');
  });

  it('pushes only the exact upstream branch despite matching, mirror and tag defaults', async () => {
    const f = await fixture();
    const remote = path.join(f.holder, 'local-remote.git');
    await execute('/usr/bin/git', ['init', '--bare', '--initial-branch=main', remote], {
      env: f.env,
    });
    await execute('/usr/bin/git', ['--git-dir', remote, 'config', 'core.hooksPath', '/dev/null'], {
      env: f.env,
    });
    await f.git('remote', 'add', 'origin', remote);
    await f.git('push', '--set-upstream', 'origin', 'HEAD:refs/heads/main');
    await f.git('branch', 'keep-local');
    await f.git('tag', 'keep-local-tag');
    await f.git('config', 'push.default', 'matching');
    await f.git('config', 'push.followTags', 'true');
    await f.git('config', 'remote.origin.push', 'refs/heads/keep-local:refs/heads/keep-local');
    await f.git('config', 'remote.origin.mirror', 'true');
    await f.service.start(f.request('push'), 8);
    const program = f.program();
    expect(program.args.slice(-9)).toEqual([
      'push',
      '--porcelain',
      '--no-force',
      '--no-mirror',
      '--no-follow-tags',
      '--recurse-submodules=no',
      '--',
      'origin',
      'HEAD:refs/heads/main',
    ]);
    await f.run(program);
    const refs = await execute(
      '/usr/bin/git',
      ['--git-dir', remote, 'for-each-ref', '--format=%(refname)'],
      { env: f.env },
    );
    expect(refs.stdout).toBe('refs/heads/main\n');
  });

  it('pins fast-forward-only pull to the upstream and refuses a divergent local fixture', async () => {
    const f = await fixture();
    const remote = path.join(f.holder, 'local-remote.git');
    await execute('/usr/bin/git', ['init', '--bare', '--initial-branch=main', remote], {
      env: f.env,
    });
    await execute('/usr/bin/git', ['--git-dir', remote, 'config', 'core.hooksPath', '/dev/null'], {
      env: f.env,
    });
    await f.git('remote', 'add', 'origin', remote);
    await f.git('push', '--set-upstream', 'origin', 'HEAD:refs/heads/main');
    const writer = path.join(f.holder, 'writer');
    await execute('/usr/bin/git', ['clone', '--', remote, writer], { env: f.env });
    const other = (...args: string[]) =>
      execute(
        '/usr/bin/git',
        [
          '-C',
          writer,
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'commit.gpgSign=false',
          '-c',
          'user.name=Viewer fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        { env: f.env },
      );
    await writeFile(path.join(writer, 'remote-new.txt'), 'remote\n');
    await other('add', '--', 'remote-new.txt');
    await other('commit', '-m', 'Remote change');
    await other('push', 'origin', 'HEAD:refs/heads/main');
    await writeFile(path.join(f.root, 'local-new.txt'), 'local\n');
    await f.git('add', '--', 'local-new.txt');
    await f.git('commit', '-m', 'Local change');
    const before = (await f.git('rev-parse', 'HEAD')).stdout;
    await f.service.start(f.request('pull'), 8);
    const program = f.program();
    expect(program.args.slice(-9)).toEqual([
      'pull',
      '--ff-only',
      '--no-rebase',
      '--no-squash',
      '--no-autostash',
      '--recurse-submodules=no',
      '--',
      'origin',
      'refs/heads/main',
    ]);
    await expect(f.run(program)).rejects.toThrow(/fast-forward|fast forward/i);
    expect((await f.git('rev-parse', 'HEAD')).stdout).toBe(before);
    expect((await f.git('status', '--porcelain')).stdout).toBe('');
    await expect(stat(path.join(f.root, '.git', 'MERGE_HEAD'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('Git preparation and lifetime binding', () => {
  it('rejects missing upstreams and invalid messages before launch', async () => {
    const f = await fixture();
    for (const kind of ['push', 'pull'] as const)
      await expect(f.service.start(f.request(kind, kind), 3)).rejects.toThrow('upstream');
    for (const message of ['', '\0hidden', '🙂'.repeat(4001)])
      await expect(
        f.service.start({ id: 'commit', kind: 'commit', target: f.target, message }, 3),
      ).rejects.toThrow(/message/i);
    await expect(f.service.start({ ...f.request('status'), cols: Infinity }, 3)).rejects.toThrow(
      'columns',
    );
    expect(f.launch).not.toHaveBeenCalled();
  });

  it.each(['index', 'configuration', 'selection'] as const)(
    'rejects changed %s across asynchronous preparation',
    async (changed) => {
      const f = await fixture();
      const selected = path.join(f.root, 'selected.txt');
      await writeFile(selected, 'before\n');
      f.target.selection = [await entry(selected)];
      f.validateTarget.mockImplementationOnce(async () => {});
      f.validateTarget.mockImplementationOnce(async () => {
        if (changed === 'index') await f.git('add', '--', 'selected.txt');
        else if (changed === 'configuration') await f.git('config', 'viewer.fixture', 'changed');
        else await writeFile(selected, 'changed during preparation\n');
      });
      await expect(f.service.start(f.request('stage-selected'), 10)).rejects.toThrow(/changed/i);
      expect(f.launch).not.toHaveBeenCalled();
    },
  );

  it('revalidates the originating window and captured folder after asynchronous preparation', async () => {
    const f = await fixture();
    f.validateTarget.mockImplementation(async (owner) => {
      if (owner !== 12 || f.validateTarget.mock.calls.length > 1)
        throw new Error('The workspace changed during preparation.');
    });
    await expect(f.service.start(f.request('stage-all'), 12)).rejects.toThrow('workspace changed');
    expect(f.validateTarget).toHaveBeenCalledTimes(2);
    expect(f.launch).not.toHaveBeenCalled();
  });

  it('refuses paths outside the captured repository', async () => {
    const f = await fixture();
    const outside = path.join(f.holder, 'outside.txt');
    await writeFile(outside, 'outside\n');
    f.target.selection = [await entry(outside)];
    await expect(f.service.start(f.request('stage-selected'), 2)).rejects.toThrow('outside');
    expect(f.launch).not.toHaveBeenCalled();
  });

  describe.each(['target validation', 'repository lookup'] as const)('pending %s', (phase) => {
    it.each(['plane', 'window', 'access', 'close'] as const)(
      'cancels on %s without waiting for lookup or launching late',
      async (reason) => {
        const f = await fixture();
        let release!: () => void;
        let entered = false;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        if (phase === 'target validation') {
          f.validateTarget.mockImplementationOnce(async () => {
            entered = true;
            await gate;
          });
        } else {
          f.readGit.mockImplementationOnce(async (...args) => {
            entered = true;
            await gate;
            args[3].throwIfAborted();
            return runGit(...args);
          });
        }
        const pending = f.service.start(f.request('stage-all'), 12);
        const rejected = expect(pending).rejects.toThrow('cancelled');
        await vi.waitFor(() => expect(entered).toBe(true));
        if (reason === 'plane') f.service.stop('git-job', 12);
        else if (reason === 'window') f.service.stopOwner(12);
        else if (reason === 'access') await f.service.quiesce(f.root);
        else await f.service.close();
        await rejected;
        release();
        await Promise.resolve();
        expect(f.launch).not.toHaveBeenCalled();
      },
    );
  });

  it('deduplicates preparation and launch while preserving one-action ownership for the ID', async () => {
    const f = await fixture();
    const request = f.request('stage-all');
    const one = f.service.start(request, 12);
    const two = f.service.start(request, 12);
    expect(await one).toEqual(await two);
    expect(await f.service.start(request, 12)).toEqual(await one);
    expect(f.launch).toHaveBeenCalledOnce();
    expect(f.validateTarget).toHaveBeenCalledTimes(2);
    expect(f.readGit).toHaveBeenCalledTimes(6);
    await expect(f.service.start(f.request('status'), 12)).rejects.toThrow('another action');
  });

  it('removes inherited Git redirection and traces while preserving ordinary human auth transport', () => {
    const inherited = {
      PATH: '/usr/bin:/bin',
      SSH_AUTH_SOCK: '/fixture/agent',
      GIT_DIR: '/wrong',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'alias.x',
      GIT_CONFIG_VALUE_0: '!unsafe',
      GIT_WORK_TREE: '/wrong',
      GIT_TRACE: '/private-data',
      GIT_INDEX_FILE: '/wrong',
      GPG_TTY: '/wrong',
    };
    const mutation = gitActionEnvironment('push', inherited);
    expect(mutation).toMatchObject({
      SSH_AUTH_SOCK: '/fixture/agent',
      GIT_TERMINAL_PROMPT: '1',
      GIT_PAGER: 'cat',
    });
    for (const key of [
      'GIT_DIR',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
      'GIT_WORK_TREE',
      'GIT_TRACE',
      'GIT_INDEX_FILE',
      'GPG_TTY',
    ])
      expect(mutation).not.toHaveProperty(key);
    expect(gitActionEnvironment('log', inherited)).not.toHaveProperty('SSH_AUTH_SOCK');
  });
});
