import { z } from 'zod';
import { validTerminalCommand, terminalCommandProblem } from '../../terminals/command-text';
import type { SavedState, Workspace } from '../../contracts';
import { templatePlaneSchema } from '../layout-templates';
import { tileLayouts } from '../tiling';
import { presentationValuesSchema } from '../../preferences/presentation/profile-fields';

export const definitionLimits = {
  file: 4 * 1024 * 1024,
  projectsFile: 8 * 1024 * 1024,
  projects: 5000,
  entries: 2000,
  planes: 30,
} as const;

export const definitionKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){0,7}$/)
  .refine((key) => key.split('/').every((part) => part !== '.' && part !== '..'));

const definitionPath = z
  .string()
  .max(4096)
  .refine((value) => !value.includes('\0'));
export const definitionPlaneSchema = templatePlaneSchema(definitionPath, {
  command: z
    .string()
    .min(1)
    .max(1000)
    .refine(validTerminalCommand, {
      error: (issue) =>
        terminalCommandProblem(issue.input) ?? 'Use a command of 1 to 1,000 characters.',
    })
    .optional(),
});
export type DefinitionPlane = z.infer<typeof definitionPlaneSchema>;
export type DefinitionSplitAxis = 'x' | 'y';
export type DefinitionSplit =
  | { plane: number }
  | { axis: DefinitionSplitAxis; ratio: number; first: DefinitionSplit; second: DefinitionSplit };

const splitSchema = z.custom<DefinitionSplit>((value) => {
  let count = 0;
  const leaves = new Set<number>();
  const visit = (node: unknown, depth: number): boolean => {
    if (++count > 59 || depth > 30 || !node || typeof node !== 'object') return false;
    const item = node as Record<string, unknown>;
    if ('plane' in item) {
      if (
        Object.keys(item).length !== 1 ||
        typeof item.plane !== 'number' ||
        !Number.isInteger(item.plane) ||
        item.plane < 0 ||
        item.plane > 29 ||
        leaves.has(item.plane)
      )
        return false;
      leaves.add(item.plane);
      return true;
    }
    return (
      Object.keys(item).length === 4 &&
      (item.axis === 'x' || item.axis === 'y') &&
      typeof item.ratio === 'number' &&
      item.ratio >= 0.001 &&
      item.ratio <= 0.999 &&
      visit(item.first, depth + 1) &&
      visit(item.second, depth + 1)
    );
  };
  return visit(value, 0);
}, 'Invalid or oversized plane split tree.');

export const definitionEntrySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    root: definitionPath.optional(),
    planes: z.array(definitionPlaneSchema).max(definitionLimits.planes).optional(),
    tiling: z
      .object({
        layout: z.enum(tileLayouts),
        main: z.number().min(0.2).max(0.8).optional(),
        split: splitSchema.optional(),
      })
      .strict()
      .optional(),
    focus: z.number().int().min(0).max(29).optional(),
    terminalProfile: z.string().min(1).max(200).optional(),
    look: z
      .object({
        spaceColor: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .optional(),
        profile: z.string().min(1).max(100).optional(),
        overrides: presentationValuesSchema.optional(),
      })
      .strict()
      .optional(),
    aliases: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
    curated: z.boolean().optional(),
    hidden: z.boolean().optional(),
  })
  .strict();
export type DefinitionEntry = z.infer<typeof definitionEntrySchema>;

