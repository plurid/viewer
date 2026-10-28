import { typoScore } from '../search/approximate';
import { cliCommands, cliGlobalOptions, type CLICommand, type CLIOption } from './catalog';

export class CLIUsageError extends Error {}
export interface CLIInvocation {
  kind: 'help' | 'version' | 'completion' | 'request';
  command?: CLICommand;
  topic: string[];
  parameters: Record<string, unknown>;
  json: boolean;
  wait: boolean;
  timeout: number;
  stdin?: string;
}
function optionValue(option: CLIOption, text: string | undefined): unknown {
  if (option.kind === 'boolean') {
    if (text !== undefined) throw new CLIUsageError('--' + option.name + ' takes no value.');
    return true;
  }
  if (text === undefined || !text.length)
    throw new CLIUsageError('--' + option.name + ' needs a value.');
  if (option.values && !option.values.includes(text))
    throw new CLIUsageError('--' + option.name + ' must be ' + option.values.join(', ') + '.');
  if (option.kind === 'integer') {
    const value = Number(text);
    if (
      !/^\d+$/.test(text) ||
      !Number.isSafeInteger(value) ||
      value < (option.min ?? 0) ||
      value > (option.max ?? Number.MAX_SAFE_INTEGER)
    )
      throw new CLIUsageError('--' + option.name + ' is outside its supported integer range.');
    return value;
  }
  return text;
}
export function parseCLI(
  input: readonly string[],
  resolvePath: (file: string) => string,
): CLIInvocation {
  if (
    input.length > 256 ||
    input.some((arg) => arg.includes('\0')) ||
    input.reduce((sum, arg) => sum + new TextEncoder().encode(arg).length, 0) > 65536
  )
    throw new CLIUsageError('The command exceeds its argument limits.');
  const result: CLIInvocation = {
    kind: 'request',
    topic: [],
    parameters: {},
    json: false,
    wait: false,
    timeout: 30000,
  };
  const args: string[] = [];
  const seen = new Set<string>();
  let help = input[0] === 'help';
  let version = false;
  for (let index = 0; index < input.length; index++) {
    const text = input[index]!;
    if (text === '--') {
      args.push(...input.slice(index));
      break;
    }
    const [raw, ...tail] = text.split('=');
    if (raw === '--version' || raw === '-v') {
      if (version || tail.length) throw new CLIUsageError('Version takes only --json.');
      version = true;
      continue;
    }
    const name = raw === '-h' ? 'help' : raw!.replace(/^--/, '');
    const option = text.startsWith('-')
      ? cliGlobalOptions.find((value) => value.name === name)
      : undefined;
    if (!option) {
      args.push(text);
      // Preserve a command option's value even when it looks like a global flag.
      const local = cliCommands
        .flatMap((command) => command.options ?? [])
        .find((value) => text === '--' + value.name && value.kind !== 'boolean');
      if (local && index + 1 < input.length) args.push(input[++index]!);
      continue;
    }
    if (seen.has(name)) throw new CLIUsageError('Duplicate option --' + name + '.');
    seen.add(name);
    const value = optionValue(
      option,
      tail.length ? tail.join('=') : option.kind === 'boolean' ? undefined : input[++index],
    );
    if (name === 'help') help = true;
    else if (name === 'json') result.json = true;
    else if (name === 'wait') result.wait = true;
    else if (name === 'timeout') result.timeout = value as number;
  }
  if (version) {
    if (args.length || [...seen].some((name) => name !== 'json'))
      throw new CLIUsageError('Version takes only --json.');
    return { ...result, kind: 'version' };
  }
  const command = cliCommands.find((candidate) =>
    candidate.name.every((word, index) => word === args[index]),
  );
  const start = command?.name.length ?? (args[0] === 'help' ? 1 : 0);
  const positional: string[] = [];
  let literal = false;
  for (let index = start; index < args.length; index++) {
    const arg = args[index]!;
    if (!literal && arg === '--') {
      literal = true;
      continue;
    }
    if (!literal && arg.startsWith('-') && arg !== '-') {
      const [raw, ...tail] = arg.split('=');
      const name = raw === '-h' ? 'help' : raw!.replace(/^--/, '');
      const option = [...cliGlobalOptions, ...(command?.options ?? [])].find(
        (value) => value.name === name,
      );
      if (!option) throw new CLIUsageError('Unknown option ' + raw + '. Use --help.');
      if (seen.has(name)) throw new CLIUsageError('Duplicate option --' + name + '.');
      seen.add(name);
      const value = optionValue(
        option,
        tail.length ? tail.join('=') : option.kind === 'boolean' ? undefined : args[++index],
      );
      if (name === 'help') help = true;
      else if (name === 'json') result.json = true;
      else if (name === 'wait') result.wait = true;
      else if (name === 'timeout') result.timeout = value as number;
      else result.parameters[name] = value;
    } else positional.push(arg);
  }
  if (args[0] === 'completion') {
    if (help) return { ...result, kind: 'help', topic: ['completion'] };
    if (positional[0] === 'completion') positional.shift();
    if (positional.length !== 1 || !['bash', 'zsh', 'fish'].includes(positional[0]!))
      throw new CLIUsageError('Use viewer completion bash, zsh or fish.');
    return { ...result, kind: 'completion', topic: positional };
  }
  if (help || !args.length || (!command && args[0] === 'help'))
    return { ...result, kind: 'help', topic: command ? [...command.name] : positional };
  if (!command) {
    const text = positional.join(' ');
    const suggestion = cliCommands
      .map((value) => ({ value, score: typoScore(value.name.join(' '), text) }))
      .sort((a, b) => b.score - a.score)[0];
    throw new CLIUsageError(
      'Unknown command ' +
        text +
        '.' +
        (suggestion && suggestion.score > 0
          ? ' Did you mean viewer ' + suggestion.value.name.join(' ') + '?'
          : ' Use viewer --help.'),
    );
  }
  result.command = command;
  result.topic = [...command.name];
  for (const argument of command.arguments ?? []) {
    const value = argument.multiple ? positional.splice(0) : positional.shift();
    if (value === undefined || (Array.isArray(value) && !value.length)) {
      if (argument.optional) continue;
      throw new CLIUsageError(
        'Missing ' + argument.name + '. Use viewer ' + command.name.join(' ') + ' --help.',
      );
    }
    result.parameters[argument.name] =
      argument.kind === 'path'
        ? Array.isArray(value)
          ? value.map(resolvePath)
          : resolvePath(value)
        : value;
    if (argument.kind === 'json') parseJSONParameter(result, argument.name);
  }
  if (positional.length) throw new CLIUsageError('Unexpected argument ' + positional[0] + '.');
  for (const option of command.options ?? []) {
    if (!Object.hasOwn(result.parameters, option.name) && option.default !== undefined)
      result.parameters[option.name] = option.default;
    if (!Object.hasOwn(result.parameters, option.name)) {
      if (option.required) throw new CLIUsageError('Missing --' + option.name + '.');
      continue;
    }
    if (option.kind === 'path')
      result.parameters[option.name] = resolvePath(String(result.parameters[option.name]));
    if (option.kind === 'json') parseJSONParameter(result, option.name);
  }
  if (command.name[0] === 'git' && !result.parameters.path)
    result.parameters.path = resolvePath('.');
  return result;
}
function parseJSONParameter(invocation: CLIInvocation, key: string): void {
  const text = invocation.parameters[key];
  if (text === '-') {
    if (invocation.stdin) throw new CLIUsageError('Only one argument may read stdin.');
    invocation.stdin = key;
    return;
  }
  try {
    invocation.parameters[key] = JSON.parse(String(text));
  } catch {
    throw new CLIUsageError('Invalid JSON for ' + key + '.');
  }
}
