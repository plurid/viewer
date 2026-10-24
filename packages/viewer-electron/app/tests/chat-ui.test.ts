// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { ChatDocument } from '../src/domain/models/chat';
import type { ModelProvider } from '../src/domain/services';
import ChatPlane from '../src/renderer/chat/ChatPlane';
import { initialize } from '../src/renderer/state/store';
import { getState, replaceState } from '../src/renderer/state/core';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';

const providers: ModelProvider[] = ['Alpha', 'Beta'].map((name) => ({
  id: name.toLowerCase(),
  name,
  kind: 'openai',
  endpoint: `https://${name.toLowerCase()}.invalid/v1`,
  model: `${name.toLowerCase()}-model`,
  allowContent: true,
}));
const conversation = (): ChatDocument => ({
  version: 2,
  id: '0f2e5b02-126f-4ff0-b51e-e8ad571cdab9',
  title: 'Example',
  path: '/fixtures',
  providerID: 'alpha',
  scopes: [],
  messages: [
    {
      id: '0169eea7-de1e-4bb3-85db-9295def180fc',
      role: 'assistant',
      text: 'Answer produced by Alpha',
      at: 1,
      provider: { id: 'alpha', name: 'Alpha', model: 'alpha-model' },
    },
  ],
  draft: '',
  draftRevision: 0,
  revision: 1,
  updated: 1,
  status: 'idle',
  level: 'names',
});
let document: ChatDocument;
const chat = vi.fn(async () => document);
beforeEach(() => {
  document = conversation();
  chat.mockClear();
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      chat,
      onEvent: () => () => {},
      providerPermissionGet: async () => null,
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const state = getState();
  replaceState({
    ...state,
    settings: { ...state.settings, settings: { ...state.settings.settings, providers } },
  });
});
afterEach(cleanup);

function mount() {
  return render(
    createElement(
      WorkspaceContext.Provider,
      { value: {} as WorkspaceController },
      createElement(ChatPlane, {
        pane: { id: 'chat', type: 'chat', path: '/fixtures', conversationID: document.id },
      }),
    ),
  );
}

describe('conversation identity', () => {
  it('keeps the generating model attribution when the next model is selected', async () => {
    const view = mount();
    await screen.findByText('Answer produced by Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Chat model' }));
    fireEvent.click(screen.getByText('Beta'));
    await waitFor(() =>
      expect(view.container.querySelector('.chat-message > strong')?.textContent).toBe('Alpha'),
    );
    expect(view.container.querySelector('.chat-message')?.getAttribute('data-model')).toBe(
      'alpha-model',
    );
  });

  it('uses neutral attribution for historical messages with no known model', async () => {
    delete document.messages[0]!.provider;
    const view = mount();
    await screen.findByText('Answer produced by Alpha');
    expect(view.container.querySelector('.chat-message > strong')?.textContent).toBe('Assistant');
  });
});
