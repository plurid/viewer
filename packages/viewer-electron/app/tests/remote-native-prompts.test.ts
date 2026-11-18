import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { RemotePrompt } from '../src/desktop/remote/askpass';

const showMessageBox = vi.fn();
const remotePrompt = vi.fn();
const cancelRemotePrompt = vi.fn();

vi.mock('electron', () => ({ dialog: { showMessageBox } }));
vi.mock('../src/desktop/native/macos-files', () => ({
  macFiles: () => ({ remotePrompt, cancelRemotePrompt }),
}));

const { nativeRemotePrompt } = await import('../src/desktop/remote/native-prompts');

const window = {
  isDestroyed: () => false,
  getNativeWindowHandle: () => Buffer.alloc(8),
} as unknown as BrowserWindow;

function prompt(patch: Partial<RemotePrompt>): RemotePrompt {
  return {
    connectionID: 'server01',
    owner: 1,
    kind: 'secret',
    title: 'Passphrase for key “id_ed25519”',
    text: 'Enter it to connect to “Build box”.',
    placeholder: 'Passphrase',
    signal: new AbortController().signal,
    ...patch,
  };
}

beforeEach(() => {
  showMessageBox.mockReset();
  remotePrompt.mockReset();
  cancelRemotePrompt.mockReset();
});

describe('native server prompts', () => {
  it('makes Cancel the default, so Return never trusts a host key', async () => {
    showMessageBox.mockResolvedValue({ response: 0 });
    const ask = nativeRemotePrompt(() => window);
    expect(await ask(prompt({ kind: 'host-key', title: 'First connection to “Build box”' }))).toBe(
      null,
    );
    const options = showMessageBox.mock.calls[0]![1];
    expect(options.buttons[options.defaultId]).toBe('Cancel');
    expect(options.cancelId).toBe(options.defaultId);
    showMessageBox.mockResolvedValue({ response: 1 });
    expect(await ask(prompt({ kind: 'host-key' }))).toBe('yes');
  });

  it('shows a notice until OpenSSH ends it, and never answers one', async () => {
    const controller = new AbortController();
    showMessageBox.mockImplementation(
      async () =>
        new Promise((resolve) =>
          controller.signal.addEventListener('abort', () => resolve({ response: 0 })),
        ),
    );
    const ask = nativeRemotePrompt(() => window);
    const shown = ask(prompt({ kind: 'notice', signal: controller.signal }));
    controller.abort();
    expect(await shown).toBeNull();
    expect(showMessageBox.mock.calls[0]![1]).toMatchObject({ buttons: ['Cancel'] });
  });

  it('asks for secrets in the native secure sheet with what was asked as its placeholder', async () => {
    remotePrompt.mockResolvedValue('typed passphrase');
    const ask = nativeRemotePrompt(() => window);
    expect(await ask(prompt({}))).toBe('typed passphrase');
    expect(remotePrompt).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer),
      'Passphrase for key “id_ed25519”',
      'Enter it to connect to “Build box”.',
      'Passphrase',
    );
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('asks nothing for a window that is gone', async () => {
    const ask = nativeRemotePrompt(() => undefined);
    expect(await ask(prompt({}))).toBeNull();
    expect(remotePrompt).not.toHaveBeenCalled();
  });
});
