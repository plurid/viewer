// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import type { ChatDocument, ChatRequest } from '../src/domain/models/chat';
import type { ModelDataPermission } from '../src/domain/models/permissions';
import type { ModelProvider } from '../src/domain/services';
import ChatPlane from '../src/renderer/chat/ChatPlane';
import { Composer } from '../src/renderer/chat/Composer';
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
  version: 3,
  id: crypto.randomUUID(),
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
const chat = vi.fn(async (_request: ChatRequest) => document);
const providerPermissionGet = vi.fn<() => Promise<ModelDataPermission | null>>();
beforeEach(() => {
  document = conversation();
  chat.mockReset();
  chat.mockImplementation(async (request) => {
    if (request.kind === 'draft') {
      document = { ...document, draft: request.text, draftRevision: request.revision };
    }
    return document;
  });
  providerPermissionGet.mockReset();
  providerPermissionGet.mockResolvedValue(null);
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      chat,
      onEvent: () => () => {},
      providerPermissionGet,
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

describe('Chat controls and state', () => {
  it('keeps the draft editable while checking permission and preserves the consent wording', async () => {
    let permissionLoaded!: (permission: ModelDataPermission | null) => void;
    providerPermissionGet.mockReturnValue(
      new Promise((resolve) => {
        permissionLoaded = resolve;
      }),
    );
    document.messages = [];
    document.draft = 'A saved question';
    const view = mount();
    const field = await screen.findByRole('textbox', { name: 'Chat message' });
    expect((field as HTMLTextAreaElement).value).toBe('A saved question');
    expect((field as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByText('Checking data permission…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow names' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(field, { target: { value: 'A saved question, with more detail' } });
    await act(async () => permissionLoaded(null));
    expect(
      screen.getByText(/needs permission to receive file names and your request/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow names' })).toBeTruthy();
    expect((field as HTMLTextAreaElement).value).toBe('A saved question, with more detail');
    expect(
      view.container.querySelector('.chat-footer')?.hasAttribute('data-viewer-overlay-protected'),
    ).toBe(true);
    expect(
      view.container.querySelector('.chat-toolbar')?.hasAttribute('data-viewer-overlay-protected'),
    ).toBe(true);
    expect(chat.mock.calls.some(([request]) => request.kind === 'send')).toBe(false);
  });

  it('retains a failed request draft through a real plane remount', async () => {
    providerPermissionGet.mockResolvedValue({
      providerID: 'alpha',
      kind: 'openai',
      endpoint: providers[0]!.endpoint,
      level: 'names',
    });
    const persist = chat.getMockImplementation()!;
    chat.mockImplementation(async (request) => {
      if (request.kind === 'send') throw new Error('The model rejected this request.');
      return persist(request);
    });
    const view = mount();
    const field = await screen.findByRole('textbox', { name: 'Chat message' });
    fireEvent.change(field, { target: { value: 'Keep my question after a failure' } });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The model rejected this request.',
    );
    expect((field as HTMLTextAreaElement).value).toBe('Keep my question after a failure');
    view.unmount();
    mount();
    const restored = await screen.findByRole('textbox', { name: 'Chat message' });
    expect((restored as HTMLTextAreaElement).value).toBe('Keep my question after a failure');
    expect(chat.mock.calls.filter(([request]) => request.kind === 'send')).toHaveLength(1);
  });

  it('explains how to start when no model is configured without losing the draft', async () => {
    const state = getState();
    replaceState({
      ...state,
      settings: { ...state.settings, settings: { ...state.settings.settings, providers: [] } },
    });
    document.messages = [];
    document.draft = 'Start here later';
    mount();
    const field = await screen.findByRole('textbox', { name: 'Chat message' });
    expect(screen.getByRole('button', { name: 'Add a model in Settings' })).toBeTruthy();
    expect(screen.getByText('Add a model in Settings to send a message.')).toBeTruthy();
    expect((field as HTMLTextAreaElement).value).toBe('Start here later');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Ask about your files')).toBeTruthy();
  });

  it('does not submit an IME composition and keeps ordinary Enter as a newline', () => {
    const onSend = vi.fn();
    const onChange = vi.fn();
    render(
      createElement(Composer, {
        draft: 'A question',
        busy: false,
        running: false,
        allowed: true,
        onChange,
        onSend,
        onStop: vi.fn(),
      }),
    );
    const field = screen.getByRole('textbox', { name: 'Chat message' });
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-keyshortcuts')).toBe(
      'Meta+Enter Control+Enter',
    );
  });

  it('shows the running state while keeping the next draft available and unsent', async () => {
    providerPermissionGet.mockResolvedValue({
      providerID: 'alpha',
      kind: 'openai',
      endpoint: providers[0]!.endpoint,
      level: 'names',
    });
    document.status = 'running';
    document.messages = [];
    document.draft = 'My next question';
    mount();
    const field = await screen.findByRole('textbox', { name: 'Chat message' });
    expect((field as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.getByText('Reply in progress…').getAttribute('role')).toBe('status');
    expect(screen.queryByText('Ask about your files')).toBeNull();
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    expect(chat.mock.calls.some(([request]) => request.kind === 'send')).toBe(false);
    expect((field as HTMLTextAreaElement).value).toBe('My next question');
  });

  it('keeps complete context paths available without adding every item to overlay protection', async () => {
    const path = '/fixtures/a-very-long-folder-name/another-folder/notes.txt';
    document.scopes = [
      { path, directory: false },
      { path: '/fixtures/Images', directory: true },
    ];
    const view = mount();
    await screen.findByRole('textbox', { name: 'Chat message' });
    const context = screen.getByRole('group', { name: 'Attached context' });
    expect(context.querySelectorAll('li')).toHaveLength(2);
    expect(context.querySelector('li')?.title).toBe(path);
    expect(context.querySelector('li > span')?.textContent).toBe(path);
    expect(context.querySelector('[data-viewer-overlay-protected]')).toBeNull();
    expect(view.container.querySelectorAll('[data-viewer-overlay-protected]')).toHaveLength(2);
  });

  it('uses the interface font for the actual composer field', () => {
    const style = window.document.createElement('style');
    style.textContent = readFileSync('src/renderer/chat/chat.css', 'utf8');
    window.document.head.append(style);
    try {
      const view = render(
        createElement(Composer, {
          draft: '',
          busy: false,
          running: false,
          allowed: false,
          onChange: vi.fn(),
          onSend: vi.fn(),
          onStop: vi.fn(),
        }),
      );
      view.container.style.fontFamily = 'Arial';
      const field = screen.getByRole('textbox', { name: 'Chat message' });
      expect(getComputedStyle(field).fontFamily).toBe('Arial');
    } finally {
      style.remove();
    }
  });
});
