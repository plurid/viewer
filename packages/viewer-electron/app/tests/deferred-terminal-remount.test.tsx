// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialize, activeWorkspace } from '../src/renderer/state/store';

vi.mock('@plurid/plurid-react', () => ({
  PluridApplication: () => null,
  usePluridApi: () => ({ store: { subscribe: () => () => {} }, getSnapshot: () => ({}) }),
  usePluridPlane: () => ({ parameters: { id: 'term-1' } }),
}));

vi.mock('../src/renderer/terminals/TerminalPlane', () => ({
  TerminalPlane: () => <div data-testid="running-terminal">Terminal mounted</div>,
}));

import { TerminalContent } from '../src/renderer/workspace/WorkspaceSurface';

function initStore() {
  initialize({ home: '/work', platform: 'darwin', state: null, locations: [], openPaths: [] });
  Object.assign(activeWorkspace(), {
    name: 'Project',
    roots: ['term-1'],
    activePane: 'term-1',
    arrangement: {},
    panes: [
      {
        id: 'term-1',
        type: 'terminal',
        path: '/work/project',
        profileID: 'default',
        startOnOpen: false,
      },
    ],
  });
}

beforeEach(initStore);
afterEach(cleanup);

describe('deferred terminal start authority', () => {
  it('after clicking Start Terminal, unmounting and remounting (culling/workspace switch) stays started', async () => {
    const view = render(<TerminalContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Terminal' }));
    expect(await screen.findByTestId('running-terminal')).toBeTruthy();

    // Simulate Plurid culling unmount or workspace switch remount
    view.unmount();
    render(<TerminalContent />);
    expect(screen.queryByRole('button', { name: 'Start Terminal' })).toBeNull();
    cleanup();
    const epoch = activeWorkspace().epoch ?? 0;
    initStore();
    activeWorkspace().epoch = epoch + 1;
    render(<TerminalContent />);
    expect(screen.getByRole('button', { name: 'Start Terminal' })).toBeTruthy();
  });
});
