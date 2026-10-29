import { z } from 'zod';
import type { FileEntry } from '../contracts';
import { fileFamily } from './entries';
import { sameJSON } from '../json';

/**
 * A lens groups the items directly inside one folder without moving them. Its groups form a
 * small tree; within one lens an item belongs to exactly one group, or to Unsorted. Places are
 * map coordinates relative to the region that holds them, so moving a region carries its items.
 */
export const lensFolder = '.viewer';
export const lensSubfolder = 'lenses';
export const lensSuffix = '.lens.jsonc';
export const lensLimits = {
  bytes: 4 * 1024 * 1024,
  members: 50000,
  groups: 1000,
  depth: 8,
  lenses: 64,
} as const;

const unit = z.number().int().min(-1_000_000).max(1_000_000);
const extent = z.number().int().min(0).max(1_000_000);
export const lensRectSchema = z.tuple([unit, unit, extent, extent]);
export const lensPointSchema = z.tuple([unit, unit]);
export type LensRect = z.infer<typeof lensRectSchema>;
export type LensPoint = z.infer<typeof lensPointSchema>;
export const lensGroupIDSchema = z.string().regex(/^g[a-z0-9]{4,16}$/);
export function isLensChildName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !/[/\0]/.test(name) &&
    name !== '.' &&
    name !== '..' &&
    name !== lensFolder
  );
}
export const lensChildNameSchema = z
  .string()
  .refine(isLensChildName, 'Use the name of an item directly inside this folder.');
export const lensTypes = [
  'folder',
  'file',
  'image',
  'audio',
  'video',
  'pdf',
  'drawing',
  'model',
  'archive',
  'data',
  'code',
] as const;
const dateRule = {
  year: z.number().int().min(1970).max(9999).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
};
export const lensRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('name'), glob: z.string().trim().min(1).max(200) }).strict(),
  z
    .object({
      kind: z.literal('extension'),
      values: z
        .array(z.string().regex(/^[a-z0-9_+-]{1,32}$/))
        .min(1)
        .max(50),
    })
    .strict(),
  z.object({ kind: z.literal('type'), value: z.enum(lensTypes) }).strict(),
  z.object({ kind: z.literal('created'), ...dateRule }).strict(),
  z.object({ kind: z.literal('modified'), ...dateRule }).strict(),
]);
export type LensRule = z.infer<typeof lensRuleSchema>;
export const lensGroupSchema = z
  .object({
    id: lensGroupIDSchema,
    name: z.string().trim().min(1).max(100),
    parent: lensGroupIDSchema.optional(),
    order: z.number().int().min(-1_000_000).max(1_000_000),
    /** Whether every rule must match (the default) or any one of them. */
    match: z.enum(['all', 'any']).optional(),
    rules: z.array(lensRuleSchema).max(16).optional(),
    rect: lensRectSchema.optional(),
    /** Depth and turn for groups lifted into space as planes. */
    space: z
      .object({
        depth: unit.optional(),
        angle: z.number().int().min(-180).max(180).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LensGroup = z.infer<typeof lensGroupSchema>;
export const lensMemberSchema = z
  .object({
    name: lensChildNameSchema,
    /** Absent: placed in Unsorted on purpose, which rules cannot override. */
    group: lensGroupIDSchema.optional(),
    at: lensPointSchema.optional(),
  })
  .strict();
export type LensMember = z.infer<typeof lensMemberSchema>;
export const lensSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('viewer-lens'),
    id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    order: z.number().int().min(-1_000_000).max(1_000_000),
    unsorted: z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        rect: lensRectSchema.optional(),
      })
      .strict()
      .optional(),
    groups: z.array(lensGroupSchema).max(lensLimits.groups),
    members: z.array(lensMemberSchema).max(lensLimits.members),
  })
  .strict()
  .superRefine((lens, context) => {
    for (const [index, group] of lens.groups.entries())
      for (const rule of group.rules ?? [])
        if (
          (rule.kind === 'created' || rule.kind === 'modified') &&
          rule.year === undefined &&
          !rule.from &&
          !rule.to
        )
          context.addIssue({
            code: 'custom',
            path: ['groups', index, 'rules'],
            message: 'A date rule needs a year or a range.',
          });
  });