export const workspacesFileSchema = z
  .object({
    $schema: z.literal('workspaces.schema.json').default('workspaces.schema.json'),
    version: z.literal(1),
    sources: z
      .object({
        projectManager: z
          .object({
            enabled: z.boolean().optional(),
            path: z.string().min(1).max(4096).optional(),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({ projectManager: {} }),
    workspaces: z
      .record(z.string(), z.unknown())
      .default({})
      .refine(
        (entries) => Object.keys(entries).length <= definitionLimits.entries,
        'Too many workspace definitions.',
      ),
  })
  .strict();
export type WorkspacesFile = z.infer<typeof workspacesFileSchema>;
export type DefinitionRootState = 'present' | 'missing' | 'unknown';
export type FoundWorkspaceState = 'loading' | 'ready' | 'off';
export type DefinitionProblemLevel = 'error' | 'warning' | 'note';
export type DefinitionProblemSource =
  'workspaces.jsonc' | 'projects.json' | 'defined-workspaces-v1.json' | 'found-workspaces-v1.json';
export const workspaceDefinitionSourceSchema = z.enum([
  'project-manager',
  'override',
  'standalone',
  'found',
]);
export type WorkspaceDefinitionSource = z.infer<typeof workspaceDefinitionSourceSchema>;
export type ProjectManagerReadState =
  'undecided' | 'off' | 'absent' | 'read' | 'needs-access' | 'unreadable';
export type DefinitionFileState = 'absent' | 'read' | 'last-valid' | 'unreadable';
export type WorkspaceDefinitionFileKind = 'catalog' | 'edit' | 'validate' | 'allow-source';
export interface DefinitionProblem {
  level: DefinitionProblemLevel;
  source: DefinitionProblemSource;
  key?: string;
  line?: number;
  message: string;
}
export interface WorkspaceProject {
  key: string;
  name: string;
  root: string;
  paths: string[];
  tags: string[];
  line?: number;
}
export interface ResolvedDefinitionPlane {
  index: number;
  plane: DefinitionPlane;
}
export interface WorkspaceDefinition {
  key: string;
  basis: string;
  name: string;
  root: string;
  rootState: DefinitionRootState;
  projectName?: string;
  source: WorkspaceDefinitionSource;
  planes: ResolvedDefinitionPlane[];
  tiling?: DefinitionEntry['tiling'];
  focus?: number;
  terminalProfile?: string;
  look?: DefinitionEntry['look'];
  aliases: string[];
  curated: boolean;
  hidden: boolean;
  openedAt?: number;
  remembered?: { at: number; basis: string; planes: number };
}
export interface RememberedWorkspace {
  key: string;
  at: number;
  basis: string;
  workspace: Workspace;
  previewStates: NonNullable<SavedState['previewStates']>;
  previewHistory: NonNullable<SavedState['previewHistory']>[string];
}
export interface ProjectManagerState {
  path: string;
  enabled?: boolean;
  state: ProjectManagerReadState;
  projects: number;
  missing: number;
  disabled: number;
  remote: number;
  duplicateKeys: number;
}
export interface DefinitionCatalog {
  found?: { state: FoundWorkspaceState; count: number; hidden: number };
  /** Roots whose workspace offer the person dismissed, from a private file: never config. */
  dismissedOffers?: string[];
  /**
   * In the reply to Show Hidden Again, its Undo or Not a Workspace's Undo: how many roots it
   * showed or hid again. Zero says nothing changed.
   */
  changed?: number;
  revision: number;
  file: { path: string; state: DefinitionFileState };
  projectManager: ProjectManagerState;
  definitions: WorkspaceDefinition[];
  diagnostics: DefinitionProblem[];
}
export interface DefinitionSaveResult {
  source?: WorkspaceDefinitionSource;
  key: string;
  basis: string;
  planes: Record<string, number>;
  commandPlanes: string[];
  skipped: { id: string; kind: string; reason: string }[];
  literalPaths: string[];
}
export type LinkedDefinitionMutation = 'close-info' | 'reset';
export type DefinitionAcknowledgement = 'closed' | 'forgotten';
export type WorkspaceDefinitionRequest =
  | { kind: 'open'; key: string }
  | { kind: LinkedDefinitionMutation; workspaceID: string }
  | { kind: 'close'; workspaceID: string; withoutMemory?: boolean }
  | { kind: 'save'; workspaceID: string; order: string[]; confirmed?: boolean }
  | { kind: 'save-as'; workspaceID: string; order: string[]; key?: string; name?: string }
  | { kind: 'forget'; key: string };
export type WorkspaceDefinitionReply =
  | { kind: 'elsewhere' }
  | { kind: 'active'; workspaceID: string }
  | { kind: 'build'; definition: WorkspaceDefinition; closed?: RememberedWorkspace }
  | { kind: DefinitionAcknowledgement }
  | { kind: 'reset'; definition: WorkspaceDefinition }
  | { kind: 'close-info'; problem?: string }
  | ({ kind: 'saved' } & DefinitionSaveResult)
  | { kind: 'needs-confirmation'; curated: boolean; dropsCommands: boolean; changed?: boolean }
  | { kind: 'proposal'; key: string; name: string; root: string };
export type WorkspaceDefinitionFileRequest =
  | {
      kind: WorkspaceDefinitionFileKind;
      query?: string;
      limit?: number;
      keys?: string[];
    }
  | { kind: 'project-manager'; enabled: boolean }
  /** Not a Workspace: hides a found definition's root. */
  | { kind: 'not-a-workspace'; key: string }
  /** Shows a hidden found root again, or every one without a root. */
  | { kind: 'show-found'; root?: string }
  /** Undo of Show Hidden Again: hides again the roots it showed. */
  | { kind: 'hide-found-again' }
  /** Dismisses the workspace offer for these roots. */
  | { kind: 'dismiss-offers'; roots: string[] }
  /** Show Hidden Insights: every workspace offer shows again. */
  | { kind: 'show-offers' }
  /** Undo of Clear recent folders: the offer dismissals it cleared return. */
  | { kind: 'restore-offers' };
