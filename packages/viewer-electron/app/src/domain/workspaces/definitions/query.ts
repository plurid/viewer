import type { Workspace } from '../../contracts';
import type { WorkspaceDefinition } from './schema';
import { normalize } from '../../search/name-score';
import { boundedEditDistance } from '../../search/approximate';
import type { PathScoreBuffers, PreparedPathScore } from '../../search/path-fuzzy';
import { pathScoreBuffers, preparePathScore, scorePreparedPath } from '../../search/path-fuzzy';
import { normalizedProjectName } from './paths';

export type WorkspaceChoice =
  | {
      kind: 'open';
      workspace: Workspace;
      definition?: WorkspaceDefinition;
      id: string;
      key: string;
      score: number;
      recent: number;
    }
  | {
      kind: 'defined';
      definition: WorkspaceDefinition;
      id: string;
      key: string;
      score: number;
      recent: number;
    };

export const searchableDefinition = (definition: WorkspaceDefinition): boolean =>
  !definition.hidden && definition.rootState !== 'missing';

interface SearchText {
  text: string;
  words: string[];
  typoWords: string[];
}
interface PreparedChoice {
  name: SearchText;
  project?: SearchText;
  key: PreparedPathScore;
  leaf: string[];
  inner: string[];
  aliases: string[];
}
const searchText = (value: string): SearchText => {
  const text = normalize(value);
  return {
    text,
    words: text.split(/[\s…./-]+/).filter(Boolean),
    typoWords: text
      .split(/[\s…./_-]+/)
      .filter(Boolean)
      .slice(0, 32),
  };
};
const prepareChoice = (name: string, definition?: WorkspaceDefinition): PreparedChoice => {
  const key = preparePathScore(definition?.key ?? '');
  const segments = key.label.split('/');
  const words = (value: string) => value.split(/[\s._-]+/).filter(Boolean);
  return {
    name: searchText(name),
    project: definition?.projectName ? searchText(definition.projectName) : undefined,
    key,
    leaf: words(segments.at(-1) ?? ''),
    inner: segments.slice(0, -1).flatMap(words),
    aliases: definition?.aliases.map(normalize) ?? [],
  };
};
interface PreparedCatalog {
  byKey: Map<string, WorkspaceDefinition>;
  prepared: Map<string, PreparedChoice>;
}
const catalogs = new WeakMap<readonly WorkspaceDefinition[], PreparedCatalog>();
const choices = new Map<
  string,
  {
    name: string;
    aliases: string[];
    projectName?: string;
    value: PreparedChoice;
  }
