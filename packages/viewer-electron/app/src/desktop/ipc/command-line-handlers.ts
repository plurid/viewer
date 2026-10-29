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
import { answerPrompt, suggestWithModel } from '../models/prompts';

type CommandLineHandlers = Pick<
  ApiHandlers,
  | 'promptLine'
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
  const replaceKeys = (keys: SessionKeys) => {
    ports.setSessionKeys(keys);
    ports.emit({ type: 'session-keys', session: keys });
    return keys;
  };
  return {
    // `>` in the palette: a request in words answered with a line to review
    promptLine: async ([request]) => {
      const controller = new AbortController();
      prompts.get(request.id)?.abort();
      prompts.set(request.id, controller);
      try {
        return await answerPrompt(
          request,
          ports.settings.snapshot().settings,
          (...generate) => ports.providers.generate(...generate),
          controller.signal,
          namedLines(ports.settings.snapshot().settings.customActions, ports.sessionKeys().aliases),
        );
      } finally {
        if (prompts.get(request.id) === controller) prompts.delete(request.id);
      }
    },
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
