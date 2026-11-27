import { describe, expect, it } from 'vitest';
import {
  parseDeclaredCommands,
  packageManager,
  declaredCommandLimits,
} from '../src/domain/terminals/declared-commands';
import type { DeclaredCommandFile } from '../src/domain/terminals/declared-commands';
import { validTerminalCommand, terminalCommandProblem } from '../src/domain/terminals/command-text';

describe('declared commands second round', () => {
  it('splits comma attributes outside quoted text', () => {
    const text = [
      '[no-cd, private]',
      'private:',
      '  secret',
      '[no-cd, confirm("Proceed, please?")]',
      'confirmation:',
      '  wait',
      '[linux, windows]',
      'other:',
      '  echo other',
      '[doc("private, confirm, linux"), macos]',
      'mac:',
      '  echo mac',
      '[doc("a ] bracket, inside"), private]',
      'bracket:',
      '  secret',
      '[no-cd, unix]',
      'dev:',
      '  serve',
    ].join('\n');
    expect(
      parseDeclaredCommands('justfile', text, [], { platform: 'darwin' }).map((item) => item.line),
    ).toEqual(['just mac', 'just dev']);
  });

  it('keeps inline Make recipes and validates their bodies', () => {
    expect(
      parseDeclaredCommands(
        'Makefile',
        'serve:;PORT=3000 node server.js\nbuild: ; CC=clang make all',
      ).map((item) => [item.line, item.detail]),
    ).toEqual([
      ['make serve', 'PORT=3000 node server.js'],
      ['make build', 'CC=clang make all'],
    ]);
    expect(parseDeclaredCommands('Makefile', 'serve:;echo \u200Bhidden')).toEqual([]);
    expect(parseDeclaredCommands('Makefile', 'serve: PORT = 3000')).toEqual([]);
  });

  it('hides lone lifecycle and manual hooks without their base scripts', () => {
    for (const name of ['postinstall', 'pretest', 'prestart', 'postrestart', 'poststop'])
      expect(
        parseDeclaredCommands('package.json', JSON.stringify({ scripts: { [name]: 'echo hook' } })),
      ).toEqual([]);
  });

  it.each([
    'echo ✔\uFE0F built',
    'echo ⚠\uFE0E check',
    'echo 👩\u200D💻',
    'echo 🏳\uFE0F\u200D🌈',
    'echo 👩🏽\u200D💻',
  ])('allows emoji presentation and joins in %j', (command) => {
    expect(validTerminalCommand(command)).toBe(true);
    expect(terminalCommandProblem(command)).toBeUndefined();
    expect(
      parseDeclaredCommands('package.json', JSON.stringify({ scripts: { done: command } }))[0]
        ?.line,
    ).toBe('npm run done');
  });

  it.each([
    '\uFE0F',
    'a\uFE0F',
    'a\uFE0E',
    '✔\uFE0F\uFE0F',
    'a\u200Db',
    '👩\u200Da',
    'a\u200D👩',
    '👩\u200D',
    '👩\u200C💻',
    '1\u200D2',
    '#\u200D*',
    '🏽\u200D💻',
    '✔\u{E0100}',
  ])('refuses unrelated or dangling invisible text in %j', (text) => {
    expect(validTerminalCommand('echo ' + text)).toBe(false);
    expect(terminalCommandProblem('echo ' + text)).toContain('invisible');
  });
});

