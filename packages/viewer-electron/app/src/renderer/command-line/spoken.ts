import type { CommandContext, CommandRegistry } from '../commands/registry';
import type {
  SpokenCommand,
  SpokenOffer,
  SpokenPlan,
  SpokenSteps,
} from '../../domain/command-line/spoken';
import type { ModelProvider } from '../../domain/services';
import {
  labelPhrase,
  matchSpoken,
  spokenPlan,
  spokenRun,
  spokenRunsAlone,
} from '../../domain/command-line/spoken';
import { modelPermissionCovers } from '../../domain/models/permissions';
import { providerPresets } from '../../domain/models/providers';
import { errorMessage } from '../../domain/errors';
import { getState } from '../state/store';

/**
 * ASK VIEWER BY VOICE, in the window: the transcript is read into a plan (domain/command-line/
 * spoken.ts), whose steps run through the registry, one after another, on the target captured when
 * the person began to speak. Each step resolves once its work is done, so a check is graded before
 * its cut sheets open. A step that changes files waits for the person's press; a plan that names
 * what is not here, or leaves part of the request undone, waits for one too.
 */

/** Who read the words into a plan: Ask Viewer's model, or Viewer's own matching and why. */
export type SpokenReader = { kind: 'model'; name: string } | { kind: 'words'; note?: string };
export type SpokenStage =
  /** The model or the matcher reads the transcript. */
  | 'reading'
  /** A plan that runs on the person's press: it names what is not here, or leaves part undone. */
  | 'offered'
  | 'running'
  /** At a step that changes files, which runs on the person's press. */
  | 'waiting'
  | 'done'
  /** A step failed, or the person stopped the plan. */
  | 'stopped'
  /** No plan: nothing here does it, or a step may not run from speech. */
  | 'nothing';
export type SpokenStepState = 'next' | 'running' | 'done' | 'press' | 'failed';
export interface SpokenStepStatus {
  state: SpokenStepState;
  /** How it goes, what it did, or why it failed. */
  text?: string;
}
export interface SpokenSession {
  id: string;
  transcript: string;
  /** The target captured when the person began to speak: every step runs on it. */
  context: CommandContext;
  stage: SpokenStage;
  reader: SpokenReader;
  plan?: SpokenPlan;
  /** The model's own words when it gave no plan. */
  explanation?: string;
  steps: SpokenStepStatus[];
}

