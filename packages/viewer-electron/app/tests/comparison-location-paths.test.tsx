// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ComparisonControls } from '../src/renderer/ui/comparison/Comparison';
import { PathHome } from '../src/renderer/ui/PathLabel';
import { sendWindowEvent } from '../src/renderer/app/window-events';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import type { WorkspaceController } from '../src/renderer/workspace/context';

afterEach(cleanup);
it('shows an editable home-relative comparison path and sends the absolute location', async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
  };
  const compare = vi.fn(async () => null);
  Object.assign(window, { viewer: { compare } });
  render(
    <WorkspaceContext.Provider value={{} as WorkspaceController}>
      <PathHome.Provider value="/sample/home">
        <ComparisonControls />
      </PathHome.Provider>
    </WorkspaceContext.Provider>,
  );
  act(() => sendWindowEvent('viewer:compare', ['/sample/home/Review samples', '/backup']));
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'left location' });
  expect(input.value).toBe('~/Review samples');
  fireEvent.change(input, { target: { value: '~/Work' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Compare' })));
  expect(compare).toHaveBeenCalledWith(
    expect.objectContaining({ left: '/sample/home/Work', right: '/backup' }),
  );
});
