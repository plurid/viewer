import { z } from 'zod';
import { transformPlanSchema } from '../../domain/operations/transforms';
import { sessionReportSchema } from '../../domain/agents/sessions';
/** The MCP tools Viewer offers agents. Every call is still authorized per client,
 * capability and folder, and anything that changes files waits for review. */
export const agentTools = [
  {
    name: 'report_session',
    description:
      'Report your own session transcript, explicit working/waiting/done/failed status and file or Git-diff references. Uses a granted folder and metadata capability. Session IDs belong to your authenticated client; sequence increases on every report. Messages are append-only by ID. This does not open planes, launch commands or grant file access. Report user-visible content only; do not send secrets or hidden reasoning.',
    inputSchema: z.toJSONSchema(sessionReportSchema),
  },
  {
    name: 'propose_transform',
    description:
      'Propose a typed image or media export for user review. Sources and output folder must be granted; content permission is required. Creates new files and keeps existing ones. No executable, flags, filter graph, authenticated browser state or direct apply route is available.',
    inputSchema: {
      type: 'object',
      properties: {
        sources: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 16 },
        destination: { type: 'string' },
        name: { type: 'string', maxLength: 255 },
        plan: z.toJSONSchema(transformPlanSchema),
      },
      required: ['sources', 'destination', 'name', 'plan'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_drawing_geometry',
    description:
      'Read source-versioned DXF entity bounds, lengths, areas, radii and optional bounded coordinates using Viewer’s shared drawing reader. Units are declared, never guessed. Named content permission is required; sampled/unsupported coverage is explicit.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'integer', minimum: 0, maximum: 50000 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        layer: { type: 'string' },
        points: { type: 'boolean' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_relationships',
    description:
      'Read bounded, granted operation provenance and optional local reference syntax. Private user notes are excluded; scanning contents requires a named content grant.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'boolean' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  ...['inspect_file', 'read_content', 'query_table'].map((name) => ({
    name,
    description:
      name === 'inspect_file'
        ? 'Inspect source-versioned facts and original evidence in a granted file. Requires a named client with content permission; OCR is explicit.'
        : name === 'read_content'
          ? 'Read bounded extracted original passages with source versions and reader coverage.'
          : 'Read a bounded CSV/TSV or XLSX row window with original cell anchors. XLSX sheet defaults to the first visible worksheet. Stored values and formula text only; no formulas execute.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        ...(name === 'inspect_file'
          ? { ocr: { type: 'boolean' } }
          : name === 'query_table'
            ? {
                offset: { type: 'integer', minimum: 0 },
                limit: { type: 'integer', minimum: 1, maximum: 200 },
                sheet: { type: 'string', maxLength: 200 },
              }
            : {}),
      },
      required: ['path'],
      additionalProperties: false,
    },
  })),
  {
    name: 'list_workspaces',
    description: 'List Viewer workspaces and planes visible within the agent folder grants.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_planes',
    description:
      'List granted planes in a specific workspace. Omitted workspaceID uses the active workspace.',
    inputSchema: {
      type: 'object',
      properties: { workspaceID: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'propose_open_path',
    description:
      'Open a granted path in the captured folder, an independent root plane or a linked plane, after user review. Does not grant OS permission.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        placement: { type: 'string', enum: ['current', 'root', 'linked'] },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_selection',
    description:
      'Select specific granted files in the captured folder after user review. Empty paths clears selection.',
    inputSchema: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' }, maxItems: 2000 } },
      required: ['paths'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_focus_plane',
    description:
      'Focus a granted plane in the active workspace after user review. Use list_planes to find its ID.',
    inputSchema: {
      type: 'object',
      properties: { paneID: { type: 'string' } },
      required: ['paneID'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_workspace_switch',
    description:
      'Switch to a workspace by ID or exact unique name after user review; all destination paths must be granted.',
    inputSchema: {
      type: 'object',
      properties: { workspaceID: { type: 'string' }, name: { type: 'string' } },
      oneOf: [{ required: ['workspaceID'] }, { required: ['name'] }],
      additionalProperties: false,
    },
  },
  {
    name: 'list_commands',
    description: 'List available commands for the captured active folder and selection.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'explain_command',
    description: 'Explain a command and whether execution requires user review.',
    inputSchema: {
      type: 'object',
      properties: { commandID: { type: 'string' } },
      required: ['commandID'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_command',
    description:
      'Propose a command for the captured context. Every command requires user approval. File removals use system Trash only; shell, executable and terminal execution are unavailable.',
    inputSchema: {
      type: 'object',
      properties: { commandID: { type: 'string' } },
      required: ['commandID'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_config',
    description:
      'Read the effective editable configuration, excluding credentials and execution approvals.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'validate_config',
    description: 'Validate proposed configuration patches without applying them.',
    inputSchema: {
      type: 'object',
      properties: { patches: { type: 'array', items: { type: 'object' } } },
      required: ['patches'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_config',
    description: 'Submit valid configuration patches for user review.',
    inputSchema: {
      type: 'object',
      properties: { patches: { type: 'array', items: { type: 'object' } } },
      required: ['patches'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_terminal',
    description: 'Read bounded terminal output with a separate terminal read grant.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_proposal',
    description: 'Read the status of an agent proposal.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_context',
    description: 'Read the active Viewer context within your granted folders.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_actions',
    description: 'List available action recipes and their data requirements.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_metadata',
    description: 'Read metadata for a granted file.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_files',
    description: 'Search an indexed granted folder.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        root: { type: 'string' },
        offset: { type: 'integer' },
      },
      required: ['query', 'root'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_action',
    description: 'Run a recipe to create a proposal. The user must review file changes in Viewer.',
    inputSchema: {
      type: 'object',
      properties: {
        recipeID: { type: 'string' },
        sources: { type: 'array', items: { type: 'string' } },
        instructions: { type: 'string' },
        recursive: { type: 'boolean' },
      },
      required: ['recipeID', 'sources'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_task',
    description: 'Read a task proposal within your granted folders.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_task',
    description: 'Cancel a task you started.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];