export type Lens = z.infer<typeof lensSchema>;

export type LensOp =
  /** Puts an item in a group (null: Unsorted) at a place, or lets the layout place it. */
  | { kind: 'place'; name: string; group: string | null; at?: LensPoint }
  /** Removes an item's entry, so rules or Unsorted decide again. */
  | { kind: 'forget'; name: string }
  | { kind: 'rename-member'; from: string; to: string }
  /** Adds a group or replaces its definition. */
  | { kind: 'set-group'; group: LensGroup }
  /** Subgroups move to the parent; items move to the parent or back to automatic placement. */
  | { kind: 'delete-group'; id: string }
  | {
      kind: 'set-lens';
      name?: string;
      order?: number;
      unsorted?: Lens['unsorted'] | null;
    };
export const lensOpSchema: z.ZodType<LensOp> = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('place'),
      name: lensChildNameSchema,
      group: lensGroupIDSchema.nullable(),
      at: lensPointSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('forget'), name: lensChildNameSchema }).strict(),
  z
    .object({
      kind: z.literal('rename-member'),
      from: lensChildNameSchema,
      to: lensChildNameSchema,
    })
    .strict(),
  z.object({ kind: z.literal('set-group'), group: lensGroupSchema }).strict(),
  z.object({ kind: z.literal('delete-group'), id: lensGroupIDSchema }).strict(),
  z
    .object({
      kind: z.literal('set-lens'),
      name: z.string().trim().min(1).max(100).optional(),
      order: z.number().int().min(-1_000_000).max(1_000_000).optional(),
      unsorted: lensSchema.shape.unsorted.nullable().optional(),
    })
    .strict(),
]);

const groupOrder = (a: LensGroup, b: LensGroup) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const codePoints = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Groups depth-first, siblings by order then ID. */
export function lensGroupTree(lens: Pick<Lens, 'groups'>): { group: LensGroup; depth: number }[] {
  const children = new Map<string | undefined, LensGroup[]>();
  for (const group of lens.groups) {
    const siblings = children.get(group.parent) ?? [];
    siblings.push(group);
    children.set(group.parent, siblings);
  }
  const result: { group: LensGroup; depth: number }[] = [];
  const visit = (parent: string | undefined, depth: number) => {
    for (const group of (children.get(parent) ?? []).toSorted(groupOrder)) {
      result.push({ group, depth });
      visit(group.id, depth + 1);
    }
  };
  visit(undefined, 0);
  return result;
}

/**
 * Lens files can come from colleagues, sync conflicts or hand edits. Repair rather than reject:
 * duplicate IDs and names keep their first entry, broken or cyclic parents become top level, and
 * items in a group that no longer exists return to automatic placement.
 */
export function normalizeLens(input: Lens): { lens: Lens; repairs: string[] } {
  const repairs: string[] = [];
  const groups = new Map<string, LensGroup>();
  for (const group of input.groups)
    if (groups.has(group.id)) repairs.push(`Removed a duplicate group ID ${group.id}.`);
    else groups.set(group.id, group);
  for (const [id, group] of groups) {
    if (group.parent === undefined) continue;
    let parent: string | undefined = group.parent,
      depth = 1,
      broken = '';
    const seen = new Set([id]);
    while (parent !== undefined && !broken) {
      const next = groups.get(parent);
      if (!next) broken = 'its parent no longer exists';
      else if (seen.has(parent)) broken = 'its parents formed a loop';
      else if (++depth > lensLimits.depth) broken = 'it was nested too deeply';
      else {
        seen.add(parent);
        parent = next.parent;
      }
    }
    if (broken) {
      const { parent: _, ...rest } = group;
      groups.set(id, rest);
      repairs.push(`Moved group "${group.name}" to the top level because ${broken}.`);
    }
  }
  const members = new Map<string, LensMember>();
  for (const member of input.members) {
    if (members.has(member.name)) {
      repairs.push(`Removed a duplicate entry for "${member.name}".`);
      continue;
    }
    if (member.group !== undefined && !groups.has(member.group)) {
      repairs.push(`"${member.name}" returned to automatic placement; its group was removed.`);
      continue;
    }
    members.set(member.name, member);
  }
  return {
    lens: { ...input, groups: [...groups.values()], members: [...members.values()] },
    repairs,
  };
}

