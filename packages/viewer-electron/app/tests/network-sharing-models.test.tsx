// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { PromptRequest } from '../src/domain/command-line/prompt';
import type { LineHost } from '../src/renderer/command-line/host';
import type { CommandContext } from '../src/renderer/commands/registry';
import { newModelProvider } from '../src/domain/models/providers';
import { defaultSettings } from '../src/domain/services';
import { Chats } from '../src/desktop/chat/service';
import { PromptFinder } from '../src/renderer/command-line/PromptFinder';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { getState, initialize, receiveSettings } from '../src/renderer/state/store';
import { temporaryRoot } from '../tools/temporary';

const labels = ['Share on the Network…', 'Network Sharing…'];
const provider = { ...newModelProvider('openai', 'fixture'), model: 'fixture' };

it('sends one constant sharing label in actual prompt requests for either human label', async () => {
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const settings = structuredClone(getState().settings);
  settings.revision++;
  settings.settings.providers = [provider];
  act(() => receiveSettings(settings));
  const promptLine = vi.fn(async (_request: PromptRequest) => ({ explanation: 'Ready.' }));
  Object.assign(window, {
    viewer: {
      onEvent: () => () => {},
      save: vi.fn(async () => {}),
      promptLine,
      promptCancel: vi.fn(async () => {}),
      providerPermissionGet: async () => ({
        providerID: provider.id,
        kind: provider.kind,
        endpoint: provider.endpoint,
        level: 'names',
      }),
    },
  });
  for (const label of labels) {
    const registry = new CommandRegistry();
    const context = {
      scope: 'window',
      workspaceID: 'fixture',
      selection: [],
      clipboard: null,
      jobs: [],
    } as CommandContext;
    registry.register('window', {
      context: () => context,
      definitions: () => [
        { id: 'network-sharing', label, group: 'Files', when: () => true, run: () => {} },
      ],
    });
    render(
      <PromptFinder
        host={{ registry, context: () => context } as LineHost}
        initialQuery="Help"
        onRun={() => {}}
        onEdit={() => {}}
        onBack={() => {}}
        onChat={() => {}}
      />,
    );
    fireEvent.click(await screen.findByRole('option', { name: /Ask: Help/ }));
    await waitFor(() => expect(promptLine).toHaveBeenCalled());
    expect(promptLine.mock.calls.at(-1)?.[0].context.commands).toEqual([
      { id: 'network-sharing', label: 'Network sharing' },
    ]);
    cleanup();
    promptLine.mockClear();
  }
});

it('sends one constant sharing label in actual chat model requests', async () => {
  const root = await temporaryRoot('viewer-sharing-models-');
  const folder = path.join(root, 'Context');
  const data = path.join(root, 'Private');
  await mkdir(folder);
  await mkdir(data);
  const generate = vi.fn<ConstructorParameters<typeof Chats>[1]['generate']>(async () => ({
    kind: 'reply' as const,
    text: 'Ready.',
    path: null,
    query: null,
    commandID: null,
    patches: [],
    renames: [],
    files: [],
  }));
  const chats = new Chats(data, {
    settings: () => ({ ...defaultSettings(root), providers: [provider] }),
    access: async () => {},
    generate,
    inspect: vi.fn(),
    permit: async (_provider, signal, work) => work(signal),
    command: vi.fn(),
    configuration: vi.fn(),
    rename: vi.fn(),
    valid: () => true,
    changed: () => {},
    aliases: () => new Map(),
  });
  try {
    for (const label of labels) {
      const origin = {
        target: {
          directory: folder,
          workspaceID: 'fixture',
          paneID: 'fixture',
          rootID: 'fixture',
          selection: [],
        },
        commands: [{ id: 'network-sharing', label, group: 'Files', aliases: [] }],
      };
      const document = await chats.request({ kind: 'create', paths: [folder] }, 1, origin);
      if (Array.isArray(document)) throw new Error('Expected a conversation.');
      await chats.request(
        { kind: 'send', id: document.id, text: 'Help', providerID: provider.id },
        1,
      );
      await vi.waitFor(async () => {
        const value = await chats.request({ kind: 'open', id: document.id }, 1, origin);
        expect(!Array.isArray(value) && value.status).toBe('idle');
      });
      expect(generate.mock.calls.at(-1)?.[2]).toMatchObject({
        commands: [{ id: 'network-sharing', label: 'Network sharing' }],
      });
    }
  } finally {
    await chats.close();
  }
});