>();
function prepareCatalog(definitions: readonly WorkspaceDefinition[]) {
  let catalog = catalogs.get(definitions);
  if (!catalog) {
    catalog = {
      byKey: new Map(definitions.map((item) => [item.key, item])),
      prepared: new Map(
        definitions.map((item) => {
          let cached = choices.get(item.key);
          if (
            !cached ||
            cached.name !== item.name ||
            cached.projectName !== item.projectName ||
            cached.aliases.length !== item.aliases.length ||
            cached.aliases.some((alias, index) => alias !== item.aliases[index])
          ) {
            cached = {
              name: item.name,
              aliases: [...item.aliases],
              projectName: item.projectName,
              value: prepareChoice(item.name, item),
            };
            choices.set(item.key, cached);
          }
          return [item.key, cached.value];
        }),
      ),
    };
    catalogs.set(definitions, catalog);
    if (choices.size > 10_000) {
      const retained = new Set(definitions.map((item) => item.key));
      for (const key of choices.keys()) if (!retained.has(key)) choices.delete(key);
    }
  }
  return catalog;
}
function textScore(label: SearchText, term: string): number {
  if (label.text.startsWith(term)) return 1000;
  if (label.words.some((word) => word.startsWith(term))) return 900;
  const index = label.text.indexOf(term);
  if (index >= 0) return Math.max(101, 800 - index);
  return 0;
}
interface TypoTerm {
  word: string;
  limit: number;
  scores: Map<string, number>;
}
type TypoCache = Map<string, TypoTerm[]>;
function preparedTypo(label: SearchText, term: string, cache: TypoCache): number {
  if (term.length < 3 || term.length > 100) return 0;
  let terms = cache.get(term);
  if (!terms) {
    terms = term
      .split(/[\s…./_-]+/)
      .filter(Boolean)
      .map((word) => ({
        word,
        limit: word.length < 3 ? 0 : word.length < 6 ? 1 : 2,
        scores: new Map(),
      }));
    cache.set(term, terms);
  }
  if (!terms.length || terms.length > 8) return 0;
  let next = 0;
  let total = 0;
  for (const item of terms) {
    let best = -1;
    let distance = item.limit + 1;
    for (let index = next; index < label.typoWords.length; index++) {
      const candidate = label.typoWords[index]!;
      if (Math.abs(item.word.length - candidate.length) > item.limit) continue;
      let value = item.scores.get(candidate);
      if (value === undefined) {
        value = boundedEditDistance(item.word, candidate, item.limit);
        item.scores.set(candidate, value);
      }
      if (value < distance) {
        best = index;
        distance = value;
      }
    }
    if (best < 0) return 0;
    next = best + 1;
    total += distance;
  }
  return Math.max(1, 60 - total * 8);
}
function weakTextScore(label: SearchText, term: string, cache: TypoCache): number {
  let position = -1;
  let first = -1;
  for (const char of term) {
    position = label.text.indexOf(char, position + 1);
    if (position < 0) return preparedTypo(label, term, cache);
    if (first < 0) first = position;
  }
  return 100 - Math.min(90, position - first - term.length + 1);
}
function preparedScore(
  choice: PreparedChoice,
  terms: readonly string[],
  buffers: PathScoreBuffers,
  cache: TypoCache,
): number {
  if (!terms.length) return 1;
  const { key, leaf, inner } = choice;
  let total = 0;
  for (const term of terms) {
    let alias = 0;
    for (const value of choice.aliases)
      alias = Math.max(alias, value === term ? 1100 : value.startsWith(term) ? 950 : 0);
    let score = Math.max(
      textScore(choice.name, term),
      alias,
      key.label === term ? 1100 : term.includes('/') && key.label.startsWith(term) ? 1000 : 0,
      leaf.includes(term) ? 1000 : leaf.some((word) => word.startsWith(term)) ? 950 : 0,
      inner.includes(term) ? 900 : inner.some((word) => word.startsWith(term)) ? 800 : 0,
      choice.project ? textScore(choice.project, term) * 0.9 : 0,
    );
    if (score < 900) score = Math.max(score, scorePreparedPath(key, term, buffers));
    if (score < 100)
      score = Math.max(
        score,
        weakTextScore(choice.name, term, cache),
        choice.project ? weakTextScore(choice.project, term, cache) * 0.9 : 0,
      );
    if (score <= 0) return 0;
    total += score;
  }
  return total / terms.length;
}
const choiceScore = (
  name: string,
  definition: WorkspaceDefinition | undefined,
  query: string,
): number =>
  preparedScore(
    prepareChoice(name, definition),
    normalize(query).trim().split(/\s+/).filter(Boolean),
    pathScoreBuffers(),
    new Map(),
  );