function ancestors(groups: ReadonlyMap<string, LensGroup>, id: string | undefined): string[] {
  const result: string[] = [];
  for (let current = id; current !== undefined; current = groups.get(current)?.parent) {
    if (result.includes(current) || result.length > lensLimits.depth) break;
    result.push(current);
  }
  return result;
}

/** Applies edits to the latest lens; edits whose target vanished are skipped and reported. */
export function applyLensOps(
  input: Lens,
  ops: readonly LensOp[],
): { lens: Lens; dropped: string[] } {
  const dropped: string[] = [];
  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const members = new Map(input.members.map((member) => [member.name, member]));
  let lens: Lens = { ...input };
  for (const op of ops) {
    if (op.kind === 'place') {
      if (op.group !== null && !groups.has(op.group)) {
        dropped.push(`"${op.name}" was not placed; its group was removed.`);
        continue;
      }
      if (!members.has(op.name) && members.size >= lensLimits.members) {
        dropped.push(`"${op.name}" was not placed; this lens is full.`);
        continue;
      }
      members.set(op.name, {
        name: op.name,
        ...(op.group !== null ? { group: op.group } : {}),
        ...(op.at ? { at: op.at } : {}),
      });
    } else if (op.kind === 'forget') members.delete(op.name);
    else if (op.kind === 'rename-member') {
      const member = members.get(op.from);
      if (!member || op.from === op.to) continue;
      members.delete(op.from);
      members.set(op.to, { ...member, name: op.to });
    } else if (op.kind === 'set-group') {
      const { group } = op;
      if (group.parent !== undefined) {
        if (!groups.has(group.parent)) {
          dropped.push(`Group "${group.name}" was not saved; its parent was removed.`);
          continue;
        }
        const chain = ancestors(groups, group.parent);
        if (chain.includes(group.id)) {
          dropped.push(`Group "${group.name}" cannot be placed inside itself.`);
          continue;
        }
        if (chain.length + 1 + subtreeHeight(groups, group.id) > lensLimits.depth) {
          dropped.push(`Group "${group.name}" would nest too deeply.`);
          continue;
        }
      }
      if (!groups.has(group.id) && groups.size >= lensLimits.groups) {
        dropped.push(`Group "${group.name}" was not added; this lens has too many groups.`);
        continue;
      }
      groups.set(group.id, group);
    } else if (op.kind === 'delete-group') {
      const group = groups.get(op.id);
      if (!group) continue;
      for (const [id, child] of groups)
        if (child.parent === op.id) {
          const { parent: _, ...rest } = child;
          groups.set(id, group.parent !== undefined ? { ...rest, parent: group.parent } : rest);
        }
      for (const [name, member] of members)
        if (member.group === op.id) {
          if (group.parent !== undefined) members.set(name, { name, group: group.parent });
          else members.delete(name);
        }
      groups.delete(op.id);
    } else {
      lens = {
        ...lens,
        ...(op.name !== undefined ? { name: op.name } : {}),
        ...(op.order !== undefined ? { order: op.order } : {}),
      };
      if (op.unsorted === null) {
        const { unsorted: _, ...rest } = lens;
        lens = rest;
      } else if (op.unsorted !== undefined) lens = { ...lens, unsorted: op.unsorted };
    }
  }
  return {
    lens: { ...lens, groups: [...groups.values()], members: [...members.values()] },
    dropped,
  };
}
function subtreeHeight(groups: ReadonlyMap<string, LensGroup>, id: string): number {
  let height = 0;
  for (const group of groups.values())
    if (group.parent === id) height = Math.max(height, 1 + subtreeHeight(groups, group.id));
  return height;
}

