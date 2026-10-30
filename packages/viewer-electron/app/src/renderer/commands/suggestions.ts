import type { FileEntry } from '../../domain/contracts';
import {
  selectionKind,
  suggestionRules,
  type SuggestionInput,
} from '../../domain/suggestions/rules';
import type { ModelPick } from '../../domain/suggestions/model';
import { modelPicksFor } from './model-suggestions';
import { choosePreview } from '../previews/registry';
import { knownRepository } from '../git/status';
import { getState } from '../state/core';
import type { ResolvedCommand } from './registry';

export interface Suggestion {
  command: ResolvedCommand;
  /** Why it is suggested, shown beside it: "18 MB PDF", "Your usual choice". */
  reason: string;
}

/** How much a place in the kind's history adds: the latest choice the most. */
const historyWeight = (index: number) => 60 - index * 12;
/** How much a model's pick adds: its first, below a strong rule, above a weak one. */
const modelWeight = (index: number) => 50 - index * 10;

/**
 * Commands the rules name for the selection, raised by what the person chose before for that
 * kind of file and by the model's picks, when the person let it pick; a past choice or a pick no
 * rule names may join them. Only applicable commands are offered, so a suggestion always runs.
 */
export function rankSuggestions(
  applicable: readonly ResolvedCommand[],
  input: SuggestionInput,
  history: readonly string[],
  options: {
    disabled?: ReadonlySet<string>;
    exclude?: ReadonlySet<string>;
    limit?: number;
    model?: { provider: string; picks: readonly ModelPick[] };
  } = {},
): Suggestion[] {
  const commands = new Map(applicable.map((command) => [command.id, command]));
  const usable = (id: string) => commands.has(id) && !options.exclude?.has(id);
  const scored = new Map<string, Suggestion & { score: number }>();
  for (const rule of suggestionRules) {
    if (options.disabled?.has(rule.id)) continue;
    const reason = rule.reason(input);
    const id = reason && rule.commands.find(usable);
    if (!id) continue;
    const earlier = scored.get(id);
    if (!earlier || earlier.score < rule.weight)
      scored.set(id, { command: commands.get(id)!, reason: reason!, score: rule.weight });
  }
  options.model?.picks.forEach((pick, index) => {
    if (!usable(pick.id)) return;
    const suggestion = scored.get(pick.id);
    if (suggestion) suggestion.score += modelWeight(index);
    else
      scored.set(pick.id, {
        command: commands.get(pick.id)!,
        reason: `${pick.reason} · ${options.model!.provider}`,
        score: modelWeight(index),
      });
  });
  history.forEach((id, index) => {
    const weight = historyWeight(index);
    if (weight <= 0 || !usable(id)) return;
    const suggestion = scored.get(id);
    if (suggestion) suggestion.score += weight;
    else scored.set(id, { command: commands.get(id)!, reason: 'Your usual choice', score: weight });
  });
  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 3)
    .map(({ command, reason }) => ({ command, reason }));
}

/** The suggestions for a selection, from the person's settings and history; none when they turned
 * suggestions off. */
export function suggestionsFor(
  applicable: readonly ResolvedCommand[],
  selection: readonly FileEntry[],
  limit = 3,
): Suggestion[] {
  const state = getState();
  const settings = state.settings.settings;
  if (!settings.browsing.suggestions || !selection.length) return [];
  // suggestions decorate a menu: a rule that fails on an unusual entry leaves the menu as it was
  try {
    return suggest(applicable, selection, limit);
  } catch {
    return [];
  }
}
function suggest(
  applicable: readonly ResolvedCommand[],
  selection: readonly FileEntry[],
  limit: number,
): Suggestion[] {
  const state = getState();
  const settings = state.settings.settings;
  const kind = selectionKind(selection);
  return rankSuggestions(
    applicable,
    {
      selection,
      now: Date.now(),
      home: state.bootstrap.home,
      modelReady: settings.providers.length > 0,
      editable: (entry) => choosePreview(entry).editing === 'text',
      repository: (folder) => (settings.git.enabled ? knownRepository(folder.path) : undefined),
    },
    (kind && state.saved.ui.suggestionHistory?.[kind]) || [],
    {
      disabled: new Set(settings.browsing.suggestionRulesOff),
      limit,
      model:
        kind && settings.browsing.modelSuggestions
          ? modelPicksFor(selection[0]!.parent, kind)
          : undefined,
    },
  );
}
