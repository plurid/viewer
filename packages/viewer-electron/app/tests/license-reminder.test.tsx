// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { DesktopEvent } from '../src/domain/contracts';
import type { LicenseRequest, LicenseStatus } from '../src/domain/license/license';
import { LicenseReminder } from '../src/renderer/app/LicenseReminder';
import { initialize } from '../src/renderer/state/store';

afterEach(() => cleanup());

function fixture(initial?: LicenseStatus) {
  let status = initial;
  const listeners = new Set<(event: DesktopEvent) => void>();
  const send = (next: LicenseStatus) => {
    status = next;
    act(() => listeners.forEach((listener) => listener({ type: 'license', status: next })));
  };
  const license = vi.fn(async (request: LicenseRequest) => {
    if (request.kind === 'status' && request.hideReminder)
      send({ kind: 'trial-ended', reminderHidden: true });
    return status;
  });
  const openSettings = vi.fn(async () => {});
  Object.assign(window, {
    viewer: {
      license,
      openSettings,
      onEvent: (listener: (event: DesktopEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    state: null,
    locations: [],
    openPaths: [],
    license: initial,
  });
  return { license, openSettings, listeners, send };
}

it.each([
  undefined,
  { kind: 'trial', daysLeft: 30 } as const,
  { kind: 'trial', daysLeft: 1 } as const,
  { kind: 'licensed', email: `${randomUUID()}@buyer.example.invalid` } as const,
])('stays silent with status %s', async (status) => {
  const f = fixture(status);
  const view = render(<LicenseReminder />);
  await waitFor(() => expect(f.license).toHaveBeenCalledOnce());
  expect(view.container.textContent).toBe('');
  expect(view.queryByRole('dialog')).toBeNull();
  view.unmount();
  expect(f.listeners.size).toBe(0);
});

it('offers purchase and Settings in an ended-trial bar, then hides across remounts until next launch', async () => {
  const f = fixture({ kind: 'trial-ended' });
  const view = render(<LicenseReminder />);
  await waitFor(() =>
    expect(view.getByRole('status').textContent).toContain('All features remain available.'),
  );
  expect(view.queryByRole('dialog')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Buy Viewer' }));
  await waitFor(() => expect(f.license).toHaveBeenCalledWith({ kind: 'buy' }));
  fireEvent.click(view.getByRole('button', { name: 'Enter license…' }));
  expect(f.openSettings).toHaveBeenCalledExactlyOnceWith('license');
  fireEvent.click(view.getByRole('button', { name: 'Hide' }));
  await waitFor(() => expect(view.queryByRole('status')).toBeNull());
  view.unmount();
  const reopened = render(<LicenseReminder />);
  await waitFor(() => expect(f.license).toHaveBeenCalledWith({ kind: 'status' }));
  expect(reopened.queryByRole('status')).toBeNull();
  f.send({ kind: 'trial-ended', reminderHidden: true });
  expect(reopened.queryByRole('status')).toBeNull();
  reopened.unmount();
  fixture({ kind: 'trial-ended' });
  const relaunched = render(<LicenseReminder />);
  expect(relaunched.getByRole('button', { name: 'Buy Viewer' })).toBeTruthy();
});

it('responds to expiry and key entry events without opening a dialog', async () => {
  const f = fixture({ kind: 'trial', daysLeft: 1 });
  const view = render(<LicenseReminder />);
  await waitFor(() => expect(f.license).toHaveBeenCalled());
  f.send({ kind: 'trial-ended' });
  expect(view.getByRole('button', { name: 'Buy Viewer' })).toBeTruthy();
  f.send({ kind: 'licensed', email: `${randomUUID()}@buyer.example.invalid` });
  expect(view.container.textContent).toBe('');
  expect(view.queryByRole('dialog')).toBeNull();
});

it('keeps a newer license event when an older initial status arrives late', async () => {
  const f = fixture({ kind: 'trial-ended' });
  let complete: ((status: LicenseStatus) => void) | undefined;
  f.license.mockImplementationOnce(
    () =>
      new Promise<LicenseStatus>((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(<LicenseReminder />);
  f.send({ kind: 'licensed', email: `${randomUUID()}@buyer.example.invalid` });
  await act(async () => complete!({ kind: 'trial-ended' }));
  expect(view.container.textContent).toBe('');
});
