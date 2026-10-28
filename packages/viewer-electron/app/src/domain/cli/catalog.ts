export const cliExit = {
  success: 0,
  failed: 1,
  usage: 2,
  connection: 3,
  credentials: 4,
  timeout: 124,
  cancelled: 130,
} as const;

export interface CLIArgument {
  name: string;
  description: string;
  kind?: 'path' | 'json';
  optional?: boolean;
  multiple?: boolean;
}
export interface CLIOption {
  name: string;
  description: string;
  kind: 'boolean' | 'string' | 'integer' | 'path' | 'json';
  min?: number;
  max?: number;
  values?: readonly string[];
  required?: boolean;
  default?: string | number | boolean;
}
export interface CLICommand {
  name: readonly string[];
  description: string;
  arguments?: readonly CLIArgument[];
  options?: readonly CLIOption[];
  tool?: string;
  fixed?: Readonly<Record<string, unknown>>;
  /** The operation lookup used by --wait; never an instruction to approve it. */
  poll?: string;
}
const id: CLIArgument = { name: 'id', description: 'ID returned by Viewer.' };
const file: CLIArgument = { name: 'path', description: 'A file or folder.', kind: 'path' };
const sources: CLIArgument = {
  name: 'sources',
  description: 'Source files.',
  kind: 'path',
  multiple: true,
};
const root: CLIOption = {
  name: 'root',
  description: 'Search folder; defaults to the terminal working directory.',
  kind: 'path',
  default: '.',
};
const offset: CLIOption = {
  name: 'offset',
  description: 'Zero-based result offset.',
  kind: 'integer',
  min: 0,
  max: 100000,
  default: 0,
};
const content: CLIOption = {
  name: 'content',
  description: 'Read file contents with a separate content grant.',
  kind: 'boolean',
  default: false,
};