/** Edits turning `from` into `to`; used for Undo, so they touch only what differs. */
export function diffLensOps(from: Lens, to: Lens): LensOp[] {
  const ops: LensOp[] = [];
  const before = new Map(from.groups.map((group) => [group.id, group]));
  const after = new Map(to.groups.map((group) => [group.id, group]));
  if (from.name !== to.name || from.order !== to.order || !sameJSON(from.unsorted, to.unsorted))
    ops.push({
      kind: 'set-lens',
      ...(from.name !== to.name ? { name: to.name } : {}),
      ...(from.order !== to.order ? { order: to.order } : {}),
      ...(!sameJSON(from.unsorted, to.unsorted) ? { unsorted: to.unsorted ?? null } : {}),
    });
  for (const { group } of lensGroupTree(to))
    if (!sameJSON(before.get(group.id), group)) ops.push({ kind: 'set-group', group });
  const previous = new Map(from.members.map((member) => [member.name, member]));
  const next = new Map(to.members.map((member) => [member.name, member]));
  for (const [name, member] of next)
    if (!sameJSON(previous.get(name), member))
      ops.push({
        kind: 'place',
        name,
        group: member.group ?? null,
        ...(member.at ? { at: member.at } : {}),
      });
  for (const name of previous.keys()) if (!next.has(name)) ops.push({ kind: 'forget', name });
  for (const { group } of lensGroupTree(from).toReversed())
    if (!after.has(group.id)) ops.push({ kind: 'delete-group', id: group.id });
  return ops;
}

/** A case-insensitive glob over one name: `*`, `?` and `[a-z]`/`[!abc]` classes. Linear-time
 * backtracking to the last star keeps hostile patterns from stalling the renderer. */
export function matchGlob(pattern: string, name: string): boolean {
  type Token = { kind: 'star' } | { kind: 'one' } | { kind: 'set'; test(c: string): boolean };
  const tokens: Token[] = [];
  const text = [...pattern.normalize('NFC').toLocaleLowerCase()];
  for (let index = 0; index < text.length; index++) {
    const c = text[index]!;
    if (c === '*') {
      if (tokens.at(-1)?.kind !== 'star') tokens.push({ kind: 'star' });
    } else if (c === '?') tokens.push({ kind: 'one' });
    else if (c === '[' && text.indexOf(']', index + 2) > 0) {
      const end = text.indexOf(']', index + 2);
      let body = text.slice(index + 1, end);
      const negate = body[0] === '!' || body[0] === '^';
      if (negate) body = body.slice(1);
      const ranges: [string, string][] = [];
      for (let i = 0; i < body.length; i++)
        if (body[i + 1] === '-' && body[i + 2] !== undefined) {
          ranges.push([body[i]!, body[i + 2]!]);
          i += 2;
        } else ranges.push([body[i]!, body[i]!]);
      tokens.push({
        kind: 'set',
        test: (value) => ranges.some(([a, b]) => value >= a && value <= b) !== negate,
      });
      index = end;
    } else tokens.push({ kind: 'set', test: (value) => value === c });
  }
  const value = [...name.normalize('NFC').toLocaleLowerCase()];
  let t = 0,
    v = 0,
    star = -1,
    resume = 0;
  while (v < value.length) {
    const token = tokens[t];
    if (token && token.kind !== 'star' && (token.kind === 'one' || token.test(value[v]!))) {
      t++;
      v++;
    } else if (token?.kind === 'star') {
      star = t++;
      resume = v;
    } else if (star >= 0) {
      t = star + 1;
      v = ++resume;
    } else return false;
  }
  while (tokens[t]?.kind === 'star') t++;
  return t === tokens.length;
}
const localDay = (time: number) => {
  const date = new Date(time);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index ? 2 : 4, '0'))
    .join('-');
};
export function lensRuleMatches(rule: LensRule, entry: FileEntry): boolean {
  if (rule.kind === 'name') return matchGlob(rule.glob, entry.name);
  if (rule.kind === 'extension')
    return !entry.directory && rule.values.includes(entry.extension.toLowerCase());
  if (rule.kind === 'type')
    return rule.value === 'folder'
      ? entry.directory
      : rule.value === 'file'
        ? !entry.directory
        : fileFamily(entry) === rule.value;
  const time = entry[rule.kind];
  if (!time) return false;
  const day = localDay(time);
  return (
    (rule.year === undefined || day.startsWith(String(rule.year).padStart(4, '0') + '-')) &&
    (!rule.from || day >= rule.from) &&
    (!rule.to || day <= rule.to)
  );
}
export function lensGroupMatches(group: LensGroup, entry: FileEntry): boolean {
  const rules = group.rules ?? [];
  if (!rules.length) return false;
  return group.match === 'any'
    ? rules.some((rule) => lensRuleMatches(rule, entry))
    : rules.every((rule) => lensRuleMatches(rule, entry));
}