describe('declared command review regressions', () => {
  it('keeps pre and post words while hiding actual sibling hooks and lifecycle hooks', () => {
    const scripts = Object.fromEntries(
      [
        'preview',
        'prettier',
        'postcss',
        'presentation',
        'deploy',
        'predeploy',
        'postdeploy',
        'preinstall',
        'install',
        'postinstall',
        'prepublishOnly',
        'prepack',
        'postpack',
        'start',
        'test',
        'stop',
        'restart',
        'pack',
        'prestart',
        'posttest',
      ].map((name) => [name, 'echo sample']),
    );
    expect(
      parseDeclaredCommands('package.json', JSON.stringify({ scripts })).map((item) => item.name),
    ).toEqual([
      'preview',
      'prettier',
      'postcss',
      'presentation',
      'deploy',
      'start',
      'test',
      'stop',
      'restart',
      'pack',
    ]);
  });

  it('rejects malformed Deno JSONC even when its tasks parsed before the error', () => {
    expect(parseDeclaredCommands('deno.jsonc', '{"tasks":{"dev":"serve"}} garbage')).toEqual([]);
    expect(
      parseDeclaredCommands('package.json', '{"scripts":{"dev":{"command":"serve"}}}'),
    ).toEqual([]);
    expect(packageManager('pnpm-untrusted@1', ['yarn.lock'])).toBe('yarn');
  });

  it('keeps nested recipe indentation and excludes Make assignments that resemble targets', () => {
    const commands = parseDeclaredCommands(
      'Makefile',
      [
        'VERSION :::= 1.0',
        'serve: PORT = 3000',
        '# Deploy the site',
        'deploy:',
        '\tif true; then',
        '\t\t echo deploy',
        '\tfi',
      ].join('\n'),
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      name: 'deploy',
      detail: 'if true; then',
      context: 'Deploy the site',
    });
  });

  it('validates all recipe bodies and the entire just header', () => {
    expect(parseDeclaredCommands('justfile', 'dev:\n  echo visible\n  echo \u200Bhidden')).toEqual(
      [],
    );
    expect(
      parseDeclaredCommands(
        'Makefile',
        '# Visible context\ndev:\n\techo visible\n\techo \u200Bhidden',
      ),
    ).toEqual([]);
    expect(parseDeclaredCommands('justfile', "dev optional='\u200B':\n  serve")).toEqual([]);
  });

  it('skips private comments, confirmation and recipes for another OS', () => {
    const text = [
      '[private] # internal',
      'hidden:',
      '  secret',
      '[confirm]',
      'confirmation:',
      '  echo confirm',
      '[linux]',
      'linux:',
      '  echo linux',
      '[windows]',
      'windows:',
      '  echo windows',
      '[macos]',
      'mac:',
      '  echo mac',
      '[unix]',
      'unix:',
      '  echo unix',
      'dev:',
      '  serve',
    ].join('\n');
    expect(
      parseDeclaredCommands('justfile', text, [], { platform: 'darwin' }).map((item) => item.line),
    ).toEqual(['just mac', 'just unix', 'just dev']);
    expect(parseDeclaredCommands('Procfile', 'web: bundle exec puma')[0]!.detail).toBe('web');
  });

  it.each(['\u3164', '\u115F', '\u034F', '\uFE0F', '\u{E0100}', '\u17B4', '\u180B'])(
    'refuses default ignorable characters in command text and declarations: %j',
    (character) => {
      const body = 'echo ' + character;
      expect(validTerminalCommand(body)).toBe(false);
      expect(terminalCommandProblem(body)).toContain('invisible');
      expect(
        parseDeclaredCommands('package.json', JSON.stringify({ scripts: { dev: body } })),
      ).toEqual([]);
      expect(parseDeclaredCommands('Makefile', 'dev:\n\t' + body)).toEqual([]);
    },
  );
});

