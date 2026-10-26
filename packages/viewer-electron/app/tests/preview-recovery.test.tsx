// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import { renamedSibling } from '../src/domain/previews/recovery';
import { PreviewRecovery } from '../src/renderer/previews/PreviewRecovery';

afterEach(cleanup);
const source = {
  path: '/fixture/Old.pdf',
  parent: '/fixture',
  name: 'Old.pdf',
  identity: 'device:42',
  kind: 'file',
  directory: false,
} as FileEntry;
it('accepts only one regular sibling with the same identity', () => {
  const renamed = { ...source, path: '/fixture/New.pdf', name: 'New.pdf' };
  expect(renamedSibling(source, [{ ...renamed, identity: 'other' }, renamed])).toBe(renamed);
  expect(
    renamedSibling(source, [renamed, { ...renamed, path: '/fixture/Link.pdf' }]),
  ).toBeUndefined();
  expect(renamedSibling(source, [{ ...renamed, kind: 'symlink' }])).toBeUndefined();
  expect(renamedSibling({ ...source, identity: '' }, [renamed])).toBeUndefined();
});
it('revalidates a renamed sibling before attaching it and leaves recovery available on failure', async () => {
  const found = { ...source, path: '/fixture/New.pdf', name: 'New.pdf' };
  const locate = vi.fn(async () => {}),
    retry = vi.fn();
  Object.assign(window, {
    viewer: {
      list: vi.fn(async () => ({ entries: [found] })),
      stat: vi.fn(async () => ({ ...found, identity: 'replaced' })),
    },
  });
  render(
    <PreviewRecovery
      path={source.path}
      entry={source}
      detail="Unavailable."
      retry={retry}
      locate={locate}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Find renamed file' }));
  await screen.findByText('The found file changed. Check again.');
  expect(locate).not.toHaveBeenCalled();
  window.viewer.stat = vi.fn(async () => found);
  fireEvent.click(screen.getByRole('button', { name: 'Find renamed file' }));
  await waitFor(() => expect(locate).toHaveBeenCalledWith(found));
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toContain('last loaded version');
});
