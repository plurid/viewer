import type { AgentCapability } from '../src/domain/agents/clients';
import type { AgentToolName } from '../src/desktop/agents/tool-catalog';
import { describe, expect, it } from 'vitest';
import { maxQueryLength } from '../src/domain/search/query';
import { agentTools } from '../src/desktop/agents/agent-tools';
import { serviceToolNames, serviceTools } from '../src/desktop/agents/service-catalog';
import {
  agentToolCatalog,
  isAgentToolName,
  toolCapability,
} from '../src/desktop/agents/tool-catalog';

/** The broker's capability rule before the catalog existed, kept as the reference. */
function previousCapability(name: string): AgentCapability | undefined {
  return ['get_task', 'cancel_task', 'get_proposal', 'cancel_proposal'].includes(name)
    ? undefined
    : ['read_terminal'].includes(name)
      ? 'terminal-read'
      : ['write_terminal'].includes(name)
        ? 'terminal-write'
        : ['inspect_file', 'read_content', 'query_table', 'read_drawing_geometry'].includes(name)
          ? 'content'
          : [
                'propose_open_path',
                'propose_selection',
                'propose_focus_plane',
                'propose_workspace_switch',
              ].includes(name)
            ? 'navigation'
            : name.startsWith('propose_') || name === 'run_action'
              ? 'propose'
              : 'metadata';
}

const toolNames = Object.keys(agentToolCatalog) as AgentToolName[];

type Schema = { [keyword: string]: unknown };
type Arguments = Record<string, unknown>;

const keywords = new Set([
  '$schema',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'enum',
  'const',
  'default',
  'oneOf',
  'anyOf',
]);

const isRecord = (value: unknown): value is Arguments =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function hasType(type: unknown, value: unknown): boolean {
  switch (type) {
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      throw new Error(`Unsupported JSON Schema type ${String(type)}`);
  }
}

function acceptsString(schema: Schema, value: string): boolean {
  const length = [...value].length;
  if (typeof schema.minLength === 'number' && length < schema.minLength) return false;
  if (typeof schema.maxLength === 'number' && length > schema.maxLength) return false;
  if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value))
    return false;
  return true;
}

function acceptsNumber(schema: Schema, value: number): boolean {
  if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
  if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return false;
  return true;
}

function acceptsArray(schema: Schema, value: unknown[]): boolean {
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false;
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return false;
  const items = schema.items as Schema | undefined;
  return !items || value.every((item) => accepts(items, item));
}

function acceptsObject(schema: Schema, value: Arguments): boolean {
  const properties = (schema.properties ?? {}) as Record<string, Schema>;
  const required = (schema.required ?? []) as string[];
  if (required.some((key) => !(key in value))) return false;
  for (const [key, item] of Object.entries(value)) {
    const property = properties[key];
    if (property) {
      if (!accepts(property, item)) return false;
    } else if (schema.additionalProperties === false) return false;
    else if (isRecord(schema.additionalProperties) && !accepts(schema.additionalProperties, item))
      return false;
  }
  return true;
}

/** The JSON Schema subset z.toJSONSchema emits for the catalog; anything else fails loudly. */
function accepts(schema: Schema, value: unknown): boolean {
  for (const keyword of Object.keys(schema))
    if (!keywords.has(keyword)) throw new Error(`Unsupported JSON Schema keyword ${keyword}`);
  if ('type' in schema && !hasType(schema.type, value)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if ('const' in schema && schema.const !== value) return false;
  if (typeof value === 'string' && !acceptsString(schema, value)) return false;
  if (typeof value === 'number' && !acceptsNumber(schema, value)) return false;
  if (Array.isArray(value) && !acceptsArray(schema, value)) return false;
  if (isRecord(value) && !acceptsObject(schema, value)) return false;
  if (Array.isArray(schema.oneOf)) {
    const matches = (schema.oneOf as Schema[]).filter((option) => accepts(option, value));
    if (matches.length !== 1) return false;
  }
  if (Array.isArray(schema.anyOf)) {
    if (!(schema.anyOf as Schema[]).some((option) => accepts(option, value))) return false;
  }
  return true;
}

/** The smallest value a simple schema accepts. */
function example(schema: Schema): unknown {
  if (Array.isArray(schema.enum)) return schema.enum[0];
  switch (schema.type) {
    case 'string':
      return 'a'.repeat(Math.max(1, Number(schema.minLength ?? 0)));
    case 'integer':
    case 'number':
      return Number(schema.minimum ?? 1);
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      const required = (schema.required ?? []) as string[];
      return Object.fromEntries(required.map((key) => [key, example(properties[key]!)]));
    }
    default:
      return null;
  }
}

