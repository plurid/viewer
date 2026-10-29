import {
  promptInput,
  promptInstructions,
  promptLineProblem,
  promptAnswerSchema,
  promptSchema,
  type PromptAnswer,
  type PromptRequest,
} from '../../domain/command-line/prompt';
import type { ModelDataLevel } from '../../domain/models/permissions';
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
function promptProvider(settings: ApplicationSettings): ModelProvider | undefined {
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
