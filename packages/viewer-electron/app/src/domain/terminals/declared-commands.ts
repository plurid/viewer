import { parse } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';
import { validTerminalCommand } from './command-text';

export const declaredCommandLimits = {
  bytes: 256 * 1024,
  entries: 50,
  detail: 200,
  rows: 8,
} as const;
export const declaredCommandFiles = [
  'package.json',
  'GNUmakefile',
  'makefile',
  'Makefile',
  'justfile',
  'Justfile',
  '.justfile',
  'Procfile',
  'deno.json',
  'deno.jsonc',
] as const;
export type DeclaredCommandFile = (typeof declaredCommandFiles)[number];
export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';
export interface DeclaredCommand {
  file: DeclaredCommandFile;
  /** Relative to the owning root, so equal names in different files stay distinct. */
  source: string;
  relativeSource?: string;
  name: string;
  line: string;
  detail?: string;
  context?: string;
  lastRun?: boolean;
}
export interface DeclaredCommandsReply {
  commands: DeclaredCommand[];
}
export interface DeclaredCommandReference {
  source: string;
  name: string;
  at: number;
}
interface ParserOptions {
  packageManager?: string;
  platform?: string;
}

const lifecycleScripts = new Set([
  'install',
  'uninstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'publish',
  'prepack',
  'postpack',
  'version',
  'shrinkwrap',
  'dependencies',
]);
const manualLifecycleScripts = new Set(['start', 'stop', 'restart', 'test']);
const recipePlatforms: Record<string, readonly string[]> = {
  macos: ['darwin'],
  linux: ['linux'],
  windows: ['win32'],
  freebsd: ['freebsd'],
  openbsd: ['openbsd'],
  netbsd: ['netbsd'],
  dragonfly: ['dragonfly'],
  unix: ['darwin', 'linux', 'freebsd', 'openbsd', 'netbsd', 'dragonfly', 'sunos', 'aix'],
};

export const declaredCommandName = (name: string) =>
  /^[A-Za-z0-9][A-Za-z0-9:._/@+-]{0,99}$/.test(name);

export function packageManager(value: unknown, locks: readonly string[] = []): PackageManager {
  if (typeof value === 'string') {
    const match = /^(pnpm|yarn|bun|npm)(?:@[^\s\p{Cc}\p{Cf}\p{Cs}]+)?$/u.exec(value);
    if (match) return match[1] as PackageManager;
  }
  for (const lock of locks) {
    if (lock === 'pnpm-lock.yaml') return 'pnpm';
    if (lock === 'yarn.lock') return 'yarn';
    if (lock === 'bun.lock' || lock === 'bun.lockb') return 'bun';
    if (lock === 'package-lock.json' || lock === 'npm-shrinkwrap.json') return 'npm';
  }
  return 'npm';
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function clip(value: string): string {
  const clipped = value.slice(0, declaredCommandLimits.detail);
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
}

type RecipeQuote = "'" | '"' | '`';
function recipeAttributes(line: string): string[] | undefined {
  if (!line.startsWith('[')) return;
  let quote: RecipeQuote | undefined;
  let start = 1;
  const attributes: string[] = [];
  for (let index = 1; index < line.length; index++) {
    const character = line[index]!;
    if (character === '\\') {
      index++;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === ',' || character === ']') {
      attributes.push(line.slice(start, index).trim());
      start = index + 1;
      if (character === ']')
        return /^\s*(?:#.*)?$/.test(line.slice(start)) ? attributes : undefined;
    }
  }
}

function recipeHeader(line: string): { name: string; parameters: string[] } | undefined {
  let quote: RecipeQuote | undefined;
  let word = '';
  const words: string[] = [];
  const flush = () => {
    if (word) words.push(word);
    word = '';
  };
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '\\') {
      word += character + (line[++index] ?? '');
      continue;
    }
    if (quote) {
      word += character;
      if (character === quote) quote = undefined;
    } else if (character === "'" || character === '"' || character === '`') {
      quote = character;
      word += character;
    } else if (character === ':') {
      if (line[index + 1] === '=' || line[index + 1] === ':') return;
      flush();
      const name = words.shift()?.replace(/^@/, '');
      return name ? { name, parameters: words } : undefined;
    } else if (/\s/.test(character)) flush();
    else word += character;
  }
}