export function rankWorkspaceChoices(
  open: readonly Workspace[],
  defined: readonly WorkspaceDefinition[],
  query: string,
  visits: Readonly<Record<string, number>> = {},
  includeMissing = false,
): WorkspaceChoice[] {
  const { byKey, prepared } = prepareCatalog(defined);
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const buffers = pathScoreBuffers();
  const cache: TypoCache = new Map();
  const opened = new Set(
    open.flatMap((workspace) => (workspace.definition ? [workspace.definition.key] : [])),
  );
  const choices: WorkspaceChoice[] = [
    ...open.map((workspace): WorkspaceChoice => {
      const definition = workspace.definition && byKey.get(workspace.definition.key);
      return {
        kind: 'open',
        workspace,
        definition,
        id: `workspace:${workspace.id}`,
        key: workspace.definition?.key ?? workspace.id,
        score: preparedScore(
          definition && definition.name === workspace.name
            ? prepared.get(definition.key)!
            : prepareChoice(workspace.name, definition),
          terms,
          buffers,
          cache,
        ),
        recent: visits[workspace.id] ?? 0,
      };
    }),
    ...defined
      .filter(
        (definition) =>
          !definition.hidden &&
          (includeMissing || definition.rootState !== 'missing') &&
          !opened.has(definition.key),
      )
      .map((definition): WorkspaceChoice => ({
        kind: 'defined',
        definition,
        id: `defined:${definition.key}`,
        key: definition.key,
        score: preparedScore(prepared.get(definition.key)!, terms, buffers, cache),
        recent: Math.max(definition.openedAt ?? 0, definition.remembered?.at ?? 0),
      })),
  ].filter((choice) => choice.score > 0);
  const strong = choices.some((choice) => choice.score >= 400);
  const band = (score: number) => (score >= 900 ? 3 : score >= 400 ? 2 : score >= 100 ? 1 : 0);
  return choices
    .filter((choice) => choice.kind === 'open' || !strong || choice.score >= 100)
    .sort(
      (a, b) =>
        band(b.score) - band(a.score) ||
        Number(b.kind === 'open') - Number(a.kind === 'open') ||
        b.score - a.score ||
        b.recent - a.recent ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
}

export type WorkspaceQueryResult =
  | { kind: 'open'; workspaceID: string }
  | { kind: 'defined'; key: string }
  | { kind: 'picker'; query: string }
  | { kind: 'none'; query: string };

export function resolveWorkspaceQuery(
  open: readonly Workspace[],
  definitions: readonly WorkspaceDefinition[],
  query: string,
): WorkspaceQueryResult {
  const typed = query.trim();
  if (!typed) return { kind: 'picker', query: typed };
  const id = open.find((workspace) => workspace.id === typed);
  if (id) return { kind: 'open', workspaceID: id.id };
  const names = open.filter((workspace) => workspace.name === typed);
  if (names.length === 1) return { kind: 'open', workspaceID: names[0]!.id };
  if (names.length > 1) return { kind: 'picker', query: typed };
  const visible = definitions.filter(searchableDefinition);
  const finish = (matches: readonly WorkspaceDefinition[]): WorkspaceQueryResult | undefined => {
    if (!matches.length) return;
    if (matches.length > 1) return { kind: 'picker', query: typed };
    const key = matches[0]!.key;
    const workspace = open.find((workspace) => workspace.definition?.key === key);
    return workspace ? { kind: 'open', workspaceID: workspace.id } : { kind: 'defined', key };
  };
  const key =
    finish(visible.filter((definition) => definition.key === typed)) ??
    finish(visible.filter((definition) => normalize(definition.key) === normalize(typed)));
  if (key) return key;
  const name = finish(
    visible.filter((definition) => normalize(definition.name) === normalize(typed)),
  );
  if (name) return name;
  const project = finish(
    visible.filter(
      (definition) =>
        definition.projectName &&
        normalizedProjectName(definition.projectName) === normalizedProjectName(typed),
    ),
  );
  if (project) return project;
  const alias = finish(
    visible.filter((definition) =>
      definition.aliases.some((alias) => normalize(alias) === normalize(typed)),
    ),
  );
  if (alias) return alias;
  const byKey = new Map(visible.map((definition) => [definition.key, definition]));
  const opened = new Set(
    open.flatMap((workspace) => (workspace.definition ? [workspace.definition.key] : [])),
  );
  const matchingOpen = open.filter(
    (workspace) =>
      choiceScore(
        workspace.name,
        workspace.definition && byKey.get(workspace.definition.key),
        typed,
      ) > 0,
  );
  const matchingDefined = visible.filter(
    (definition) =>
      !opened.has(definition.key) && choiceScore(definition.name, definition, typed) > 0,
  );
  const count = matchingOpen.length + matchingDefined.length;
  if (count === 1)
    return matchingOpen[0]
      ? { kind: 'open', workspaceID: matchingOpen[0].id }
      : { kind: 'defined', key: matchingDefined[0]!.key };
  return { kind: count ? 'picker' : 'none', query: typed };
}
