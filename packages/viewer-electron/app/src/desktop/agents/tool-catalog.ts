import type { AgentCapability } from '../../domain/agents/clients';
import { z } from 'zod';
import { sessionReportSchema } from '../../domain/agents/sessions';
import { transformPlanSchema } from '../../domain/operations/transforms';
import { drawingGeometryOptionsSchema } from '../../domain/previews/drawings/geometry';

interface AgentTool {
  description: string;
  /** Undefined admits any authenticated client: the handler checks ownership itself. */
  capability: AgentCapability | undefined;
  /** What the broker parses, and through `tools/list`, what agents are told. */
  input: z.ZodType;
}

const path = z.string().min(1).max(32768);
const id = z.string().min(1).max(200);
const owned = z.object({ id: z.string() }).strict();
const command = z.object({ commandID: z.string().max(200) }).strict();
/** Their handlers never read arguments, so extra keys are accepted and dropped. */
const ignored = z.object({});
/** Terminal read and write share one input: a read accepts `data` and ignores it. */
const terminal = z
  .object({
    id: z.string(),
    data: z.string().max(65536).optional(),
  })
  .strict();
const patches = z
  .object({
    patches: z
      .array(
        z
          .object({
            path: z.string().max(200),
            keys: z.array(z.string().max(32768)).max(10).optional(),
            value: z.unknown(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

/** The broker's own tools, in `tools/list` order; service tools are in service-catalog.ts. */
export const agentToolCatalog = {
  cancel_proposal: {
    description:
      'Cancel a pending or running proposal owned by the authenticated client. Preserves its evidence and any already completed output.',
    capability: undefined,
    input: owned,
  },
  report_session: {
    description:
      'Report your own session transcript, explicit working/waiting/done/failed status and file or Git-diff references. Uses a granted folder and metadata capability. Session IDs belong to your authenticated client; sequence increases on every report. Messages are append-only by ID. This does not open planes, launch commands or grant file access. Report user-visible content only; do not send secrets or hidden reasoning.',
    capability: 'metadata',
    input: sessionReportSchema,
  },
  propose_transform: {
    description:
      'Propose a typed image or media export for user review. Sources and output folder must be granted; content permission is required. Creates new files and keeps existing ones. No executable, flags, filter graph, authenticated browser state or direct apply route is available.',
    capability: 'propose',
    input: z
      .object({
        sources: z.array(path).min(1).max(16),
        destination: path,
        name: z.string().min(1).max(255),
        plan: transformPlanSchema,
      })
      .strict(),
  },
  read_drawing_geometry: {
    description:
      'Read source-versioned DXF entity bounds, lengths, areas, radii and optional bounded coordinates using Viewer’s shared drawing reader. Units are declared, never guessed. Named content permission is required; sampled/unsupported coverage is explicit.',
    capability: 'content',
    input: drawingGeometryOptionsSchema.extend({ path }).strict(),
  },
  get_relationships: {
    description:
      'Read bounded, granted operation provenance and optional local reference syntax. Private user notes are excluded; scanning contents requires a named content grant.',
    capability: 'metadata',
    input: z
      .object({
        path,
        content: z.boolean().default(false),
      })
      .strict(),
  },
  inspect_file: {
    description:
      'Inspect source-versioned facts and original evidence in a granted file. Requires a named client with content permission; OCR is explicit.',
    capability: 'content',
    input: z
      .object({
        path,
        ocr: z.boolean().default(false),
      })
      .strict(),
  },
  read_content: {
    description:
      'Read bounded extracted original passages with source versions and reader coverage.',
    capability: 'content',
    input: z.object({ path }).strict(),
  },
  query_table: {
    description:
      'Read a bounded CSV/TSV or XLSX row window with original cell anchors. XLSX sheet defaults to the first visible worksheet. Stored values and formula text only; no formulas execute.',
    capability: 'content',
    input: z
      .object({
        path,
        offset: z.number().int().min(0).max(100000).default(0),
        limit: z.number().int().min(1).max(200).default(100),
        sheet: id.optional(),
      })
      .strict(),
  },
  list_workspaces: {
    description: 'List Viewer workspaces and planes visible within the agent folder grants.',
    capability: 'metadata',
    input: z.object({}).strict(),
  },
  list_planes: {
    description:
      'List granted planes in a specific workspace. Omitted workspaceID uses the active workspace.',
    capability: 'metadata',
    input: z.object({ workspaceID: id.optional() }).strict(),
  },
  propose_open_path: {
    description:
      'Open a granted path in the captured folder, an independent root plane or a linked plane, after user review. Does not grant OS permission.',
    capability: 'navigation',
    input: z
      .object({
        path,
        placement: z.enum(['current', 'root', 'linked']).default('current'),
      })
      .strict(),
  },
  propose_selection: {
    description:
      'Select specific granted files in the captured folder after user review. Empty paths clears selection.',
    capability: 'navigation',
    input: z.object({ paths: z.array(path).max(2000) }).strict(),
  },
  propose_focus_plane: {
    description:
      'Focus a granted plane in the active workspace after user review. Use list_planes to find its ID.',
    capability: 'navigation',
    input: z.object({ paneID: id }).strict(),
  },
  propose_workspace_switch: {
    description:
      'Switch to a workspace by ID or exact unique name after user review; all destination paths must be granted.',
    capability: 'navigation',
    input: z
      .object({
        workspaceID: id.optional(),
        name: id.optional(),
      })
      .strict()
      .refine((input) => !!input.workspaceID !== !!input.name, 'Provide one workspace ID or name.')
      // JSON Schema cannot be derived from a refinement; this states the same rule.
      .meta({ oneOf: [{ required: ['workspaceID'] }, { required: ['name'] }] }),
  },
  list_commands: {
    description: 'List available commands for the captured active folder and selection.',
    capability: 'metadata',
    input: ignored,
  },
  explain_command: {
    description: 'Explain a command and whether execution requires user review.',
    capability: 'metadata',
    input: command,
  },
  propose_command: {
    description:
      'Propose a command for the captured context. Every command requires user approval. File removals use system Trash only; shell, executable and terminal execution are unavailable.',
    capability: 'propose',
    input: command,
  },
  read_config: {
    description:
      'Read the effective editable configuration, excluding credentials and execution approvals.',
    capability: 'metadata',
    input: ignored,
  },
  validate_config: {
    description: 'Validate proposed configuration patches without applying them.',
    capability: 'metadata',
    input: patches,
  },
  propose_config: {
    description: 'Submit valid configuration patches for user review.',
    capability: 'propose',
    input: patches,
  },
  read_terminal: {
    description: 'Read bounded terminal output with a separate terminal read grant.',
    capability: 'terminal-read',
    input: terminal,
  },
  get_proposal: {
    description: 'Read the status of an agent proposal.',
    capability: undefined,
    input: owned,
  },
  get_context: {
    description: 'Read the active Viewer context within your granted folders.',
    capability: 'metadata',
    input: ignored,
  },
  list_actions: {
    description: 'List available action recipes and their data requirements.',
    capability: 'metadata',
    input: ignored,
  },
  read_metadata: {
    description: 'Read metadata for a granted file.',
    capability: 'metadata',
    input: z.object({ path: z.string() }).strict(),
  },
  search_files: {
    description: 'Search an indexed granted folder.',
    capability: 'metadata',
    input: z
      .object({
        query: z.string().max(300),
        root: z.string(),
        offset: z.number().int().min(0).optional(),
        content: z.boolean().optional(),
      })
      .strict(),
  },
  run_action: {
    description: 'Run a recipe to create a proposal. The user must review file changes in Viewer.',
    capability: 'propose',
    input: z
      .object({
        recipeID: z.string(),
        sources: z.array(z.string()).min(1).max(2000),
        instructions: z.string().max(12000).optional(),
        recursive: z.boolean().optional(),
      })
      .strict(),
  },
  get_task: {
    description: 'Read a task proposal within your granted folders.',
    capability: undefined,
    input: owned,
  },
  cancel_task: {
    description: 'Cancel a task you started.',
    capability: undefined,
    input: owned,
  },
} as const satisfies Record<string, AgentTool>;

export type AgentToolName = keyof typeof agentToolCatalog;
export type AgentToolInput<Name extends AgentToolName> = z.output<
  (typeof agentToolCatalog)[Name]['input']
>;

/** Own keys only: an inherited name such as `constructor` is not a tool. */
export function isAgentToolName(name: string): name is AgentToolName {
  return Object.hasOwn(agentToolCatalog, name);
}

/** Narrows a called name to the tools one broker branch serves. */
export function isToolIn<const Names extends readonly AgentToolName[]>(
  name: string,
  names: Names,
): name is Names[number] {
  return (names as readonly string[]).includes(name);
}

export function parseToolInput<Name extends AgentToolName>(
  name: Name,
  args: unknown,
): AgentToolInput<Name> {
  const tool: AgentTool = agentToolCatalog[name];
  return tool.input.parse(args) as AgentToolInput<Name>;
}

/** Recognized but never advertised: agent terminal input stays refused (AGENTS.md), after the
 * call has passed its own capability and terminal authorization. */
export const writeTerminalInput = terminal;

/** The capability a call needs; undefined admits any authenticated client. Names outside the
 * catalog, service tools among them, keep the broker's prefix rule. */
export function toolCapability(name: string): AgentCapability | undefined {
  if (isAgentToolName(name)) return agentToolCatalog[name].capability;
  if (name === 'write_terminal') return 'terminal-write';
  return name.startsWith('propose_') || name === 'run_action' ? 'propose' : 'metadata';
}