let session: SpokenSession | null = null;
/** The open session's registry and the signal that stops its work. */
let running: { registry: CommandRegistry; controller: AbortController } | null = null;
const listeners = new Set<() => void>();
function change(next: SpokenSession | null): void {
  session = next;
  for (const listener of listeners) listener();
}
/** Changes the session `own` names, unless another has replaced it since. */
function patch(own: SpokenSession, update: Partial<SpokenSession>): void {
  if (session?.id === own.id) change({ ...session, ...update });
}
function patchStep(own: SpokenSession, index: number, status: SpokenStepStatus): void {
  if (session?.id !== own.id) return;
  change({ ...session, steps: session.steps.map((item, at) => (at === index ? status : item)) });
}
export const spokenSession = () => session;
export function subscribeSpoken(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Ask Viewer's model: the one Settings → Models names for it, or the first. */
function askProvider(): ModelProvider | undefined {
  const { providers, prompts } = getState().settings.settings;
  return providers.find((provider) => provider.id === prompts.providerID) ?? providers[0];
}
/** "Muse Spark", or the provider's name. */
const readerName = (provider: ModelProvider) =>
  providerPresets[provider.kind].family ?? provider.name;

/** The commands where the person spoke, as a spoken request may name them, unavailable ones with
 * why: the matcher says so when the words name one. */
export function spokenCommands(registry: CommandRegistry, context: CommandContext) {
  const actions = getState().settings.settings.customActions;
  return registry
    .discover({ scope: 'window', paneID: context.paneID, context })
    .filter((command) => !command.id.includes(':') && !command.id.startsWith('setting.'))
    .map((command): SpokenCommand => {
      const { spoken } = command;
      const policy = spokenRun(command.id, actions);
      const subject = command.available ? spoken?.subject?.(command.context) : undefined;
      return {
        id: command.id,
        label: command.label,
        aliases: command.aliases,
        phrase: spoken?.phrase(command.context) ?? labelPhrase(command.label),
        ...(spoken?.follows ? { follows: spoken.follows } : {}),
        ...(subject ? { subject } : {}),
        ...(spoken?.after ? { after: spoken.after } : {}),
        available: command.available,
        ...(command.unavailable ? { unavailable: command.unavailable } : {}),
        run: policy.run,
        ...(policy.reason ? { refused: policy.reason } : {}),
      };
    });
}
/** What the model is told of the commands: those it may plan, the ones with a subject or an order
 * first, as names only. */
function offers(commands: readonly SpokenCommand[]): SpokenOffer[] {
  return commands
    .filter((command) => command.run !== 'refused' && (command.available || command.after))
    .sort(
      (one, other) =>
        Number(!!(other.subject || other.after)) - Number(!!(one.subject || one.after)),
    )
    .slice(0, 600)
    .map((command) => ({
      id: command.id,
      label: command.label.slice(0, 200),
      ...(command.subject ? { subject: command.subject.slice(0, 255) } : {}),
      ...(command.after ? { after: command.after.slice(0, 8) } : {}),
    }));
}

/**
 * Reads what the person said where they began to speak: with Ask Viewer's model when it may
 * receive file names, otherwise, or when it does not answer, with Viewer's own matching. A plan
 * checked whole runs by itself; any other waits for the person.
 */
export async function askSpoken(
  transcript: string,
  context: CommandContext,
  registry: CommandRegistry,
): Promise<void> {
  closeSpoken();
  const controller = new AbortController();
  running = { registry, controller };
  const provider = askProvider();
  const own: SpokenSession = {
    id: crypto.randomUUID(),
    transcript,
    context,
    stage: 'reading',
    reader: provider ? { kind: 'model', name: readerName(provider) } : { kind: 'words' },
    steps: [],
  };
  change(own);
  const commands = spokenCommands(registry, context);
  let answer: SpokenSteps;
  let reader = own.reader;
  const permission = provider
    ? await window.viewer.providerPermissionGet(provider.id).catch(() => null)
    : null;
  if (controller.signal.aborted) return;
  if (provider && modelPermissionCovers(permission, provider, 'names')) {
    try {
      const folder = context.folder?.path ?? context.directory;
      const reply = await window.viewer.promptPlan({
        id: own.id,
        transcript,
        context: {
          ...(folder ? { folder } : {}),
          selection: context.selection.slice(0, 50).map((entry) => entry.name.slice(0, 255)),
          commands: offers(commands),
        },
      });
      answer = reply;
      reader = { kind: 'model', name: reply.by };
    } catch (error) {
      if (controller.signal.aborted) return;
      answer = matchSpoken(transcript, commands);
      reader = {
        kind: 'words',
        note: `${readerName(provider)} did not answer: ${errorMessage(error)}`,
      };
    }
  } else {
    answer = matchSpoken(transcript, commands);
    reader = {
      kind: 'words',
      ...(provider ? { note: `${provider.name} may not receive file names.` } : {}),
    };
  }
  if (controller.signal.aborted) return;
  let plan = spokenPlan(answer, commands);
  // the model is told only what it may plan here: a command the words name that is not
  // available here says why
  if (!plan.steps.length && !plan.problem && reader.kind === 'model') {
    const unavailable = commands.filter((command) => !command.available && !command.after);
    const matched = spokenPlan(matchSpoken(transcript, unavailable), commands);
    if (matched.problem) plan = matched;
  }
  const steps = plan.steps.map((): SpokenStepStatus => ({ state: 'next' }));
  const explanation = answer.explanation;
  patch(own, {
    reader,
    plan,
    steps,
    ...(explanation && !plan.steps.length ? { explanation } : {}),
    stage: spokenRunsAlone(plan) ? 'running' : plan.steps.length ? 'offered' : 'nothing',
  });
  if (spokenRunsAlone(plan)) await runSteps(own, 0);
}

/** The command a step names, as it resolves on the captured target now. */
function resolved(registry: CommandRegistry, context: CommandContext, id: string) {
  return registry.list({ ids: [id], paneID: context.paneID, scope: 'window', context })[0];
}
/** Runs the plan's steps from `from`, stopping at one that changes files unless it is `pressed`. */
async function runSteps(own: SpokenSession, from: number, pressed?: number): Promise<void> {
  const owner = running;
  const plan = session?.id === own.id ? session.plan : undefined;
  if (!owner || !plan) return;
  const { registry, controller } = owner;
  const { signal } = controller;
  for (let index = from; index < plan.steps.length; index++) {
    const step = plan.steps[index]!;
    if (step.run === 'press' && index !== pressed) {
      patchStep(own, index, { state: 'press' });
      return patch(own, { stage: 'waiting' });
    }
    patch(own, { stage: 'running' });
    patchStep(own, index, { state: 'running' });
    const command = resolved(registry, own.context, step.command);
    const failed = (text: string) => {
      patchStep(own, index, { state: 'failed', text });
      patch(own, { stage: 'stopped' });
    };
    if (!command) {
      const found = registry.discover({
        ids: [step.command],
        paneID: own.context.paneID,
        scope: 'window',
        context: own.context,
      })[0];
      return failed(found?.unavailable ?? 'It is no longer available here.');
    }
    try {
      const outcome = await registry.runSpoken(
        command,
        (text) => {
          if (!signal.aborted) patchStep(own, index, { state: 'running', text });
        },
        signal,
      );
      if (signal.aborted) return;
      if (!outcome) return failed('The view changed since you spoke, so it did not run.');
      patchStep(own, index, { state: 'done', ...(outcome.done ? { text: outcome.done } : {}) });
    } catch (error) {
      if (signal.aborted) return;
      return failed(errorMessage(error));
    }
  }
  patch(own, { stage: 'done' });
}
/** The person's press on a step that changes files: it runs, then the plan goes on. */
export async function pressSpoken(index: number): Promise<void> {
  const own = session;
  if (own?.stage !== 'waiting' || own.steps[index]?.state !== 'press') return;
  await runSteps(own, index, index);
}
/** The person's press on a plan offered rather than run: the one here, for a target not here. */
export async function runOffered(): Promise<void> {
  const own = session;
  if (own?.stage !== 'offered') return;
  await runSteps(own, 0);
}
/** Stops the plan: what runs goes on in its own panel, and no further step starts. */
export function stopSpoken(): void {
  const own = session;
  running?.controller.abort();
  if (own?.stage === 'reading') void window.viewer.promptCancel(own.id).catch(() => {});
  if (!own || !['reading', 'running', 'waiting'].includes(own.stage)) return;
  change({
    ...own,
    stage: 'stopped',
    steps: own.steps.map((step) =>
      step.state === 'running' || step.state === 'press' ? { state: 'next' } : step,
    ),
  });
}
export function closeSpoken(): void {
  stopSpoken();
  running = null;
  change(null);
}