/** Parsing describes files only. Every returned line still requires the person's explicit Run. */
export function parseDeclaredCommands(
  file: DeclaredCommandFile,
  text: string,
  locks: readonly string[] = [],
  options: ParserOptions = {},
): DeclaredCommand[] {
  if (new TextEncoder().encode(text).length > declaredCommandLimits.bytes) return [];
  const commands: DeclaredCommand[] = [];
  const seen = new Set<string>();
  const add = (name: string, line: string, body?: string, context?: string) => {
    if (
      commands.length >= declaredCommandLimits.entries ||
      seen.has(name) ||
      !declaredCommandName(name) ||
      !line.trim() ||
      !validTerminalCommand(line) ||
      (body !== undefined && !validTerminalCommand(body)) ||
      (context !== undefined && !validTerminalCommand(context))
    )
      return;
    seen.add(name);
    commands.push({
      file,
      source: file,
      name,
      line,
      detail: body ? clip(body) : undefined,
      context: context ? clip(context) : undefined,
    });
  };
  if (file === 'package.json' || file === 'deno.json' || file === 'deno.jsonc') {
    let value: Record<string, unknown> | undefined;
    try {
      if (file === 'package.json') value = object(JSON.parse(text));
      else {
        const errors: ParseError[] = [];
        value = object(parse(text, errors, { allowTrailingComma: true }));
        if (errors.length) return [];
      }
    } catch {
      return [];
    }
    const entries = object(value?.[file === 'package.json' ? 'scripts' : 'tasks']);
    const manager = packageManager(options.packageManager ?? value?.packageManager, locks);
    for (const [name, body] of Object.entries(entries ?? {})) {
      if (file === 'package.json' && typeof body !== 'string') continue;
      if (file === 'package.json') {
        const hooked = /^(?:pre|post)(.+)$/.exec(name)?.[1];
        if (
          lifecycleScripts.has(name) ||
          (hooked &&
            (Object.hasOwn(entries!, hooked) ||
              lifecycleScripts.has(hooked) ||
              manualLifecycleScripts.has(hooked)))
        )
          continue;
      }
      const command = typeof body === 'string' ? body : object(body)?.command;
      if (typeof command !== 'string') continue;
      add(name, file === 'package.json' ? `${manager} run ${name}` : `deno task ${name}`, command);
    }
    return commands;
  }
  const lines = text.split(/\r?\n/);
  if (file === 'Procfile') {
    for (const line of lines) {
      if (line.startsWith('#')) continue;
      const match = /^([^\s:]+):[ \t]*(.+)$/.exec(line);
      if (match) add(match[1]!, match[2]!, match[1]!);
    }
    return commands;
  }
  if (file === 'justfile' || file === 'Justfile' || file === '.justfile') {
    let privateRecipe = false;
    const platforms = new Set<string>();
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      const attributes = recipeAttributes(line);
      if (attributes) {
        for (const attribute of attributes) {
          privateRecipe ||= /^(?:private|confirm)(?:\b|\()/.test(attribute);
          if (Object.hasOwn(recipePlatforms, attribute)) platforms.add(attribute);
        }
        continue;
      }
      if (!line || line.startsWith('#') || /^\s/.test(line)) continue;
      const header = recipeHeader(line);
      const hidden =
        privateRecipe ||
        (platforms.size > 0 &&
          ![...platforms].some((platform) =>
            recipePlatforms[platform]!.includes(options.platform ?? ''),
          ));
      privateRecipe = false;
      platforms.clear();
      if (!header || hidden || !validTerminalCommand(line)) continue;
      if (
        header.parameters.some(
          (part) => part.startsWith('+') || (!part.includes('=') && !part.startsWith('*')),
        )
      )
        continue;
      const bodies: string[] = [];
      for (let next = index + 1; next < lines.length && /^\s/.test(lines[next]!); next++) {
        const body = lines[next]!.replace(/^[ \t]+/, '');
        if (body.trim()) bodies.push(body);
      }
      if (bodies.some((body) => !validTerminalCommand(body))) continue;
      const detail = bodies.find((body) => !body.startsWith('#'));
      add(header.name, `just ${header.name}`, detail);
    }
    return commands;
  }
  const phony = new Map<string, number>();
  const rules: { name: string; detail?: string; context?: string }[] = [];
  let defineDepth = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^(?:override\s+)?define(?:\s|$)/.test(line)) {
      defineDepth++;
      continue;
    }
    if (/^endef(?:\s|$)/.test(line)) {
      defineDepth = Math.max(0, defineDepth - 1);
      continue;
    }
    if (
      defineDepth ||
      /^(?:-?include|sinclude|export|unexport|override|private|vpath|ifdef|ifndef|ifeq|ifneq|else|endif)(?:\s|$)/.test(
        line,
      )
    )
      continue;
    const declaration = /^\.PHONY\s*:\s*(.*)$/.exec(line);
    if (declaration) {
      for (const name of declaration[1]!.split(/\s+/))
        if (!phony.has(name)) phony.set(name, phony.size);
      continue;
    }
    if (!line || /^[\s.#]/.test(line)) continue;
    const match = /^([^:]+)(?:::(?![:=])|:(?![=:]))/.exec(line);
    if (!match || /[=$%\\]/.test(match[1]!)) continue;
    const tail = line.slice(match[0].length);
    let semicolon = -1;
    for (let index = 0; index < tail.length; index++) {
      if (tail[index] === '\\') index++;
      else if (tail[index] === ';') {
        semicolon = index;
        break;
      }
    }
    const prerequisites = semicolon < 0 ? tail : tail.slice(0, semicolon);
    if (
      /^\s*(?:(?:private|override|export|unexport)\s+)*[^ \t:=]+[ \t]*[:+?!]*=/.test(prerequisites)
    )
      continue;
    const names = match[1]!.trim().split(/\s+/);
    if (!names.every((name) => declaredCommandName(name) && !name.startsWith('.'))) continue;
    const bodies: string[] = semicolon < 0 ? [] : [tail.slice(semicolon + 1).trimStart()];
    for (let next = index + 1; next < lines.length && /^\t/.test(lines[next]!); next++) {
      const body = lines[next]!.replace(/^[ \t]+/, '');
      if (body.trim()) bodies.push(body);
    }
    if (bodies.some((body) => !validTerminalCommand(body))) continue;
    const comment = /^#{1,2}[ ]?([\s\S]*)$/.exec(lines[index - 1] ?? '')?.[1];
    for (const name of names) rules.push({ name, detail: bodies[0], context: comment });
  }
  rules.sort((a, b) => {
    return (phony.get(a.name) ?? Infinity) - (phony.get(b.name) ?? Infinity);
  });
  for (const rule of rules) add(rule.name, `make ${rule.name}`, rule.detail, rule.context);
  return commands;
}