describe('declared command parsers', () => {
  it('lists script lines and bodies while hiding installation and pre/post hooks', () => {
    const commands = parseDeclaredCommands(
      'package.json',
      JSON.stringify({
        packageManager: 'pnpm@10.0.0',
        scripts: {
          dev: 'vite',
          test: 'vitest',
          install: 'danger',
          prepare: 'setup',
          predev: 'before',
          postdev: 'after',
          preview: 'preview',
        },
      }),
    );
    expect(commands.map((item) => [item.name, item.line, item.detail])).toEqual([
      ['dev', 'pnpm run dev', 'vite'],
      ['test', 'pnpm run test', 'vitest'],
      ['preview', 'pnpm run preview', 'preview'],
    ]);
  });

  it('chooses the manifest manager, then nearest lockfile, then npm', () => {
    for (const manager of ['pnpm', 'yarn', 'bun', 'npm'])
      expect(packageManager(manager + '@1.0.0', ['yarn.lock'])).toBe(manager);
    expect(packageManager(undefined, ['yarn.lock', 'pnpm-lock.yaml'])).toBe('yarn');
    expect(packageManager(undefined, ['bun.lockb', 'package-lock.json'])).toBe('bun');
    expect(packageManager('evil; command', ['pnpm-lock.yaml'])).toBe('pnpm');
    expect(packageManager(undefined)).toBe('npm');
  });

  it('orders phony Makefile targets first and ignores variables, patterns, special targets and includes', () => {
    const commands = parseDeclaredCommands(
      'Makefile',
      [
        'artifact:',
        '\tcc main.c',
        '.PHONY: test clean',
        '# Run the checks',
        'test:',
        '\tcheck',
        '## Remove outputs',
        'clean:',
        '\tclean',
        '.DEFAULT:',
        '%.o: %.c',
        '$(TARGET):',
        'ASSIGN := value',
        'ASSIGN ::= value',
        'double ::= assigned',
        'include other.mk',
        ' indented:',
      ].join('\n'),
    );
    expect(commands.map((item) => [item.line, item.detail])).toEqual([
      ['make test', 'check'],
      ['make clean', 'clean'],
      ['make artifact', 'cc main.c'],
    ]);
    expect(parseDeclaredCommands('GNUmakefile', 'build:\n\tbuild')[0]!.line).toBe('make build');
    expect(parseDeclaredCommands('makefile', 'build:\n\tbuild')[0]!.line).toBe('make build');
  });

  it('ignores colon-bearing assignments, includes and define bodies while keeping double-colon rules', () => {
    const text = [
      'REMOTE = https://sample.invalid',
      'OPTION ?= value:part',
      'OPTION += value:part',
      'OPTION != echo value:part',
      'include path:part.mk',
      'define TEMPLATE',
      'not-a-target:',
      'endef',
      'invalid; echo misleading:',
      'valid:: dependency',
      '\techo valid',
    ].join('\n');
    expect(parseDeclaredCommands('Makefile', text).map((item) => item.line)).toEqual([
      'make valid',
    ]);
  });

  it('offers public just recipes without required parameters', () => {
    const commands = parseDeclaredCommands(
      'justfile',
      [
        'dev:',
        '  serve',
        '_private:',
        '  secret',
        '[private]',
        'hidden:',
        '  secret',
        'required argument:',
        '  use argument',
        "optional argument='sample value':",
        '  use sample',
        'many *arguments:',
        '  echo arguments',
        'some +arguments:',
        '  echo arguments',
        'setting := "ignored"',
        'import "elsewhere.just"',
      ].join('\n'),
    );
    expect(commands.map((item) => item.line)).toEqual(['just dev', 'just optional', 'just many']);
    for (const file of ['Justfile', '.justfile'] as const)
      expect(parseDeclaredCommands(file, 'dev:\n  serve')[0]!.line).toBe('just dev');
  });

  it('keeps Procfile bodies literal', () => {
    expect(
      parseDeclaredCommands('Procfile', '# comment\nweb: npm run dev\nworker: process --queue').map(
        (item) => item.line,
      ),
    ).toEqual(['npm run dev', 'process --queue']);
  });

  it('reads JSONC deno tasks without evaluating anything', () => {
    for (const file of ['deno.json', 'deno.jsonc'] as const) {
      const commands = parseDeclaredCommands(
        file,
        '{ // comment\n "tasks": { "dev": "deno run app.ts", "test": { "command": "deno test" }, }, }',
      );
      expect(commands.map((item) => item.line)).toEqual(['deno task dev', 'deno task test']);
    }
    expect(parseDeclaredCommands('deno.jsonc', '{ broken')).toEqual([]);
    expect(parseDeclaredCommands('package.json', '{ // not JSON\n }')).toEqual([]);
  });

  it.each([
    'has space',
    'x;echo',
    '$(touch x)',
    'a"b',
    "a'b",
    'a\nb',
    'x\u202Ey',
    'x\u200By',
    'x\u2066y',
    'x\uFEFFy',
    'x\u00ADy',
    'x\ud800y',
    '-option',
  ])('drops hostile script and task name %j', (name) => {
    expect(
      parseDeclaredCommands('package.json', JSON.stringify({ scripts: { [name]: 'echo safe' } })),
    ).toEqual([]);
    expect(
      parseDeclaredCommands('deno.json', JSON.stringify({ tasks: { [name]: 'echo safe' } })),
    ).toEqual([]);
  });

  it.each([
    '\u202E',
    '\u2066',
    '\u2069',
    '\u200B',
    '\uFEFF',
    '\u00AD',
    '\ud800',
    '\x1b',
    '\x7f',
    '\x85',
    '\u2028',
    '\u2029',
    '\t',
  ])('drops invisible or control characters in every displayed body: %j', (character) => {
    const body = 'echo' + character + 'unsafe';
    const sources: [DeclaredCommandFile, string][] = [
      ['package.json', JSON.stringify({ scripts: { dev: body } })],
      ['deno.jsonc', JSON.stringify({ tasks: { dev: body } })],
      ['Procfile', 'web: ' + body],
      ['justfile', 'dev:\n  ' + body],
      ['Makefile', '# ' + body + '\ndev:\n\techo safe'],
    ];
    for (const [file, text] of sources) expect(parseDeclaredCommands(file, text)).toEqual([]);
  });

  it('bounds bytes, entries and detail without splitting surrogate pairs', () => {
    const entries = Object.fromEntries(
      Array.from({ length: 75 }, (_, index) => ['task-' + index, 'echo ' + '😀'.repeat(250)]),
    );
    const commands = parseDeclaredCommands('package.json', JSON.stringify({ scripts: entries }));
    expect(commands).toHaveLength(50);
    expect(commands[0]!.detail!.length).toBeLessThanOrEqual(200);
    expect(commands[0]!.detail!.length).toBeGreaterThan(190);
    expect(commands[0]!.detail).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(
      parseDeclaredCommands('Procfile', 'web: serve\n#' + 'x'.repeat(declaredCommandLimits.bytes)),
    ).toEqual([]);
    expect(
      parseDeclaredCommands(
        'Procfile',
        'web: serve\n#' + 'é'.repeat(declaredCommandLimits.bytes / 2),
      ),
    ).toEqual([]);
    expect(
      parseDeclaredCommands(
        'package.json',
        JSON.stringify({
          scripts: { dev: 'serve' },
          padding: 'x'.repeat(declaredCommandLimits.bytes),
        }),
      ),
    ).toEqual([]);
    expect(
      parseDeclaredCommands('package.json', JSON.stringify({ scripts: { dev: 'x'.repeat(1001) } })),
    ).toEqual([]);
  });

  it('caps every source at fifty valid entries', () => {
    const names = Array.from({ length: 75 }, (_, index) => 'task' + index);
    const cases: [DeclaredCommandFile, string][] = [
      ['Makefile', names.map((name) => name + ':\n\techo sample').join('\n')],
      ['justfile', names.map((name) => name + ':\n  echo sample').join('\n')],
      ['Procfile', names.map((name) => name + ': echo sample').join('\n')],
      [
        'deno.jsonc',
        JSON.stringify({ tasks: Object.fromEntries(names.map((name) => [name, 'echo sample'])) }),
      ],
    ];
    for (const [file, text] of cases) expect(parseDeclaredCommands(file, text)).toHaveLength(50);
  });

  it('finds the just recipe delimiter outside quoted defaults and refuses later required parameters', () => {
    expect(
      parseDeclaredCommands('justfile', "dev url='https://sample.invalid' required:\n  serve"),
    ).toEqual([]);
    expect(
      parseDeclaredCommands('justfile', "dev url='https://sample.invalid':\n  serve")[0]!.line,
    ).toBe('just dev');
    expect(parseDeclaredCommands('justfile', 'dev:\n  serve\t')).toEqual([]);
  });
});

it('keeps Make targets independent of optional comment text', () => {
  for (const prefix of ['#', '##']) {
    for (const comment of ['', ' ', '   ', '\t', ' detail ', '\u200b', 'x'.repeat(10000)]) {
      const [target] = parseDeclaredCommands('Makefile', prefix + comment + '\ncheck:\n\techo ok');
      if (comment === '\u200b' || comment.length > 1000) {
        expect(target).toBeUndefined();
        continue;
      }
      expect(target?.line).toBe('make check');
      if (comment.trim() === 'detail') expect(target?.context).toBe('detail');
      else expect(target?.context).toBeUndefined();
    }
  }
});
