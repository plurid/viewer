// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ResolvedCommand } from '../src/renderer/commands/registry';
import { CommandResults } from '../src/renderer/commands/CommandResults';

HTMLElement.prototype.scrollIntoView ??= function () {};
afterEach(cleanup);

function row(id: string, label: string): ResolvedCommand {
  return {
    id,
    label,
    group: 'Actions',
    aliases: [],
    primary: false,
    source: 'window',
    context: { scope: 'window', workspaceID: 'fixture', selection: [], clipboard: null, jobs: [] },
  };
}
const first = row('document-command', 'Documents command');
const later = row('smart:folder:documents', 'Documents folder');
const options = () => screen.getAllByRole('option');

describe.each(['Search commands', 'Command line', 'Ask in words'])('%s results', (label) => {
  it('appends late rows below the visible default and Return runs the top row', () => {
    const choose = vi.fn();
    const props = { query: '~/Doc', label, onQuery: vi.fn(), onSelect: choose, onClose: vi.fn() };
    const view = render(<CommandResults {...props} rows={[first]} />);
    view.rerender(<CommandResults {...props} rows={[later, first]} />);
    expect(options().map((option) => option.textContent)).toEqual([first.label, later.label]);
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    expect(options()[1]?.getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter' });
    expect(choose).toHaveBeenCalledWith(first);
  });

  it('follows the new top row by default when the query changes', () => {
    const choose = vi.fn();
    const props = { label, onQuery: vi.fn(), onSelect: choose, onClose: vi.fn() };
    const view = render(<CommandResults {...props} query="doc" rows={[first, later]} />);
    view.rerender(<CommandResults {...props} query="folder" rows={[later, first]} />);
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter' });
    expect(choose).toHaveBeenCalledWith(later);
  });
});

it('retains an arrowed row while using fresh metadata and dropping withdrawn rows', () => {
  const choose = vi.fn();
  const props = { query: 'doc', onQuery: vi.fn(), onSelect: choose, onClose: vi.fn() };
  const view = render(<CommandResults {...props} rows={[first, later]} />);
  const field = screen.getByRole('combobox');
  fireEvent.keyDown(field, { key: 'ArrowDown' });
  const updated = { ...later, label: 'Updated folder' };
  const newest = row('new', 'Newest result');
  view.rerender(<CommandResults {...props} rows={[newest, updated, first]} />);
  expect(options().map((option) => option.textContent)).toEqual([
    first.label,
    updated.label,
    newest.label,
  ]);
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(choose.mock.lastCall?.[0]).toBe(updated);
  view.rerender(<CommandResults {...props} rows={[newest]} />);
  expect(options()).toHaveLength(1);
  expect(options()[0]?.textContent).toBe(newest.label);
  expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
});
