import { describe, expect, it, vi } from 'vitest';
import { PassThrough, Readable, Writable } from 'node:stream';
import path from 'node:path';
import { parseCLI } from '../src/domain/cli/arguments';
import { cliCommands, isCLIInvocation } from '../src/domain/cli/catalog';
import { cliCompletion, cliHelp } from '../src/domain/cli/help';
import { runCLI } from '../src/desktop/cli/run';
import { CLIConnectionError, type CLICall } from '../src/desktop/cli/client';

const resolve = (file: string) => path.resolve('/work/project', file);
const wrap = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
async function invoke(
  args: string[],
  options: {
    call?: CLICall;
    token?: string;
    input?: string;
    stream?: Readable;
    signal?: AbortSignal;
  } = {},
) {
  const { input: textInput, stream, ...ports } = options;
  let stdout = '',
    stderr = '';
  const output = new Writable({
    write(chunk, _encoding, done) {
      stdout += String(chunk);
      done();
    },
  });
  const error = new Writable({
    write(chunk, _encoding, done) {
      stderr += String(chunk);
      done();
    },
  });
  const code = await runCLI(args, {
    dataPath: '/private/generated-profile',
    version: '0.1.0',
    cwd: '/work/project',
    home: '/people/example',
    input: stream ?? Readable.from(textInput ? [textInput] : []),
    output,
    error,
    ...ports,
  });
  return { code, stdout, stderr };
}

describe('terminal command contract', () => {
  it('returns the completed task workflow as JSON and preserves partial failures for recovery', async () => {
    const parameters = [
      'task',
      'create',
      'Fix search',
      '--branch',
      'fix/search',
      '--path',
      '../search',
      '--workspace',
      'project',
      '--wait',
      '--json',
    ];
    const taskResult = {
      workspaceID: 'project',
      taskID: 'reserved-task',
      path: '/work/search',
      branch: 'fix/search',
      commit: 'a'.repeat(40),
      terminal: 'stopped',
      stage: 'ready',
    };
    const call = vi.fn<CLICall>(async (_method, params) => {
      if ((params as { name?: string } | undefined)?.name === 'propose_task_create') {
        expect((params as { arguments: unknown }).arguments).toEqual({
          name: 'Fix search',
          repo: '/work/project',
          branch: 'fix/search',
          path: '/work/search',
          workspace: 'project',
        });
        return wrap({ id: 'proposal', requiresUserReview: true });
      }
      return wrap({ id: 'proposal', status: 'completed', taskResult });
    });
    const completed = await invoke(parameters, { call });
    expect(completed.code).toBe(0);
    expect(JSON.parse(completed.stdout)).toMatchObject({
      ok: true,
      command: 'task create',
      result: { status: 'completed', taskResult },
    });
    expect(completed.stderr).toBe('');
    call.mockImplementation(async (_method, params) =>
      (params as { name?: string } | undefined)?.name === 'propose_task_create'
        ? wrap({ id: 'proposal' })
        : wrap({
            id: 'proposal',
            status: 'failed',
            error: 'Workspace closed',
            taskResult: { ...taskResult, stage: 'worktree-created' },
          }),
    );
    const failed = await invoke(parameters, { call });
    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({
      ok: false,
      operationID: 'proposal',
      result: { status: 'failed', taskResult: { path: '/work/search', stage: 'worktree-created' } },
    });
    expect(failed.stdout.trim().split('\n')).toHaveLength(1);
  });
  it('keeps legacy launch paths and explicit literal paths outside automation mode', () => {
    for (const args of [[], ['.'], ['./notes.md'], ['--new-window', '.'], ['--', 'search']])
      expect(isCLIInvocation(args)).toBe(false);
    for (const args of [
      ['--help'],
      ['--json', 'workspace', 'list'],
      ['--timeout=500', 'status'],
      ['search', 'report'],
    ])
      expect(isCLIInvocation(args)).toBe(true);
  });
  it('resolves paths once and accepts global options before or after a command', () => {
    const before = parseCLI(
      ['--json', '--timeout=500', 'search', 'a report', '--root', '../files', '--content'],
      resolve,
    );
    const after = parseCLI(
      ['search', 'a report', '--root', '../files', '--content', '--json', '--timeout', '500'],
      resolve,
    );
    expect(before).toEqual(after);
    expect(before).toMatchObject({
      json: true,
      timeout: 500,
      parameters: { query: 'a report', root: '/work/files', content: true, offset: 0 },
    });
    expect(parseCLI(['search', 'report'], resolve).parameters.content).toBe(false);
  });
  it('keeps JSON values, multiple source paths and literal option-like filenames intact', () => {
    const request = parseCLI(
      [
        'export',
        '--destination',
        './out',
        '--plan',
        '{"kind":"image","format":"png"}',
        '--name',
        'Preview.png',
        '--',
        '-report.png',
        'Résumé.png',
      ],
      resolve,
    );
    expect(request.parameters).toMatchObject({
      destination: '/work/project/out',
      sources: ['/work/project/-report.png', '/work/project/Résumé.png'],
      plan: { kind: 'image', format: 'png' },
    });
    expect(parseCLI(['inspect', '--', '--version'], resolve).parameters.path).toBe(
      '/work/project/--version',
    );
    expect(parseCLI(['ask', '--', '-v'], resolve).parameters.prompt).toBe('-v');
    expect(
      parseCLI(['action', 'run', 'recipe', '.', '--instructions', '--help'], resolve),
    ).toMatchObject({ kind: 'request', parameters: { instructions: '--help' } });
    expect(() => parseCLI(['ask', 'é'.repeat(32769)], resolve)).toThrow('argument limits');
  });
  it.each([
    ['search', 'report', '--unknown'],
    ['search', 'report', '--offset', '-1'],
    ['search', 'report', '--offset', '1.2'],
    ['search', 'report', '--json=false'],
    ['search', 'report', '--json', '--json'],
    ['plane', 'open', '.', '--placement', 'other'],
    ['config', 'validate', 'not-json'],
    ['tools', 'call'],
    ['git', 'diff', '--timeout', '0'],
  ])('rejects invalid input without invoking a service: %j', async (...args) => {
    const call = vi.fn<CLICall>();
    expect((await invoke(args, { call })).code).toBe(2);
    expect(call).not.toHaveBeenCalled();
  });
  it('generates help and completions from the command catalog', () => {
    expect(cliHelp(['export'])).toContain('--plan');
    for (const shell of ['bash', 'zsh', 'fish']) {
      const script = cliCompletion(shell);
      for (const root of new Set(cliCommands.map((command) => command.name[0])))
        expect(script).toContain(root);
      for (const command of cliCommands)
        for (const option of command.options ?? []) expect(script).toContain(option.name);
    }
    expect(parseCLI(['completion', '--help'], resolve).kind).toBe('help');
  });
});

