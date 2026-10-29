// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { DesktopEvent } from '../src/domain/contracts';
import { QuitHint } from '../src/renderer/app/QuitHint';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('shows the first ⌘Q’s reminder in a status region for the moment a second press quits', () => {
  vi.useFakeTimers();
  const listeners = new Set<(event: DesktopEvent) => void>();
  Object.assign(window, {
    viewer: {
      onEvent: (listener: (event: DesktopEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  const send = (event: DesktopEvent) => act(() => listeners.forEach((listener) => listener(event)));
  const view = render(<QuitHint />);
  const status = screen.getByRole('status');
  expect(status.textContent).toBe('');
  send({ type: 'settings-focus', path: 'settings.quit.warnShortcut' });
  expect(status.textContent).toBe('');
  send({ type: 'quit-hint', duration: 2500 });
  expect(status.textContent).toBe('Press ⌘Q again to quit');
  act(() => vi.advanceTimersByTime(2499));
  expect(status.textContent).toBe('Press ⌘Q again to quit');
  act(() => vi.advanceTimersByTime(1));
  expect(status.textContent).toBe('');
  view.unmount();
  expect(listeners.size).toBe(0);
});
