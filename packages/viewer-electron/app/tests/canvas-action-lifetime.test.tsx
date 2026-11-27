// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasPane, DesktopEvent } from '../src/domain/contracts';
import type { CanvasDocument } from '../src/domain/canvases/document';
import type { CanvasAction } from '../src/domain/canvases/actions';
import { CanvasActions } from '../src/desktop/canvases/actions';
import CanvasPlane from '../src/renderer/canvases/CanvasPlane';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';

const actionDef: CanvasAction = {
  id: 'solve',
  label: 'Solve',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const doc: CanvasDocument = {
  version: 2,
  id: '00000000-0000-4000-8000-000000000010',
  conversationID: '00000000-0000-4000-8000-000000000011',
  path: '/tmp',
  title: 'Solver Tool',
  html: '<p>Solver</p>',
  revision: 1,
  state: {},
  defaults: {},
  stateRevision: 0,
  assets: [],
  sources: [],
  history: [],
  at: 1,
};

const pane: CanvasPane = {
  id: 'pane-canvas-1',
  type: 'canvas',
  path: '/tmp',
  canvasID: doc.id,
  title: doc.title,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mountCanvas() {
  const frameID = '00000000-0000-4000-8000-000000000099';
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(frameID);
  const listeners = new Set<(event: DesktopEvent) => void>();
  const actions = new CanvasActions((_owner, event) => {
    for (const listener of listeners) listener({ type: 'canvas-action', event });
  });
  Object.assign(window, {
    viewer: {
      onEvent: (listener: (event: DesktopEvent) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      canvas: vi.fn(async (request: { kind: string; id: string; frameID?: string }) => {
        if (request.kind === 'read') return { document: doc };
        if (request.kind === 'preview')
          return { document: doc, preview: { id: 'cap-1', url: 'about:blank' } };
        if (request.kind === 'detach-actions' && request.frameID)
          actions.detach(1, request.id, request.frameID);
        if (request.kind === 'cancel-action') actions.cancel(request.id);
        return { document: doc };
      }),
      htmlPreviewClose: vi.fn(async () => {}),
      chat: vi.fn(async () => {}),
    },
  });
  const view = render(
    <WorkspaceContext.Provider value={{} as WorkspaceController}>
      <CanvasPlane pane={pane} />
    </WorkspaceContext.Provider>,
  );
  return { view, actions, frameID };
}

describe('canvas action lifetime', () => {
  it('clears inert state and Running status when Stop is clicked during a running action', async () => {
    const { view, actions, frameID } = mountCanvas();
    await vi.waitFor(() => expect(view.container.querySelector('iframe')).not.toBeNull());
    actions.register(1, doc, frameID, [actionDef]);
    await act(async () => {
      actions.start(1, doc, 'solve', {}, 'You', new AbortController().signal, 'user');
    });
    expect(view.container.querySelector('iframe')?.closest('[inert]')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    });
    expect(actions.busy(doc.id)).toBe(false);
    expect(screen.getByRole('button', { name: 'Reload' }).closest('[inert]')).toBeNull();
    expect(screen.queryByText('Running…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await vi.waitFor(() => expect(view.container.querySelector('iframe')).toBeTruthy());
    expect(view.container.querySelector('iframe')?.closest('[inert]')).toBeNull();
  });
});
