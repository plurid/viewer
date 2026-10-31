// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ViewerAPI } from '../src/domain/contracts';
import { CopyButton, PathField, copyFeedbackDuration } from '../src/renderer/ui/primitives';

const path = '/fixtures/Job 1042/drawing (final).pdf';
const copyPaths = vi.fn<ViewerAPI['copyPaths']>(async () => {});
const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
  vi.useFakeTimers();
  window.viewer = { copyPaths } as unknown as ViewerAPI;
  Object.assign(navigator, { clipboard: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** What the copy button's live region says. */
const announced = () => document.querySelector('[aria-live="polite"]')!;

/** Clicks and lets the copy's promise settle. */
async function press(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

it('selects the whole path with one click', () => {
  const view = render(<PathField path={path} />);
  const text = view.container.querySelector<HTMLElement>('.path-text')!;
  expect(text.textContent).toBe(path);
  fireEvent.click(text);
  expect(window.getSelection()!.toString()).toBe(path);
});

it('copies the path as a path, says Copied, then returns', async () => {
  render(<PathField path={path} />);
  const button = screen.getByRole('button', { name: 'Copy path' });
  expect(button.getAttribute('aria-describedby')).toBeTruthy();
  expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(path);
  await press(button);
  expect(copyPaths).toHaveBeenCalledWith([path]);
  expect(writeText).not.toHaveBeenCalled();
  expect(button.title).toBe('Copied');
  expect(announced().textContent).toBe('Copied');
  act(() => {
    vi.advanceTimersByTime(copyFeedbackDuration);
  });
  expect(button.title).toBe('Copy path');
  expect(announced().textContent).toBe('');
});

it('reports a failed copy and says why', async () => {
  copyPaths.mockRejectedValueOnce(new Error('The pasteboard is unavailable.'));
  const onError = vi.fn();
  render(<PathField path={path} onError={onError} />);
  const button = screen.getByRole('button', { name: 'Copy path' });
  await press(button);
  expect(onError).toHaveBeenCalledWith(new Error('The pasteboard is unavailable.'));
  expect(button.title).toBe('Not copied. The pasteboard is unavailable.');
  expect(announced().textContent).toBe('Not copied. The pasteboard is unavailable.');
  act(() => {
    vi.advanceTimersByTime(copyFeedbackDuration);
  });
  expect(button.title).toBe('Copy path');
});

it('copies text through the clipboard, its label saying Copied', async () => {
  render(<CopyButton appearance="text" label="Copy output" copy={{ text: 'exit 0' }} />);
  const button = screen.getByRole('button', { name: 'Copy output' });
  await press(button);
  expect(writeText).toHaveBeenCalledWith('exit 0');
  expect(copyPaths).not.toHaveBeenCalled();
  expect(button.textContent).toBe('Copied');
  // a second copy restarts the moment rather than ending with the first one's timer
  act(() => {
    vi.advanceTimersByTime(copyFeedbackDuration - 100);
  });
  await press(button);
  act(() => {
    vi.advanceTimersByTime(200);
  });
  expect(button.textContent).toBe('Copied');
  act(() => {
    vi.advanceTimersByTime(copyFeedbackDuration);
  });
  expect(button.textContent).toBe('Copy output');
});
