import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTree } from 'jsonc-parser';
import { z } from 'zod';
import type {
  DefinitionProblem,
  ProjectManagerState,
  WorkspaceProject,
} from '../../domain/workspaces/definitions/schema';
import { definitionKeySchema, definitionLimits } from '../../domain/workspaces/definitions/schema';
import { keyFor, uniqueKey } from '../../domain/workspaces/definitions/keys';
import { resolveDefinitionPath } from '../../domain/workspaces/definitions/paths';
import { sourceLines } from '../../domain/workspaces/definitions/catalog';
import { decodeDefinition } from '../persistence/definition-files';
import { stat } from '../files/stats';

export function projectManagerPath(home: string): string {
  return path.join(
    home,
    'Library',
    'Application Support',
    'Code',
    'User',
    'globalStorage',
    'alefragnani.project-manager',
    'projects.json',
  );
}

export function expandProjectPath(value: string, home: string): string {
  return resolveDefinitionPath(value.replace(/^\$home(?=\/|$)/i, home), {
    home,
    roots: new Map(),
    resolvingRoot: true,
  });
}

export interface ProjectManagerRead {
  projects: WorkspaceProject[];
  status: ProjectManagerState;
  diagnostics: DefinitionProblem[];
}

const entrySchema = z.object({
  name: z.string().trim().min(1).max(1000),
  rootPath: z.string().trim().min(1).max(4096),
});

export function decodeProjects(text: string, file: string, home: string): ProjectManagerRead {
  const raw = decodeDefinition(
    text,
    z.array(z.unknown()).max(definitionLimits.projects),
    'projects.json',
    definitionLimits.projectsFile,
  );
  const status: ProjectManagerState = {
    path: file,
    state: 'read',
    projects: raw.length,
    missing: 0,
    disabled: 0,
    remote: 0,
    duplicateKeys: 0,
  };
  const diagnostics: DefinitionProblem[] = [];
  const projects: WorkspaceProject[] = [];
  const taken = new Set<string>();
  const nodes = parseTree(text, [], { allowTrailingComma: true })?.children;
  const lineAt = sourceLines(text);
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.length <= 4096)
      : [];
  for (const [index, rawEntry] of raw.entries()) {
    const line = lineAt(nodes?.[index]?.offset ?? 0);
    const note = (message: string, key?: string) =>
      diagnostics.push({ source: 'projects.json', level: 'warning', key, line, message });
    if (
      rawEntry &&
      typeof rawEntry === 'object' &&
      'enabled' in rawEntry &&
      rawEntry.enabled === false
    ) {
      status.disabled++;
      continue;
    }
    const parsed = entrySchema.safeParse(rawEntry);
    if (!parsed.success) {
      note('This project needs a name and a local rootPath.');
      continue;
    }
    const extras = rawEntry as Record<string, unknown>;
    if (/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(parsed.data.rootPath)) {
      status.remote++;
      continue;
    }
    try {
      const root = expandProjectPath(parsed.data.rootPath, home);
      const base = keyFor(parsed.data.name);
      const key = uniqueKey(base, taken);
      if (!definitionKeySchema.safeParse(key).success) {
        const parts = key.split('/');
        note(
          parts.some((part) => part === '.' || part === '..')
            ? 'The derived project key contains a "." or ".." segment.'
            : parts.length > 8
              ? `The derived project key has ${parts.length} segments; at most eight are allowed.`
              : 'The derived project key is longer than 200 characters.',
        );
        continue;
      }
      taken.add(key);
      if (key !== base) {
        status.duplicateKeys++;
        note(`Duplicate derived key “${base}”. Assigned “${key}”.`, key);
      }
      const paths = strings(extras.paths).flatMap((value) => {
        if (/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(value)) {
          note('A remote extra project path is left out.', key);
          return [];
        }
        try {
          return [
            resolveDefinitionPath(value.replace(/^\$home(?=\/|$)/i, home), {
              home,
              root,
              roots: new Map(),
            }),
          ];
        } catch {
          note('An extra project path could not be resolved.', key);
          return [];
        }
      });
      projects.push({
        key,
        name: parsed.data.name,
        root,
        paths: [...new Set(paths)].filter((value) => value !== root).slice(0, 29),
        tags: strings(extras.tags)
          .filter((tag) => tag.length <= 60)
          .slice(0, 10),
        line,
      });
    } catch (error) {
      note((error as Error).message);
    }
  }
  return { projects, status, diagnostics };
}

export async function readProjectManager(file: string, home: string): Promise<ProjectManagerRead> {
  const info = await stat(file);
  if (!info.isFile() || info.size > definitionLimits.projectsFile)
    throw new Error('projects.json must be a file of at most 8 MiB.');
  return decodeProjects(await readFile(file, 'utf8'), file, home);
}

const presenceChecks = new Map<string, Promise<boolean>>();

/** Consent needs file presence, never its contents. Stalled volumes get at most two raw reads. */
export async function projectManagerExists(file: string): Promise<boolean> {
  let check = presenceChecks.get(file);
  if (!check) {
    if (presenceChecks.size >= 2) return false;
    check = stat(file)
      .then(
        (info) => info.isFile(),
        (error: NodeJS.ErrnoException) => error.code === 'EPERM' || error.code === 'EACCES',
      )
      .finally(() => presenceChecks.delete(file));
    presenceChecks.set(file, check);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      check,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 150);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
