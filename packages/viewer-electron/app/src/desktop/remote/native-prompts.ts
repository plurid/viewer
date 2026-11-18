import { dialog } from 'electron';
import type { BrowserWindow, MessageBoxOptions } from 'electron';
import { randomUUID } from 'node:crypto';
import { macFiles } from '../native/macos-files';
import type { PromptAnswer, RemotePrompt } from './askpass';

/** Cancel is first and the default: Return or Esc never trusts a key or confirms anything. */
async function question(
  window: BrowserWindow,
  prompt: RemotePrompt,
  options: Pick<MessageBoxOptions, 'type' | 'buttons'>,
): Promise<number | undefined> {
  const result = await dialog.showMessageBox(window, {
    ...options,
    message: prompt.title,
    detail: prompt.text,
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    signal: prompt.signal,
  });
  return prompt.signal.aborted ? undefined : result.response;
}

/** AppKit owns the secure field; no answer is published on renderer IPC or window events. */
export function nativeRemotePrompt(
  windowOf: (owner: number) => BrowserWindow | undefined,
): PromptAnswer {
  return async (prompt) => {
    const window = windowOf(prompt.owner);
    if (!window || window.isDestroyed() || prompt.signal.aborted) {
      return null;
    }
    switch (prompt.kind) {
      case 'host-key': {
        const response = await question(window, prompt, {
          type: 'warning',
          buttons: ['Cancel', 'Trust Host Key'],
        });
        return response === 1 ? 'yes' : null;
      }
      case 'notice': {
        // OpenSSH closes this itself once it is done waiting, as after a security key is touched.
        await question(window, prompt, { type: 'info', buttons: ['Cancel'] });
        return null;
      }
      case 'secret':
        break;
    }
    const native = macFiles();
    if (!native.remotePrompt || !native.cancelRemotePrompt) {
      throw new Error(
        'This build of Viewer can’t ask for a password. Install the latest Viewer, then connect again.',
      );
    }
    const id = randomUUID();
    const cancel = () => native.cancelRemotePrompt!(id);
    prompt.signal.addEventListener('abort', cancel, { once: true });
    try {
      const answer = await native.remotePrompt(
        id,
        window.getNativeWindowHandle(),
        prompt.title,
        prompt.text,
        prompt.placeholder,
      );
      return prompt.signal.aborted || window.isDestroyed() ? null : answer;
    } finally {
      prompt.signal.removeEventListener('abort', cancel);
    }
  };
}
