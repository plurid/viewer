import { LineError, type Step } from '../../domain/command-line/lex';
import {
  bindStep,
  didYouMean,
  parseCommandLine,
  resolveName,
  verbName,
  verbNames,
} from '../../domain/command-line/verbs';
import { errorMessage } from '../../domain/errors';
import { Stopped, type LineHost } from './host';
import { withArguments } from '../../domain/command-line/lex';
import { sessionKeys } from '../keys/session';
import { getState } from '../state/store';
import { verbRuns } from './verbs';
import { namedLines, promptLineProblem } from '../../domain/command-line/prompt';

export interface PlannedStep {
  step: Step;
  /** What help shows for it: the verb's help, or the command's label. */
  label: string;
  run(host: LineHost): Promise<string | void>;
}
export interface LineResult {
  ok: boolean;
  /** What to show: `:set grid?`'s value, or why it stopped; none when the person cancelled. */
  message?: string;
  /** Where in the line, for an error found before running. */
  at?: number;
}
/**
 * The person's commands (2026-10-23): sequences named in Settings (`command`), and this session's
 * `:alias`es over them. Each name runs its lines.
 */
export function userCommands(): Map<string, string[]> {
  return namedLines(getState().settings.settings.customActions, sessionKeys().aliases);
}
/**
 * A line checked before any of it runs: each step's name known and its words right, so a typo in
 * step three does not leave steps one and two done.
 */
export function planLine(text: string, host: LineHost, depth = 0): PlannedStep[] {
  if (depth > 10) throw new LineError('Commands call each other too deeply.', 0);
  const context = host.context();
  return parseCommandLine(text).map((step): PlannedStep => {
    const name = resolveName(step.name);
    if (name.kind === 'verb') {
      const bound = bindStep(step, name.verb);
      const run = verbRuns[name.verb.key];
      if (!run) throw new LineError(`:${verbName(name.verb)} cannot run here.`, step.at);
      return {
        step,
        label: name.verb.help,
        run: (live) => run({ step, ...bound, bang: step.bang }, live),
      };
    }
    if (name.kind === 'user') {
      const commands = userCommands();
      const lines = commands.get(name.name);
      if (!lines) {
        const meant = didYouMean(name.name, commands.keys());
        throw new LineError(
          `No command :${name.name}${meant ? ` — did you mean :${meant}?` : '.'}`,
          step.at,
        );
      }
      let planned: PlannedStep[];
      try {
        const words = step.words.map((word) => word.text);
        planned = lines.flatMap((line) =>
          planLine(withArguments(line, words, name.name), host, depth + 1),
        );
      } catch (error) {
        // where it went wrong is in the person's command, which runs at this step
        if (error instanceof LineError)
          throw new LineError(`:${name.name}: ${error.message}`, step.at);
        throw error;
      }
      return {
        step,
        label: `:${name.name} — ${lines.join(' | ')}`,
        run: async (live) => {
          const messages: string[] = [];
          for (const inner of planned)
            for (let time = 0; time < (inner.step.count ?? 1); time++) {
              const message = await inner.run(live);
              if (message) messages.push(message);
            }
          return messages.join('  ') || undefined;
        },
      };
    }
    const label = host.registry.label(name.id, context);
    if (label === undefined) {
      const meant = didYouMean(name.id, [...verbNames(), ...host.registry.ids()]);
      throw new LineError(
        `Not a command: ${name.id}${meant ? ` — did you mean ${meant}?` : '.'}`,
        step.at,
      );
    }
    if (step.bang) throw new LineError(`${name.id} does not take !.`, step.at);
    if (step.words[0])
      throw new LineError(`A command takes no words: ${name.id}.`, step.words[0].at);
    return {
      step,
      label,
      run: async (live) => {
        if (!(await live.invoke(name.id, false)))
          throw new Error(`“${label}” is not available here.`);
      },
    };
  });
}
/**
 * RUNS A LINE (2026-10-23): checked whole first, then step by step, each against the live plane
 * (so `cd ~/x | e %` opens what `cd` arrived at), a count running its step again. It stops at the
 * first step that cannot run, saying which.
 */
export async function runLine(text: string, host: LineHost, model = false): Promise<LineResult> {
  let planned: PlannedStep[];
  try {
    if (model) {
      const problem = promptLineProblem(
        text,
        new Set(host.registry.ids()),
        getState().settings.settings.customActions,
        userCommands(),
      );
      if (problem) return { ok: false, message: problem };
    }
    planned = planLine(text, host);
  } catch (error) {
    if (error instanceof LineError) return { ok: false, message: error.message, at: error.at };
    throw error;
  }
  const messages: string[] = [];
  for (const item of planned)
    for (let time = 0; time < (item.step.count ?? 1); time++) {
      try {
        const message = await item.run(host);
        if (message) messages.push(message);
      } catch (error) {
        if (error instanceof Stopped) return { ok: false };
        return { ok: false, message: [...messages, errorMessage(error)].join('  ') };
      }
    }
  return { ok: true, ...(messages.length ? { message: messages.join('  ') } : {}) };
}