describe('headless command results', () => {
  it('prints help and version without credentials or a running app', async () => {
    expect(await invoke(['--version', '--json'])).toMatchObject({ code: 0, stderr: '' });
    const help = await invoke(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('workspace list');
    expect(help.stdout).toContain('Settings → Agents');
  });
  it('returns one JSON result and sends literal parameters to the existing tool protocol', async () => {
    const call = vi.fn<CLICall>(async () =>
      wrap({ entries: [{ path: '/work/project/Résumé.pdf' }] }),
    );
    const result = await invoke(['--json', 'search', 'invoice OR receipt', '--content'], { call });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      result: { entries: [{ path: '/work/project/Résumé.pdf' }] },
    });
    expect(call).toHaveBeenCalledWith(
      'tools/call',
      {
        name: 'search_files',
        arguments: { query: 'invoice OR receipt', root: '/work/project', offset: 0, content: true },
      },
      expect.any(AbortSignal),
    );
  });
  it('reads a bounded JSON request from stdin without treating it as shell input', async () => {
    const call = vi.fn<CLICall>(async () => wrap({ valid: true }));
    const result = await invoke(['config', 'validate', '-', '--json'], {
      call,
      input: '[{"path":"ui.space.grid","value":false}]',
    });
    expect(result.code).toBe(0);
    expect(call.mock.calls[0]?.[1]).toEqual({
      name: 'validate_config',
      arguments: { patches: [{ path: 'ui.space.grid', value: false }] },
    });
    expect(
      (await invoke(['config', 'validate', '-'], { call, input: ' '.repeat(65537) })).code,
    ).toBe(2);
  });
  it('reports missing credentials and connection failures with distinct exit codes', async () => {
    const missing = await invoke(['workspace', 'list', '--json']);
    expect(missing.code).toBe(4);
    // the documented failure shape, with the exit code as its code
    expect(JSON.parse(missing.stdout)).toEqual({
      ok: false,
      error: {
        code: 4,
        message:
          'Set VIEWER_AGENT_TOKEN to a named client token from Settings → Agents. Grant only the folders and capabilities needed.',
      },
    });
    const result = await invoke(['workspace', 'list', '--json'], {
      call: async () => {
        throw new CLIConnectionError('Open Viewer first.');
      },
    });
    expect(result.code).toBe(3);
    expect(JSON.parse(result.stdout).error.message).toBe('Open Viewer first.');
  });
  it('keeps a proposal pending until the user completes it and preserves the operation ID on timeout', async () => {
    const call = vi.fn<CLICall>(async (_method, params) => {
      const tool = (params as { name: string }).name;
      return wrap(
        tool === 'propose_command'
          ? { id: 'review-1', requiresUserReview: true }
          : { id: 'review-1', status: 'review' },
      );
    });
    const result = await invoke(
      ['command', 'run', 'frame-all', '--wait', '--timeout', '100', '--json'],
      { call },
    );
    expect(result.code).toBe(124);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, operationID: 'review-1' });
    expect(
      call.mock.calls.every(([, params]) =>
        ['propose_command', 'get_proposal'].includes((params as { name: string }).name),
      ),
    ).toBe(true);
  });
  it('returns an explicit cancellation result', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await invoke(['workspace', 'list', '--json'], {
      signal: controller.signal,
      call: async (_method, _params, signal) => {
        signal.throwIfAborted();
        return {};
      },
    });
    expect(result.code).toBe(130);
  });
  it('does not wait for stdin when cancellation happened before input started', async () => {
    const stream = new PassThrough(),
      controller = new AbortController();
    const call = vi.fn<CLICall>();
    controller.abort();
    try {
      expect(
        (
          await invoke(['config', 'validate', '-', '--json'], {
            stream,
            signal: controller.signal,
            call,
          })
        ).code,
      ).toBe(130);
      expect(call).not.toHaveBeenCalled();
    } finally {
      stream.destroy();
    }
  });
});