/** Values at and just past a property's advertised bounds, ones of the wrong type, and ones
 * past every bound in the catalog, so a bound missing from the advertisement still shows. */
function edges(property: Schema, current: unknown): unknown[] {
  const bound = (keyword: string) =>
    typeof property[keyword] === 'number' ? (property[keyword] as number) : undefined;
  const values: unknown[] = [];
  switch (property.type) {
    case 'string': {
      const text = (length: number) =>
        (typeof current === 'string' ? current : '').padEnd(length, 'a').slice(0, length);
      values.push(1, text(1), text(70000));
      if (Array.isArray(property.enum)) values.push(...property.enum, 'other');
      const minLength = bound('minLength');
      const maxLength = bound('maxLength');
      if (minLength) values.push(text(minLength - 1), text(minLength));
      if (maxLength !== undefined) values.push(text(maxLength), text(maxLength + 1));
      return values;
    }
    case 'integer': {
      values.push(1.5, '1', -1, 2 ** 31);
      for (const keyword of ['minimum', 'exclusiveMinimum']) {
        const limit = bound(keyword);
        if (limit !== undefined) values.push(limit - 1, limit, limit + 1);
      }
      const maximum = bound('maximum');
      if (maximum !== undefined) values.push(maximum, maximum + 1);
      return values;
    }
    case 'boolean':
      return [true, false, 'true'];
    case 'array': {
      const items = (property.items ?? {}) as Schema;
      const item = Array.isArray(current) && current.length ? current[0] : example(items);
      const list = (length: number) => Array.from({ length }, () => item);
      values.push('a', [], list(1), [[]], list(2001));
      const minItems = bound('minItems');
      const maxItems = bound('maxItems');
      if (minItems) values.push(list(minItems - 1), list(minItems));
      if (maxItems !== undefined) values.push(list(maxItems), list(maxItems + 1));
      return values;
    }
    default:
      return [null, 1, {}];
  }
}

function label(value: unknown): string {
  if (typeof value === 'string' && value.length > 20) return `${value.length} characters`;
  if (Array.isArray(value) && value.length > 2) return `${value.length} items`;
  return JSON.stringify(value);
}

/** The valid sample, then one change at a time derived from the advertised schema. */
function variants(schema: Schema, sample: Arguments): [string, unknown][] {
  const cases: [string, unknown][] = [
    ['the sample', sample],
    ['an unknown key', { ...sample, unexpected: true }],
  ];
  for (const key of (schema.required ?? []) as string[]) {
    const { [key]: _omitted, ...rest } = sample;
    cases.push([`no ${key}`, rest]);
  }
  const properties = (schema.properties ?? {}) as Record<string, Schema>;
  for (const [key, property] of Object.entries(properties))
    for (const value of edges(property, sample[key]))
      cases.push([`${key}: ${label(value)}`, { ...sample, [key]: value }]);
  return cases;
}

const file = '/Granted/a.txt';
const samples: Record<AgentToolName, Arguments> = {
  cancel_proposal: { id: 'proposal' },
  report_session: {
    sessionID: 'session',
    directory: '/Granted',
    title: 'Session',
    sequence: 1,
    status: 'working',
  },
  propose_transform: {
    sources: ['/Granted/a.png'],
    destination: '/Granted',
    name: 'a.webp',
    plan: { kind: 'image', format: 'webp' },
  },
  read_drawing_geometry: { path: '/Granted/a.dxf' },
  get_relationships: { path: file },
  inspect_file: { path: file },
  read_content: { path: file },
  query_table: { path: '/Granted/a.csv' },
  list_workspaces: {},
  list_planes: {},
  propose_open_path: { path: file },
  propose_selection: { paths: [] },
  propose_focus_plane: { paneID: 'pane' },
  propose_workspace_switch: { workspaceID: 'workspace' },
  list_commands: {},
  explain_command: { commandID: 'copy-path' },
  propose_command: { commandID: 'copy-path' },
  read_config: {},
  validate_config: { patches: [] },
  propose_config: { patches: [{ path: 'ui.space.grid', value: true }] },
  read_terminal: { id: 'terminal' },
  get_proposal: { id: 'proposal' },
  get_context: {},
  list_actions: {},
  read_metadata: { path: file },
  search_files: { query: 'report', root: '/Granted' },
  run_action: { recipeID: 'recipe', sources: [file] },
  get_task: { id: 'task' },
  cancel_task: { id: 'task' },
};

