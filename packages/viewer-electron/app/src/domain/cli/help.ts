import { cliCommands, cliGlobalOptions, cliRoots } from './catalog';
import { CLIUsageError } from './arguments';

export function cliHelp(topic: readonly string[] = []): string {
  const commands = cliCommands.filter((command) =>
    topic.every((word, index) => command.name[index] === word),
  );
  if (topic.length && !commands.length)
    throw new CLIUsageError('Unknown help topic ' + topic.join(' ') + '.');
  const selected = commands.length === 1 ? commands[0] : undefined;
  const rows = selected
    ? [
        selected.description,
        '',
        'Usage: viewer ' +
          selected.name.join(' ') +
          (selected.arguments ?? [])
            .map(
              (arg) =>
                ' ' +
                (arg.optional ? '[' : '<') +
                arg.name +
                (arg.multiple ? '…' : '') +
                (arg.optional ? ']' : '>'),
            )
            .join(''),
        '',
        ...(selected.options ?? []).map(
          (option) =>
            '  --' +
            option.name +
            (option.kind === 'boolean' ? '' : ' VALUE') +
            '  ' +
            option.description,
        ),
      ]
    : [
        'Viewer — files, workspaces and reviewed automation from your terminal.',
        '',
        'Usage: viewer [PATH…] [--new-window | --workspace NAME] [--terminal]',
        '       viewer COMMAND [OPTIONS]',
        '',
        ...commands.map(
          (command) => '  ' + command.name.join(' ').padEnd(24) + command.description,
        ),
      ];
  return [
    ...rows,
    '',
    'Global options:',
    ...cliGlobalOptions.map(
      (option) =>
        '  --' + option.name + (option.kind === 'integer' ? ' MS' : '') + '  ' + option.description,
    ),
    '',
    'viewer --version             Show the application version.',
    'viewer completion bash|zsh|fish  Print shell completion; no startup files are edited.',
    '',
    'Automation connects to the running app with VIEWER_AGENT_TOKEN from Settings → Agents.',
    'Folder, content and model permissions remain separate. A proposal is not approval.',
    'Use viewer -- PATH for a literal filename that is also a command name.',
    'Exit codes: 0 success, 1 service failure, 2 usage, 3 connection, 4 missing credentials, 124 timeout, 130 cancelled.',
    '',
  ].join('\n');
}

/** Output is a script to inspect/source explicitly; the CLI never edits a shell profile. */
export function cliCompletion(shell: string): string {
  const globals = cliGlobalOptions.map((option) => '--' + option.name).concat('--version');
  const families = [...new Set(cliCommands.map((command) => command.name[0]!))];
  const roots = [...cliRoots, ...globals, '--new-window', '--workspace', '--terminal'];
  const commands = cliCommands.map((command) => ({
    key: command.name.join(' '),
    options: [...globals, ...(command.options ?? []).map((option) => '--' + option.name)],
  }));
  const children = (family: string) =>
    cliCommands
      .filter((command) => command.name[0] === family && command.name.length > 1)
      .map((command) => command.name[1]!);
  const valued = [
    ...new Set(
      [...cliGlobalOptions, ...cliCommands.flatMap((command) => command.options ?? [])]
        .filter((option) => option.kind !== 'boolean')
        .map((option) => '--' + option.name),
    ),
  ];
  const choices = cliCommands
    .flatMap((command) => command.options ?? [])
    .filter((option) => option.values?.length);
  const cases = commands
    .map(
      (command) =>
        `    "${command.key}"|"${command.key} "*) candidates="${command.key === 'completion' ? 'bash zsh fish ' : ''}${command.options.join(' ')}" ;;`,
    )
    .concat(
      families
        .filter((family) => children(family).length)
        .map(
          (family) =>
            `    "${family}") candidates="${children(family).concat(globals).join(' ')}" ;;`,
        ),
    )
    .concat(`    "help") candidates="${cliRoots.join(' ')}" ;;`)
    .join('\n');
  const valueCases = choices
    .map((option) => `    --${option.name}) candidates="${option.values!.join(' ')}" ;;`)
    .join('\n');
  if (shell === 'bash' || shell === 'zsh') {
    const bash = shell === 'bash';
    const body = [
      bash ? '_viewer_complete() {' : '#compdef viewer\n_viewer() {',
      `  local key="" word candidates="${roots.join(' ')}"`,
      '  local i skip=0',
      bash ? '  for ((i=1; i<COMP_CWORD; i++)); do' : '  for ((i=2; i<CURRENT; i++)); do',
      bash ? '    word="${COMP_WORDS[i]}"' : '    word="${words[i]}"',
      '    if (( skip )); then skip=0; continue; fi',
      '    case "$word" in',
      `      ${valued.join('|')}) skip=1 ;;`,
      '      --) break ;;',
      '      -*) ;;',
      '      *) key="${key:+$key }$word" ;;',
      '    esac',
      '  done',
      '  case "$key" in',
      cases,
      '  esac',
      bash ? '  case "${COMP_WORDS[COMP_CWORD-1]}" in' : '  case "${words[CURRENT-1]}" in',
      valueCases,
      '  esac',
      ...(bash
        ? [
            '  COMPREPLY=( $(compgen -W "$candidates" -- "${COMP_WORDS[COMP_CWORD]}") )',
            '}',
            'complete -o default -F _viewer_complete viewer',
          ]
        : [
            '  local -a matches',
            '  matches=(${=candidates})',
            '  compadd -- "${matches[@]}"',
            '  _files',
            '}',
            'compdef _viewer viewer',
          ]),
      '',
    ];
    return body.join('\n');
  }
  if (shell === 'fish') {
    const rows = ['complete -c viewer -f'];
    for (const family of cliRoots)
      rows.push(`complete -c viewer -n __fish_use_subcommand -a ${family}`);
    for (const command of cliCommands) {
      const condition =
        command.name.length === 1
          ? `__fish_seen_subcommand_from ${command.name[0]}`
          : `__fish_seen_subcommand_from ${command.name[0]}; and __fish_seen_subcommand_from ${command.name[1]}`;
      if (command.name.length > 1)
        rows.push(
          `complete -c viewer -n '__fish_seen_subcommand_from ${command.name[0]}' -a ${command.name[1]} -d '${command.description.replaceAll("'", "\\'")}'`,
        );
      for (const option of command.options ?? [])
        rows.push(
          `complete -c viewer -n '${condition}' -l ${option.name}${option.kind === 'boolean' ? '' : ' -r'}${option.values ? " -a '" + option.values.join(' ') + "'" : ''}`,
        );
    }
    for (const option of cliGlobalOptions)
      rows.push(`complete -c viewer -l ${option.name}${option.kind === 'boolean' ? '' : ' -r'}`);
    rows.push(
      'complete -c viewer -l version',
      "complete -c viewer -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'",
      '',
    );
    return rows.join('\n');
  }
  throw new CLIUsageError('Choose bash, zsh or fish.');
}
