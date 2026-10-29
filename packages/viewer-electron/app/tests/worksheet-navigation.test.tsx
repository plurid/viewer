// @vitest-environment jsdom
/**
 * A page arrives from the reader, not from the person: React commits it, then runs its effects in
 * a later task. A row the person types in that gap must stay theirs.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/react';
import { WorksheetNavigation } from '../src/renderer/previews/WorksheetNavigation';
import type { WorkbookSheet, WorksheetPage } from '../src/domain/previews/documents/office';

const page = (fromRow: number): WorksheetPage => ({
  sheet: 'Data',
  fromRow,
  lastRow: 10000,
  nextRow: fromRow + 100,
  limited: false,
});
const sheet: WorkbookSheet = {
  name: 'Data',
  hidden: false,
  loaded: true,
  rows: [],
  columns: 1,
  truncated: false,
};
let root: Root | undefined;
afterEach(() => {
  root?.unmount();
  document.body.replaceChildren();
});

it('keeps a row typed before the arrived page’s effects run', async () => {
  // as in the app: no test act() around the reader's answer
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const before = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    const host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    const navigate = vi.fn();
    const view = (fromRow: number) => (
      <WorksheetNavigation
        page={page(fromRow)}
        sheet={sheet}
        loading={false}
        previous={1}
        navigate={navigate}
      />
    );
    root.render(view(1));
    await vi.waitFor(() => expect(host.querySelector('input')).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 20));
    // the next page commits; the person types and submits right after, in the same turn
    const typed = new Promise<string>((resolve) => {
      const observer = new MutationObserver(() => {
        const input = host.querySelector<HTMLInputElement>('input')!;
        if (!host.textContent?.includes('No rows from 101')) return;
        observer.disconnect();
        fireEvent.change(input, { target: { value: '0' } });
        fireEvent.submit(input.closest('form')!);
        resolve(input.value);
      });
      observer.observe(host, { subtree: true, attributes: true, childList: true });
    });
    root.render(view(101));
    expect(await typed).toBe('0');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('1,048,576');
    expect(navigate).not.toHaveBeenCalled();
  } finally {
    environment.IS_REACT_ACT_ENVIRONMENT = before;
  }
});
