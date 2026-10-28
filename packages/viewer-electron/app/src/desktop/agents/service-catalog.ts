const object = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const path = { type: 'string', minLength: 1, maxLength: 32768 };
const id = { type: 'string', minLength: 1, maxLength: 200 };
const file = object({ file: path }, ['file']);
const operation = object({ id }, ['id']);

export const serviceTools = [
  {
    name: 'git_status',
    description: 'Read Git status in a granted repository. No program writes or shell execution.',
    inputSchema: object({ path }, ['path']),
  },
  {
    name: 'git_diff',
    description:
      'Read a bounded tracked-file diff against a branch or commit in a granted repository.',
    inputSchema: object({ path, base: id }, ['path']),
  },
  {
    name: 'list_task_areas',
    description:
      'List task area names and checkout metadata within granted folders. Excludes private documents.',
    inputSchema: object(),
  },
  {
    name: 'read_workflow',
    description: 'Read and validate a granted saved workflow definition without running it.',
    inputSchema: file,
  },
  {
    name: 'run_workflow',
    description:
      'Run a granted workflow as the authenticated client. Mutation steps only prepare reviews; no shell execution.',
    inputSchema: object({ file: path, bindings: { type: 'object', additionalProperties: path } }, [
      'file',
    ]),
  },
  {
    name: 'list_workflows',
    description: 'List workflow runs owned by the authenticated client within its current grants.',
    inputSchema: object(),
  },
  ...['get_workflow', 'resume_workflow', 'cancel_workflow'].map((name) => ({
    name,
    description:
      'Inspect, resume or cancel only a workflow owned by the authenticated client. Review remains separate.',
    inputSchema: operation,
  })),
  {
    name: 'ask_in_words',
    description:
      'Ask the configured model for a command proposal with permitted names. Never executes the result or grants provider permission.',
    inputSchema: object({ prompt: { type: 'string', minLength: 1, maxLength: 12000 } }, ['prompt']),
  },
  ...['speech_models', 'speech_status'].map((name) => ({
    name,
    description:
      'Read local speech-model catalog and installation state. Does not record, contact a provider or enable recognition.',
    inputSchema: object(),
  })),
  ...['propose_speech_install', 'propose_speech_use'].map((name) => ({
    name,
    description:
      'Prepare local speech-model setup for native review. Only pinned catalog weights are supported; no executable installation or recording.',
    inputSchema: object({ model: id }, ['model']),
  })),
  {
    name: 'propose_speech_import',
    description:
      'Review importing a granted local file that matches a pinned speech model checksum.',
    inputSchema: object({ model: id, source: path }, ['model', 'source']),
  },
];
export const serviceToolNames = new Set(serviceTools.map((tool) => tool.name));
