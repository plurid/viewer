import type { DesktopEvent } from '../../domain/contracts';
import { namedLines } from '../../domain/command-line/prompt';
import {
  emptySessionKeys,
  keepAliases,
  withSessionKeys,
  type SessionKeys,
} from '../../domain/preferences/session-keys';
import type { ApiHandlers } from './schemas';
import type { SettingsService } from '../preferences/settings';
import type { Credentials, Providers } from '../models/providers';
import { answerPrompt, answerSpoken, suggestWithModel } from '../models/prompts';

type CommandLineHandlers = Pick<
  ApiHandlers,
  | 'promptLine'
  | 'promptPlan'
  | 'promptCancel'
  | 'modelSuggestions'
  | 'sessionKeys'
  | 'sessionKeysSet'
  | 'sessionKeysKeep'
  | 'sessionKeysDiscard'
>;
interface CommandLinePorts {
  settings: Pick<SettingsService, 'snapshot' | 'patch'>;
  credentials: Pick<Credentials, 'ids'>;
  providers: Pick<Providers, 'generate'>;
  sessionKeys(): SessionKeys;
  setSessionKeys(keys: SessionKeys): void;
  emit(event: DesktopEvent): void;
}

/** Session keys stay in memory until kept or quit; a prompt request replaces the last of its ID. */
export function createCommandLineHandlers(ports: CommandLinePorts): CommandLineHandlers {
  const prompts = new Map<string, AbortController>();
  /** Runs one request of an ID, cancelled by `promptCancel` or a later request of the same ID. */
  const asking = async <T>(id: string, ask: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    prompts.get(id)?.abort();
    prompts.set(id, controller);
    try {
      return await ask(controller.signal);
    } finally {
      if (prompts.get(id) === controller) prompts.delete(id);
    }
  };
  const replaceKeys = (keys: SessionKeys) => {
    ports.setSessionKeys(keys);
    ports.emit({ type: 'session-keys', session: keys });
    return keys;
  };
  return {
    // `>` in the palette: a request in words answered with a line to review
    promptLine: ([request]) =>
      asking(request.id, (signal) =>
        answerPrompt(
          request,
          ports.settings.snapshot().settings,
          (...generate) => ports.providers.generate(...generate),
          signal,
          namedLines(ports.settings.snapshot().settings.customActions, ports.sessionKeys().aliases),
        ),
      ),
    // a spoken request: a plan of command IDs, which the window checks before any runs
    promptPlan: ([request]) =>
      asking(request.id, (signal) =>
        answerSpoken(
          request,
          ports.settings.snapshot().settings,
          (...generate) => ports.providers.generate(...generate),
          signal,
        ),
      ),
    promptCancel: ([id]) => {
      prompts.get(id)?.abort();
    },
    // suggestions decorate a menu: an answer that takes longer is not waited for
    modelSuggestions: ([request]) =>
      suggestWithModel(
        request,
        ports.settings.snapshot().settings,
        (...generate) => ports.providers.generate(...generate),
        AbortSignal.timeout(30000),
      ),
    sessionKeys: () => ports.sessionKeys(),
    sessionKeysSet: ([keys]) => replaceKeys(keys),
    // Keep, from Settings: the session's bindings written into the keymap, then forgotten
    sessionKeysKeep: async () => {
      const current = ports.settings.snapshot();
      const snapshot = await ports.settings.patch(
        [
          {
            path: 'settings.keymap',
            value: withSessionKeys(current.settings.keymap, ports.sessionKeys()),
          },
          {
            path: 'settings.customActions',
            value: keepAliases(current.settings.customActions, ports.sessionKeys()),
          },
        ],
        current.revision,
      );
      replaceKeys(emptySessionKeys);
      return { ...snapshot, credentials: ports.credentials.ids() };
    },
    sessionKeysDiscard: () => replaceKeys(emptySessionKeys),
  };
}