/** Cases the single-field changes cannot reach: a refinement, and nested values. */
const nested: Partial<Record<AgentToolName, Arguments[]>> = {
  propose_workspace_switch: [{}, { name: 'Main' }, { workspaceID: 'workspace', name: 'Main' }],
  report_session: [
    { ...samples.report_session, entries: [{ id: 'm', role: 'user', text: 'Hi' }] },
    { ...samples.report_session, entries: [{ id: '', role: 'user', text: 'Hi' }] },
    { ...samples.report_session, entries: [{ id: 'm', role: 'system', text: 'Hi' }] },
  ],
  propose_transform: [
    { ...samples.propose_transform, plan: { kind: 'image', format: 'gif' } },
    { ...samples.propose_transform, plan: { kind: 'image', format: 'webp', quality: 0 } },
    { ...samples.propose_transform, plan: { kind: 'pdf', format: 'pdf', preset: 'small' } },
  ],
  propose_config: [
    { patches: [{ path: 'ui.space.grid' }] },
    { patches: [{ path: 'ui.space.grid', value: 1, extra: true }] },
  ],
};

const advertised = (name: string) => {
  const tool = agentTools.find((tool) => tool.name === name);
  if (!tool) throw new Error(`${name} is not advertised`);
  return tool.inputSchema as Schema;
};

describe('agent tool catalog', () => {
  it('requires the capability each tool required before the catalog', () => {
    for (const name of toolNames) {
      expect([name, agentToolCatalog[name].capability]).toEqual([name, previousCapability(name)]);
      expect([name, toolCapability(name)]).toEqual([name, previousCapability(name)]);
    }
  });

  it('keeps the earlier rule for service tools, withheld tools and unknown names', () => {
    const others = [
      ...serviceToolNames,
      'write_terminal',
      'apply',
      'delete',
      'trash',
      'empty_trash',
      'propose_unknown',
      'run_actions',
      '',
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
    ];
    for (const name of others) {
      expect(isAgentToolName(name)).toBe(false);
      expect([name, toolCapability(name)]).toEqual([name, previousCapability(name)]);
    }
  });

  it('advertises every catalog tool once, after the service tools', () => {
    expect(agentTools.map((tool) => tool.name)).toEqual([
      ...serviceTools.map((tool) => tool.name),
      ...toolNames,
    ]);
    for (const name of toolNames) {
      expect(serviceToolNames.has(name)).toBe(false);
      const tool = agentTools.find((tool) => tool.name === name);
      expect(tool?.description).toBe(agentToolCatalog[name].description);
    }
    expect(agentTools.some((tool) => tool.name === 'write_terminal')).toBe(false);
  });

  it('advertises the inputs the broker accepts', () => {
    const disagreements: string[] = [];
    let rejected = 0;
    for (const name of toolNames) {
      const schema = advertised(name);
      const input = agentToolCatalog[name].input;
      expect([name, input.safeParse(samples[name]).success]).toEqual([name, true]);
      const cases = [
        ...variants(schema, samples[name]),
        ...(nested[name] ?? []).map((value): [string, unknown] => [label(value), value]),
      ];
      for (const [description, value] of cases) {
        const parsed = input.safeParse(value).success;
        if (accepts(schema, value) !== parsed)
          disagreements.push(`${name} with ${description}: zod ${parsed ? 'accepts' : 'rejects'}`);
        if (!parsed) rejected++;
      }
    }
    expect(disagreements).toEqual([]);
    expect(rejected).toBeGreaterThan(toolNames.length * 3);
  });

  it('leaves fields with defaults optional', () => {
    expect(advertised('query_table').required).toEqual(['path']);
    expect(advertised('report_session').required).not.toContain('entries');
    expect(advertised('propose_open_path').required).toEqual(['path']);
  });

  it('advertises the search query bound the broker enforces', () => {
    expect(advertised('search_files')).toMatchObject({
      properties: { query: { type: 'string', maxLength: maxQueryLength } },
      required: ['query', 'root'],
      additionalProperties: false,
    });
  });
});