const nameKey = (name: string) => name.normalize('NFC').toLocaleLowerCase();
/**
 * Pairs a lens's members with the folder's current names. Exact names win; otherwise a single
 * unclaimed name equal after Unicode normalization and case folding, then a single unclaimed
 * item carrying the member's remembered identity (a Finder rename). Anything ambiguous stays
 * missing rather than guessing.
 */
export function matchLensMembers(
  members: readonly Pick<LensMember, 'name'>[],
  names: Iterable<string>,
  identity?: { hints: ReadonlyMap<string, string>; of: ReadonlyMap<string, string> },
): { matched: Map<string, string>; missing: string[]; renames: { from: string; to: string }[] } {
  const present = new Set(names);
  const matched = new Map<string, string>();
  const claimed = new Set<string>();
  const unresolved: string[] = [];
  for (const { name } of members)
    if (present.has(name)) {
      matched.set(name, name);
      claimed.add(name);
    } else unresolved.push(name);
  const renames: { from: string; to: string }[] = [];
  if (unresolved.length) {
    const byKey = new Map<string, string[]>();
    for (const name of present)
      if (!claimed.has(name)) {
        const list = byKey.get(nameKey(name)) ?? [];
        list.push(name);
        byKey.set(nameKey(name), list);
      }
    const wanted = new Map<string, number>();
    for (const name of unresolved) wanted.set(nameKey(name), (wanted.get(nameKey(name)) ?? 0) + 1);
    for (const name of [...unresolved]) {
      const candidates = byKey.get(nameKey(name));
      if (candidates?.length === 1 && wanted.get(nameKey(name)) === 1) {
        const target = candidates[0]!;
        matched.set(name, target);
        claimed.add(target);
        renames.push({ from: name, to: target });
        unresolved.splice(unresolved.indexOf(name), 1);
      }
    }
  }
  if (unresolved.length && identity) {
    const byIdentity = new Map<string, string[]>();
    for (const name of present) {
      const id = identity.of.get(name);
      if (!id) continue;
      const list = byIdentity.get(id) ?? [];
      list.push(name);
      byIdentity.set(id, list);
    }
    const claims = new Map<string, number>();
    for (const name of unresolved) {
      const id = identity.hints.get(name);
      if (id) claims.set(id, (claims.get(id) ?? 0) + 1);
    }
    for (const name of [...unresolved]) {
      const id = identity.hints.get(name);
      const candidates = id ? byIdentity.get(id) : undefined;
      if (!id || claims.get(id) !== 1 || candidates?.length !== 1) continue;
      const target = candidates[0]!;
      if (claimed.has(target)) continue;
      matched.set(name, target);
      claimed.add(target);
      renames.push({ from: name, to: target });
      unresolved.splice(unresolved.indexOf(name), 1);
    }
  }
  return { matched, missing: unresolved, renames };
}

