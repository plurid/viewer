// @vitest-environment jsdom
/**
 * Parts of one window talk through typed DOM events; raw `CustomEvent`s with the same names
 * still reach them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { onWindowEvent, sendWindowEvent, useWindowEvent } from '../src/renderer/app/window-events';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('window events', () => {
  it('sends a detail as a CustomEvent with the same name', () => {
    const heard = vi.fn();
    window.addEventListener('viewer:notes', heard);
    try {
      sendWindowEvent('viewer:notes', 'preview');
    } finally {
      window.removeEventListener('viewer:notes', heard);
    }
    expect(heard).toHaveBeenCalledOnce();
    const event = heard.mock.calls[0]![0] as CustomEvent<string>;
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.detail).toBe('preview');
  });

  it('hands listeners the detail, and stops after unsubscribing', () => {
    const listener = vi.fn();
    const stop = onWindowEvent('viewer:compare', listener);
    sendWindowEvent('viewer:compare', ['/left', '/right']);
    window.dispatchEvent(new CustomEvent('viewer:compare', { detail: ['/raw'] }));
    stop();
    sendWindowEvent('viewer:compare', ['/after']);
    expect(listener.mock.calls).toEqual([[['/left', '/right']], [['/raw']]]);
  });

  it('reads a missing detail as undefined', () => {
    const listener = vi.fn();
    const stop = onWindowEvent('viewer:tasks', listener);
    sendWindowEvent('viewer:tasks');
    window.dispatchEvent(new Event('viewer:tasks'));
    window.dispatchEvent(new CustomEvent('viewer:tasks'));
    sendWindowEvent('viewer:tasks', 'plan');
    stop();
    expect(listener.mock.calls).toEqual([[undefined], [undefined], [undefined], ['plan']]);
  });

  it('calls the latest listener a component rendered, until it unmounts', () => {
    const first = vi.fn(),
      second = vi.fn();
    const subscribe = vi.spyOn(window, 'addEventListener');
    const { rerender, unmount } = renderHook(
      ({ listener }) => useWindowEvent('viewer:inspect', listener),
      { initialProps: { listener: first } },
    );
    act(() => sendWindowEvent('viewer:inspect', '/a.txt'));
    rerender({ listener: second });
    act(() => sendWindowEvent('viewer:inspect', '/b.txt'));
    // a new listener does not subscribe again
    const subscribed: string[] = subscribe.mock.calls.map(([name]) => name);
    expect(subscribed.filter((name) => name === 'viewer:inspect')).toHaveLength(1);
    unmount();
    act(() => sendWindowEvent('viewer:inspect', '/c.txt'));
    expect(first.mock.calls).toEqual([['/a.txt']]);
    expect(second.mock.calls).toEqual([['/b.txt']]);
  });
});
