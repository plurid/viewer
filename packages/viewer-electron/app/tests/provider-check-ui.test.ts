// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ProviderCheckResult } from '../src/domain/models/provider-checks';
import { ProviderCheck } from '../src/renderer/ui/models/ProviderCheck';

afterEach(cleanup);

it('sends no request on mount and sends one fixed-input check per explicit action', async () => {
  let finish!: (value: ProviderCheckResult) => void;
  const check = vi.fn(
    () =>
      new Promise<ProviderCheckResult>((resolve) => {
        finish = resolve;
      }),
  );
  Object.assign(window, { viewer: { providerCheck: check } });
  render(createElement(ProviderCheck, { providerID: 'gemini', onError: vi.fn() }));
  expect(check).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Test structured output' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(check).toHaveBeenCalledExactlyOnceWith({ providerID: 'gemini', kind: 'chat-schema' });
  await act(async () =>
    finish({
      providerID: 'gemini',
      kind: 'chat-schema',
      outcome: 'passed',
      detail: 'Structured output passed.',
    }),
  );
  expect(screen.getByRole('status').textContent).toBe('Structured output passed.');
});

it('does not publish an old model result into its replacement check view', async () => {
  let finish!: (value: ProviderCheckResult) => void;
  const check = vi.fn(
    () =>
      new Promise<ProviderCheckResult>((resolve) => {
        finish = resolve;
      }),
  );
  Object.assign(window, { viewer: { providerCheck: check } });
  const onError = vi.fn();
  const view = render(
    createElement(ProviderCheck, { key: 'first-model', providerID: 'gemini', onError }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Test structured output' }));
  view.rerender(
    createElement(ProviderCheck, { key: 'second-model', providerID: 'gemini', onError }),
  );
  await act(async () =>
    finish({
      providerID: 'gemini',
      kind: 'chat-schema',
      outcome: 'http-error',
      detail: 'Old model response',
    }),
  );
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: 'Test structured output' })).toBeTruthy();
});