/** One catalog owns terminal parsing, help and completion. Services retain execution authority. */
export const cliCommands: readonly CLICommand[] = [
  {
    name: ['completion'],
    description: 'Print a shell completion script without editing startup files.',
    arguments: [{ name: 'shell', description: 'bash, zsh or fish.' }],
  },
  { name: ['status'], description: 'Check the scoped connection to the running app.' },
  {
    name: ['tools', 'list'],
    description: 'List all supported service tools and their input schemas.',
  },
  {
    name: ['tools', 'call'],
    description: 'Call a service tool with validated JSON arguments.',
    arguments: [{ name: 'tool', description: 'Tool name from tools list.' }],
    options: [
      {
        name: 'args',
        description: 'Arguments as a JSON object; use - to read bounded stdin.',
        kind: 'json',
        default: '{}',
      },
    ],
  },
  {
    name: ['command', 'list'],
    description: 'List commands available in the captured Viewer context.',
    tool: 'list_commands',
  },
  {
    name: ['command', 'explain'],
    description: 'Explain an available command and its review requirements.',
    arguments: [{ ...id, name: 'commandID' }],
    tool: 'explain_command',
  },
  {
    name: ['command', 'run'],
    description: 'Submit an available command for review in Viewer.',
    arguments: [{ ...id, name: 'commandID' }],
    tool: 'propose_command',
    poll: 'get_proposal',
  },
  {
    name: ['workspace', 'list'],
    description: 'List workspaces visible within your grants.',
    tool: 'list_workspaces',
  },
  {
    name: ['workspace', 'switch'],
    description: 'Review switching to an existing workspace by exact name.',
    arguments: [{ name: 'name', description: 'Exact, unique workspace name.' }],
    tool: 'propose_workspace_switch',
    poll: 'get_proposal',
  },
  {
    name: ['workspace', 'create'],
    description: 'Open the new-workspace form after review.',
    tool: 'propose_command',
    fixed: { commandID: 'new-workspace' },
    poll: 'get_proposal',
  },
  {
    name: ['workspace', 'rename'],
    description: 'Open the current workspace rename form after review.',
    tool: 'propose_command',
    fixed: { commandID: 'rename-workspace' },
    poll: 'get_proposal',
  },
  {
    name: ['plane', 'list'],
    description: 'List visible planes in a workspace.',
    options: [
      {
        name: 'workspaceID',
        description: 'Workspace ID; omitted means the active workspace.',
        kind: 'string',
      },
    ],
    tool: 'list_planes',
  },
  {
    name: ['plane', 'open'],
    description: 'Review opening a file or folder as a plane.',
    arguments: [file],
    options: [
      {
        name: 'placement',
        description: 'Where to open the plane.',
        kind: 'string',
        values: ['current', 'root', 'linked'],
        default: 'root',
      },
    ],
    tool: 'propose_open_path',
    poll: 'get_proposal',
  },
  {
    name: ['plane', 'focus'],
    description: 'Review focusing an existing plane.',
    arguments: [{ ...id, name: 'paneID' }],
    tool: 'propose_focus_plane',
    poll: 'get_proposal',
  },
  {
    name: ['preview'],
    description: 'Review opening a linked preview of a file.',
    arguments: [file],
    tool: 'propose_open_path',
    fixed: { placement: 'linked' },
    poll: 'get_proposal',
  },
  {
    name: ['layout', 'horizontal'],
    description: 'Review arranging the current planes horizontally.',
    tool: 'propose_command',
    fixed: { commandID: 'arrange-horizontal' },
    poll: 'get_proposal',
  },
  {
    name: ['layout', 'vertical'],
    description: 'Review arranging the current planes vertically.',
    tool: 'propose_command',
    fixed: { commandID: 'arrange-vertical' },
    poll: 'get_proposal',
  },
  {
    name: ['layout', 'frame'],
    description: 'Review framing all planes.',
    tool: 'propose_command',
    fixed: { commandID: 'frame-all' },
    poll: 'get_proposal',
  },
  {
    name: ['search'],
    description: 'Search filenames or contents in an indexed granted folder.',
    arguments: [
      { name: 'query', description: 'Viewer search query; quote it as one shell argument.' },
    ],
    options: [root, offset, content],
    tool: 'search_files',
  },
  {
    name: ['inspect'],
    description: 'Read bounded metadata for a granted file.',
    arguments: [file],
    tool: 'read_metadata',
  },
  {
    name: ['read'],
    description: 'Read bounded file content with a content grant.',
    arguments: [file],
    tool: 'read_content',
  },
  {
    name: ['table'],
    description: 'Read a bounded saved-value table window.',
    arguments: [file],
    options: [
      offset,
      {
        name: 'limit',
        description: 'Rows to read.',
        kind: 'integer',
        min: 1,
        max: 200,
        default: 100,
      },
      { name: 'sheet', description: 'Worksheet name.', kind: 'string' },
    ],
    tool: 'query_table',
  },
  {
    name: ['relations'],
    description: 'Inspect granted file relationships.',
    arguments: [file],
    options: [content],
    tool: 'get_relationships',
  },
  {
    name: ['export'],
    description: 'Prepare an image, PDF or media export for review.',
    arguments: [sources],
    options: [
      {
        name: 'destination',
        description: 'Existing destination folder.',
        kind: 'path',
        required: true,
      },
      {
        name: 'plan',
        description: 'Typed transform plan as JSON, or - for stdin.',
        kind: 'json',
        required: true,
      },
      {
        name: 'name',
        description: 'Output name or base name for the export.',
        kind: 'string',
        required: true,
      },
    ],
    tool: 'propose_transform',
    poll: 'get_proposal',
  },
  {
    name: ['action', 'list'],
    description: 'List configured recipe actions.',
    tool: 'list_actions',
  },
  {
    name: ['action', 'run'],
    description: 'Prepare a recipe action; applying changes requires review.',
    arguments: [{ name: 'recipeID', description: 'Recipe ID from action list.' }, sources],
    options: [
      { name: 'instructions', description: 'Instructions for the recipe.', kind: 'string' },
      { name: 'recursive', description: 'Include subfolders.', kind: 'boolean' },
    ],
    tool: 'run_action',
    poll: 'get_task',
  },
  {
    name: ['action', 'status'],
    description: 'Read a recipe task you started.',
    arguments: [id],
    tool: 'get_task',
  },
  {
    name: ['action', 'cancel'],
    description: 'Cancel a recipe task you started.',
    arguments: [id],
    tool: 'cancel_task',
  },
  {
    name: ['review', 'status'],
    description: 'Read the status of your proposal.',
    arguments: [id],
    tool: 'get_proposal',
  },
  {
    name: ['review', 'cancel'],
    description: 'Cancel your pending or running proposal without removing its evidence.',
    arguments: [id],
    tool: 'cancel_proposal',
  },
  {
    name: ['config', 'show'],
    description: 'Read effective configuration without credentials or grants.',
    tool: 'read_config',
  },
  {
    name: ['config', 'validate'],
    description: 'Validate JSON configuration patches without applying them.',
    arguments: [
      { name: 'patches', description: 'A JSON array of patches, or - for stdin.', kind: 'json' },
    ],
    tool: 'validate_config',
  },
  {
    name: ['config', 'propose'],
    description: 'Submit JSON configuration patches for review.',
    arguments: [
      { name: 'patches', description: 'A JSON array of patches, or - for stdin.', kind: 'json' },
    ],
    tool: 'propose_config',
    poll: 'get_proposal',
  },
  {
    name: ['git', 'status'],
    description: 'Read status through the existing Git service.',
    arguments: [{ ...file, optional: true }],
    tool: 'git_status',
  },
  {
    name: ['git', 'diff'],
    description: 'Read a bounded diff against a chosen base.',
    arguments: [{ ...file, optional: true }],
    options: [
      {
        name: 'base',
        description: 'Base branch or commit; defaults to HEAD.',
        kind: 'string',
        default: 'HEAD',
      },
    ],
    tool: 'git_diff',
  },
  {
    name: ['task', 'list'],
    description: 'List task areas within granted checkouts.',
    tool: 'list_task_areas',
  },
  {
    name: ['task', 'create'],
    description: 'Open branch-to-task setup for explicit review and parameters.',
    tool: 'propose_command',
    fixed: { commandID: 'new-task-from-branch' },
    poll: 'get_proposal',
  },
  {
    name: ['workflow', 'read'],
    description: 'Read and validate a saved workflow definition.',
    arguments: [{ ...file, name: 'file' }],
    tool: 'read_workflow',
  },
  {
    name: ['workflow', 'run'],
    description: 'Run inspection steps and prepare reviewed file-change steps.',
    arguments: [{ ...file, name: 'file' }],
    options: [
      {
        name: 'bindings',
        description: 'A JSON object of named folder bindings.',
        kind: 'json',
        default: '{}',
      },
    ],
    tool: 'run_workflow',
    poll: 'get_workflow',
  },
  {
    name: ['workflow', 'list'],
    description: 'List workflow runs owned by this client.',
    tool: 'list_workflows',
  },
  {
    name: ['workflow', 'status'],
    description: 'Read a workflow run owned by this client.',
    arguments: [id],
    tool: 'get_workflow',
  },
  {
    name: ['workflow', 'resume'],
    description: 'Resume your workflow after completing its separate reviews.',
    arguments: [id],
    tool: 'resume_workflow',
    poll: 'get_workflow',
  },
  {
    name: ['workflow', 'cancel'],
    description: 'Cancel your workflow without deleting its evidence.',
    arguments: [id],
    tool: 'cancel_workflow',
  },
  {
    name: ['ask'],
    description: 'Ask the configured model for a command proposal; never auto-run its answer.',
    arguments: [
      { name: 'prompt', description: 'A natural-language request, quoted as one argument.' },
    ],
    tool: 'ask_in_words',
  },
  {
    name: ['speech', 'models'],
    description: 'List supported local speech models and installed models.',
    tool: 'speech_models',
  },
  {
    name: ['speech', 'status'],
    description: 'Inspect speech setup without recording audio.',
    tool: 'speech_status',
  },
  {
    name: ['speech', 'install'],
    description: 'Review a verified local speech-model download.',
    arguments: [{ name: 'model', description: 'Model ID from speech models.' }],
    tool: 'propose_speech_install',
    poll: 'get_proposal',
  },
  {
    name: ['speech', 'use'],
    description: 'Review choosing an installed speech model.',
    arguments: [{ name: 'model', description: 'Installed model ID.' }],
    tool: 'propose_speech_use',
    poll: 'get_proposal',
  },
  {
    name: ['speech', 'import'],
    description: 'Review importing a local file matching a pinned model checksum.',
    arguments: [
      { name: 'model', description: 'Model ID from speech models.' },
      { ...file, name: 'source' },
    ],
    tool: 'propose_speech_import',
    poll: 'get_proposal',
  },
];

export const cliGlobalOptions: readonly CLIOption[] = [
  { name: 'json', kind: 'boolean', description: 'Write one structured JSON result to stdout.' },
  {
    name: 'wait',
    kind: 'boolean',
    description: 'Wait for the submitted operation; never approves a review.',
  },
  {
    name: 'timeout',
    kind: 'integer',
    description: 'Overall request and wait deadline, in milliseconds.',
    min: 100,
    max: 600000,
    default: 30000,
  },
  { name: 'help', kind: 'boolean', description: 'Show help for this command.' },
];

export const cliRoots = [...new Set([...cliCommands.map((command) => command.name[0]!), 'help'])];
/** Explicit CLI verbs reserve their first word; -- still opens a literal legacy path. */
export function isCLIInvocation(args: readonly string[]): boolean {
  return (
    !!args.length &&
    (['--help', '-h', '--version', '-v', '--json', '--wait', '--timeout'].some(
      (flag) => args[0] === flag || args[0]?.startsWith(flag + '='),
    ) ||
      cliRoots.includes(args[0]!))
  );
}