export interface LensSection {
  /** null is Unsorted. */
  id: string | null;
  name: string;
  depth: number;
  /** Ancestor names, outermost first. */
  path: string[];
  entries: FileEntry[];
}
export interface LensPlacement {
  group: string | null;
  at?: LensPoint;
  /** False when a rule or Unsorted placed the item. */
  manual: boolean;
}
export interface ResolvedLens {
  sections: LensSection[];
  /** By item path. */
  placements: Map<string, LensPlacement>;
  missing: string[];
  /** Name repairs to save: case/normalization differences found while matching. */
  renames: { from: string; to: string }[];
}
export const unsortedName = (lens: Pick<Lens, 'unsorted'>) => lens.unsorted?.name ?? 'Unsorted';
/** Items keep their incoming order inside each section; sections run depth-first, Unsorted last. */
export function resolveLens(lens: Lens, entries: readonly FileEntry[]): ResolvedLens {
  const items = entries.filter(
    (entry) => isLensChildName(entry.name) && entry.name !== '.DS_Store',
  );
  const byName = new Map(items.map((entry) => [entry.name, entry]));
  const { matched, missing, renames } = matchLensMembers(lens.members, byName.keys());
  const tree = lensGroupTree(lens);
  const groups = new Map(tree.map(({ group }) => [group.id, group]));
  const placements = new Map<string, LensPlacement>();
  const manual = new Set<string>();
  for (const member of lens.members) {
    const name = matched.get(member.name);
    const entry = name === undefined ? undefined : byName.get(name);
    if (!entry) continue;
    manual.add(entry.name);
    placements.set(entry.path, {
      group: member.group !== undefined && groups.has(member.group) ? member.group : null,
      ...(member.at ? { at: member.at } : {}),
      manual: true,
    });
  }
  // The most specific group wins: children are tried before their parent.
  const ruleOrder: LensGroup[] = [];
  const children = new Map<string | undefined, LensGroup[]>();
  for (const { group } of tree) {
    const siblings = children.get(group.parent) ?? [];
    siblings.push(group);
    children.set(group.parent, siblings);
  }
  const visit = (parent: string | undefined) => {
    for (const group of children.get(parent) ?? []) {
      visit(group.id);
      if (group.rules?.length) ruleOrder.push(group);
    }
  };
  visit(undefined);
  for (const entry of items)
    if (!manual.has(entry.name))
      placements.set(entry.path, {
        group: ruleOrder.find((group) => lensGroupMatches(group, entry))?.id ?? null,
        manual: false,
      });
  const buckets = new Map<string | null, FileEntry[]>();
  for (const entry of items) {
    const group = placements.get(entry.path)?.group ?? null;
    const list = buckets.get(group) ?? [];
    list.push(entry);
    buckets.set(group, list);
  }
  const names = (id: string | undefined): string[] => {
    const result: string[] = [];
    for (let current = id; current !== undefined; current = groups.get(current)?.parent) {
      const group = groups.get(current);
      if (!group || result.length > lensLimits.depth) break;
      result.unshift(group.name);
    }
    return result;
  };
  return {
    sections: [
      ...tree.map(({ group, depth }) => ({
        id: group.id,
        name: group.name,
        depth,
        path: names(group.parent),
        entries: buckets.get(group.id) ?? [],
      })),
      { id: null, name: unsortedName(lens), depth: 0, path: [], entries: buckets.get(null) ?? [] },
    ],
    placements,
    missing,
    renames,
  };
}

