import type { FileEntry } from '../../domain/contracts';
import { selectionKind, suggestionRules } from '../../domain/suggestions/rules';
import type {
  ModelPick,
  ModelSuggestionRequest,
  ModelSuggestions,
} from '../../domain/suggestions/model';
import { getState } from '../state/core';
import type { CommandRegistry, ResolvedCommand } from './registry';

type Answer = ModelSuggestions | 'pending' | 'failed';
interface Asked {
  /** The provider and the kinds and commands asked about: a change asks again. */
  key: string;
  answer: Answer;
}

/** Folders asked about this session, latest last. */
const asked = new Map<string, Asked>();
const kept = 64;
const ruleCommands = new Set(suggestionRules.flatMap((rule) => rule.commands));
const groups = new Set(['Quick actions', 'Images', 'Export', 'Actions', 'Git']);
/** Never offered: Trash, and the open request a person writes themselves. */
const withheld = new Set(['trash', 'describe-task']);
/** Commands a model may pick: actions on files, never navigation, editing names or Trash. */
const suggestible = (command: ResolvedCommand) =>
  !withheld.has(command.id) &&
  (ruleCommands.has(command.id) ||
    groups.has(command.group) ||
    /^(?:recipe|export)\./.test(command.id));

/** The model's picks for a kind of file in a folder, once its answer arrived. */
export function modelPicksFor(
  folder: string,
  kind: string,
): { provider: string; picks: readonly ModelPick[] } | undefined {
  const answer = asked.get(folder)?.answer;
  if (!answer || typeof answer === 'string') return undefined;
  const picks = answer.picks[kind];
  return picks ? { provider: answer.provider, picks } : undefined;
}

/** The request for a folder: its twelve commonest kinds, a few names of each and what applies. */
export function modelSuggestionRequest(
  folder: string,
  entries: readonly FileEntry[],
  applicable: (sample: FileEntry) => readonly ResolvedCommand[],
): ModelSuggestionRequest | undefined {
  const kinds = new Map<string, { count: number; samples: FileEntry[] }>();
  for (const entry of entries) {
    const kind = !entry.hidden && selectionKind([entry]);
    if (!kind) continue;
    const group = kinds.get(kind) ?? { count: 0, samples: [] };
    group.count++;
    if (group.samples.length < 8) group.samples.push(entry);
    kinds.set(kind, group);
  }
  const request: ModelSuggestionRequest['kinds'] = [];
  for (const [kind, { count, samples }] of [...kinds].sort((a, b) => b[1].count - a[1].count)) {
    if (request.length === 12) break;
    const commands = applicable(samples[0]!)
      .filter(suggestible)
      .slice(0, 40)
      .map(({ id, label }) => ({ id, label }));
    if (commands.length)
      request.push({
        kind,
        count,
        names: samples.map((entry) => entry.name.slice(0, 255)),
        commands,
      });
  }
  const name = folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
  return request.length ? { folder: name.slice(0, 255) || '/', kinds: request } : undefined;
}

/**
 * Asks the prompt model about a folder's kinds of file, when the person turned model suggestions
 * on; an answer, a refusal or a failure is kept for the session, so a folder is asked once.
 */
export function askModelAboutFolder(
  folder: string,
  entries: readonly FileEntry[],
  applicable: (sample: FileEntry) => readonly ResolvedCommand[],
): void {
  const settings = getState().settings.settings;
  if (!settings.browsing.suggestions || !settings.browsing.modelSuggestions) return;
  const provider =
    settings.providers.find((item) => item.id === settings.prompts.providerID) ??
    settings.providers[0];
  if (!provider) return;
  const request = modelSuggestionRequest(folder, entries, applicable);
  if (!request) return;
  const key = JSON.stringify([
    provider.id,
    request.kinds.map((kind) => [kind.kind, kind.commands]),
  ]);
  const earlier = asked.get(folder);
  if (earlier?.key === key) return;
  const record: Asked = { key, answer: 'pending' };
  asked.delete(folder);
  asked.set(folder, record);
  while (asked.size > kept) asked.delete(asked.keys().next().value!);
  window.viewer.modelSuggestions(request).then(
    (answer) => {
      record.answer = answer;
    },
    () => {
      record.answer = 'failed';
    },
  );
}

/** What a sample file's applicable commands are, in a folder plane. */
export function sampleCommands(
  registry: Pick<CommandRegistry, 'list'>,
  paneID: string,
  folder: string,
): (sample: FileEntry) => readonly ResolvedCommand[] {
  return (sample) =>
    registry.list({
      paneID,
      scope: 'files',
      context: { paneID, directory: folder, selection: [sample] },
    });
}

/** For tests: forget every folder asked about. */
export function forgetModelSuggestions(): void {
  asked.clear();
}
