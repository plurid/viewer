import {
  promptInput,
  promptInstructions,
  promptLineProblem,
  promptSchema,
  type PromptAnswer,
  type PromptRequest,
} from '../domain/command-line/prompt';
import type { ModelDataLevel } from '../domain/model-permissions';
import type { ApplicationSettings, ModelProvider } from '../domain/services';

type Generate = (
  provider: ModelProvider,
  instructions: string,
  input: unknown,
  schema: Record<string, unknown>,
  signal: AbortSignal,
  level: ModelDataLevel,
  actor: 'user' | 'agent',
) => Promise<unknown>;
/** The model prompts ask: the one Settings → Models names for them, or the first. */
export function promptProvider(settings: ApplicationSettings): ModelProvider | undefined {
  return (
    settings.providers.find((provider) => provider.id === settings.prompts.providerID) ??
    settings.providers[0]
  );
}
/**
 * A prompt answered (2026-10-24): the model, at the "names" level its permission allows, gives a
 * line and a sentence; the line is checked as the command line would and as a model's must be.
 */
export async function answerPrompt(
  request: PromptRequest,
  settings: ApplicationSettings,
  generate: Generate,
  signal: AbortSignal,
): Promise<PromptAnswer> {
  const provider = promptProvider(settings);
  if (!provider) throw new Error('Add a model in Settings → Models to ask in words.');
  const answer = (await generate(
    provider,
    promptInstructions(request.context),
    promptInput(request),
    promptSchema as unknown as Record<string, unknown>,
    signal,
    'names',
    'user',
  )) as { line?: unknown; explanation?: unknown } | undefined;
  const line = typeof answer?.line === 'string' ? answer.line.trim().replace(/^:/, '') : '';
  const explanation =
    typeof answer?.explanation === 'string' ? answer.explanation.trim().slice(0, 300) : '';
  const problem = line
    ? promptLineProblem(
        line,
        new Set(request.context.commands.map((command) => command.id)),
        settings.customActions,
        new Set(request.context.userCommands),
      )
    : undefined;
  return { line, explanation, ...(problem ? { problem } : {}) };
}
