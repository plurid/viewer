import {
  promptInput,
  promptInstructions,
  promptLineProblem,
  promptAnswerSchema,
  promptSchema,
  type PromptAnswer,
  type PromptRequest,
} from '../../domain/command-line/prompt';
import type { SpokenAnswer, SpokenRequest } from '../../domain/command-line/spoken';
import {
  boundedSpokenAnswer,
  spokenAnswerSchema,
  spokenInput,
  spokenInstructions,
  spokenSchema,
} from '../../domain/command-line/spoken';
import { z } from 'zod';
import type { ModelDataLevel } from '../../domain/models/permissions';
import { providerPresets } from '../../domain/models/providers';
import {
  modelPicks,
  modelSuggestionAnswerSchema,
  modelSuggestionInstructions,
  type ModelSuggestionRequest,
  type ModelSuggestions,
} from '../../domain/suggestions/model';
import type { ApplicationSettings, ModelProvider, RequestActor } from '../../domain/services';

type Generate = (
  provider: ModelProvider,
  instructions: string,
  input: unknown,
  schema: Record<string, unknown>,
  signal: AbortSignal,
  level: ModelDataLevel,
  actor: RequestActor,
) => Promise<unknown>;
/** The model prompts ask: the one Settings → Models names for them, or the first. */
export function promptProvider(settings: ApplicationSettings): ModelProvider | undefined {
  return (
    settings.providers.find((provider) => provider.id === settings.prompts.providerID) ??
    settings.providers[0]
  );
}
/**
 * A prompt answered: the model, at the "names" level its permission allows, gives a
 * line and a sentence; the line is checked as the command line would and as a model's must be.
 */
export async function answerPrompt(
  request: PromptRequest,
  settings: ApplicationSettings,
  generate: Generate,
  signal: AbortSignal,
  userCommands: ReadonlyMap<string, readonly string[]> = new Map(),
  actor: RequestActor = 'user',
): Promise<PromptAnswer> {
  const provider = promptProvider(settings);
  if (!provider) throw new Error('Add a model in Settings → Models to ask in words.');
  const raw = await generate(
    provider,
    promptInstructions(request.context),
    promptInput(request),
    promptSchema,
    signal,
    'names',
    actor,
  );
  const parsed = promptAnswerSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error('The model returned an invalid command response. Try again.');
  const line = parsed.data.line.trim().replace(/^:/, '');
  const explanation = parsed.data.explanation.trim().slice(0, 300);
  const problem = line
    ? promptLineProblem(
        line,
        new Set(request.context.commands.map((command) => command.id)),
        settings.customActions,
        userCommands,
      )
    : undefined;
  return { line, explanation, ...(problem ? { problem } : {}) };
}
/**
 * A spoken request read by Ask Viewer's model, at the "names" level its permission allows: a plan
 * of command IDs, which the window checks against the commands where the person spoke before any
 * runs (domain/command-line/spoken.ts).
 */
export async function answerSpoken(
  request: SpokenRequest,
  settings: ApplicationSettings,
  generate: Generate,
  signal: AbortSignal,
): Promise<SpokenAnswer> {
  const provider = promptProvider(settings);
  if (!provider) throw new Error('Add a model in Settings → Models to ask in words.');
  const raw = await generate(
    provider,
    spokenInstructions(request.context),
    spokenInput(request),
    spokenSchema,
    signal,
    'names',
    'user',
  );
  const parsed = spokenAnswerSchema.safeParse(raw);
  if (!parsed.success) throw new Error('The model returned an invalid plan. Try again.');
  return {
    ...boundedSpokenAnswer(parsed.data),
    by: providerPresets[provider.kind].family ?? provider.name,
  };
}

const suggestionSchema = z.toJSONSchema(modelSuggestionAnswerSchema);
/**
 * The prompt model's picks for a folder's kinds of file, at the "names" level: only names and
 * the commands that apply reach it. Ids it was not offered are dropped.
 */
export async function suggestWithModel(
  request: ModelSuggestionRequest,
  settings: ApplicationSettings,
  generate: Generate,
  signal: AbortSignal,
): Promise<ModelSuggestions> {
  if (!settings.browsing.modelSuggestions)
    throw new Error('Turn on model suggestions in Settings → Browsing.');
  const provider = promptProvider(settings);
  if (!provider) throw new Error('Add a model in Settings → Models.');
  const raw = await generate(
    provider,
    modelSuggestionInstructions,
    request,
    suggestionSchema,
    signal,
    'names',
    'user',
  );
  const parsed = modelSuggestionAnswerSchema.safeParse(raw);
  if (!parsed.success) throw new Error('The model returned invalid suggestions.');
  return { provider: provider.name, picks: modelPicks(request, parsed.data) };
}