export const lensHeader = [
  '// Viewer lens: groups the items in this folder without moving them.',
  '// Groups and places are shared with everyone who has this folder. Deleting this file,',
  '// or the .viewer folder, never touches your files. Viewer writes it in a fixed order,',
  '// one item per line, so changes merge cleanly in sync tools and version control.',
].join('\n');
const groupLine = (group: LensGroup) =>
  JSON.stringify({
    id: group.id,
    name: group.name,
    ...(group.parent !== undefined ? { parent: group.parent } : {}),
    order: group.order,
    ...(group.match ? { match: group.match } : {}),
    ...(group.rules?.length ? { rules: group.rules } : {}),
    ...(group.rect ? { rect: group.rect } : {}),
    ...(group.space ? { space: group.space } : {}),
  });
const memberLine = (member: LensMember) =>
  JSON.stringify({
    name: member.name,
    ...(member.group !== undefined ? { group: member.group } : {}),
    ...(member.at ? { at: member.at } : {}),
  });
const block = (lines: string[]) =>
  lines.length ? '[\n' + lines.map((line) => '    ' + line).join(',\n') + '\n  ]' : '[]';
/** The same lens always produces the same bytes, on any Mac and in any locale. */
export function formatLens(lens: Lens): string {
  const groups = lensGroupTree(lens).map(({ group }) => groupLine(group));
  const members = lens.members.toSorted((a, b) => codePoints(a.name, b.name)).map(memberLine);
  return (
    lensHeader +
    '\n{\n' +
    [
      `  "version": 1`,
      `  "kind": "viewer-lens"`,
      `  "id": ${JSON.stringify(lens.id)}`,
      `  "name": ${JSON.stringify(lens.name)}`,
      `  "order": ${lens.order}`,
      ...(lens.unsorted ? [`  "unsorted": ${JSON.stringify(lens.unsorted)}`] : []),
      `  "groups": ${block(groups)}`,
      `  "members": ${block(members)}`,
    ].join(',\n') +
    '\n}\n'
  );
}

/** A short random group ID; collisions are checked by callers against the lens. */
export function newLensGroupID(existing: Iterable<string>, random = () => Math.random()): string {
  const taken = new Set(existing);
  for (;;) {
    let id = 'g';
    for (let i = 0; i < 8; i++)
      id += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 36)];
    if (!taken.has(id)) return id;
  }
}
/** A file name for a new lens: lowercase words joined by hyphens, unique among `taken`. */
export function lensFileName(name: string, taken: Iterable<string>): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'lens';
  const used = new Set([...taken].map((file) => file.toLowerCase()));
  for (let index = 1; ; index++) {
    const file = (index === 1 ? base : `${base}-${index}`) + lensSuffix;
    if (!used.has(file)) return file;
  }
}
export function emptyLens(id: string, name: string, order = 0): Lens {
  return { version: 1, kind: 'viewer-lens', id, name, order, groups: [], members: [] };
}

export interface LensDocument {
  file: string;
  revision: string;
  lens: Lens;
  /** Kept in Viewer's data on this Mac because the folder cannot hold it. */
  local: boolean;
  writable: boolean;
  /** Problems fixed while reading, saved with the next edit. */
  repairs: string[];
}
export interface LensFolder {
  folder: string;
  /** By order, then name. */
  lenses: LensDocument[];
  broken: { file: string; message: string }[];
  /** Whether new lenses are stored inside the folder, rather than only on this Mac. */
  shared: boolean;
  /** Collapsed group IDs by lens ID; this person's view only. */
  collapsed: Record<string, string[]>;
}
export type LensRequest =
  | { kind: 'list'; folder: string }
  | { kind: 'create'; folder: string; name: string; ops?: LensOp[] }
  | { kind: 'apply'; folder: string; file: string; ops: LensOp[] }
  | { kind: 'trash'; folder: string; file: string }
  | { kind: 'share'; folder: string; file: string }
  | { kind: 'collapse'; lens: string; groups: string[] };
export interface LensApplied {
  document: LensDocument;
  dropped: string[];
}
export type LensReply = LensFolder | LensDocument | LensApplied | { job?: string } | null;
