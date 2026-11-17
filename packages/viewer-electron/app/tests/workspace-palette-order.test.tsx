// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ResolvedCommand } from '../src/renderer/commands/registry';
import { CommandResults } from '../src/renderer/commands/CommandResults';

afterEach(cleanup);
const context = {
  workspaceID: 'open',
  paneID: 'none',
  rootID: 'none',
  scope: 'window' as const,
  jobs: [],
  selection: [],
  clipboard: null,
};
const row = (id: string): ResolvedCommand => ({
  id,
  label: id,
  group: 'Workspaces',
  aliases: [],
  source: 'window',
  primary: false,
  context,
});
const props = { onQuery: vi.fn(), onClose: vi.fn(), onSelect: vi.fn() };

describe('live workspace result ordering', () => {
  it('keeps ranked workspace rows on updates and Return chooses the highest current match', () => {
    const select = vi.fn();
    const headings = new Map([['defined:old', 'Workspaces']]);
    const view = render(
      <CommandResults
        {...props}
        onSelect={select}
        query="nocli"
        rows={[row('defined:old'), row('defined:best'), row('workspace:w1')]}
        headings={headings}
      />,
    );
    view.rerender(
      <CommandResults
        {...props}
        onSelect={select}
        query="nocli"
        rows={[row('defined:best'), row('defined:old'), row('workspace:w1')]}
        headings={new Map([['defined:best', 'Workspaces']])}
      />,
    );
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'defined:best',
      'defined:old',
      'workspace:w1',
    ]);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(select.mock.calls[0]![0].id).toBe('defined:best');
  });
  it('keeps new open rows above retained definitions and moves headings to the displayed first rows', () => {
    const view = render(
      <CommandResults
        {...props}
        query=""
        label="Search workspaces"
        rows={[row('workspace:first'), row('defined:second'), row('defined:third')]}
        headings={
          new Map([
            ['workspace:first', 'Open'],
            ['defined:second', 'Defined'],
          ])
        }
      />,
    );
    view.rerender(
      <CommandResults
        {...props}
        query=""
        label="Search workspaces"
        rows={[row('workspace:second'), row('workspace:first'), row('defined:third')]}
        headings={
          new Map([
            ['workspace:second', 'Open'],
            ['defined:third', 'Defined'],
          ])
        }
      />,
    );
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'workspace:first',
      'workspace:second',
      'defined:third',
    ]);
    const groups = [...view.container.querySelectorAll('.command-group')];
    expect(groups.map((group) => group.textContent)).toEqual(['Open', 'Defined']);
    expect(groups[0]!.nextElementSibling!.textContent).toBe('workspace:first');
  });
  it('keeps commands first and All matching workspaces last during a main-palette update', () => {
    const headings = new Map([
      ['command:action', 'Commands'],
      ['defined:second', 'Workspaces'],
    ]);
    const view = render(
      <CommandResults
        {...props}
        query="project"
        rows={[
          row('command:action'),
          row('defined:second'),
          row('defined:third'),
          row('palette:more-workspaces'),
        ]}
        headings={headings}
      />,
    );
    view.rerender(
      <CommandResults
        {...props}
        query="project"
        rows={[
          row('command:action'),
          row('workspace:second'),
          row('defined:third'),
          row('palette:more-workspaces'),
        ]}
        headings={
          new Map([
            ['command:action', 'Commands'],
            ['workspace:second', 'Workspaces'],
          ])
        }
      />,
    );
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'command:action',
      'workspace:second',
      'defined:third',
      'palette:more-workspaces',
    ]);
  });
  it('preserves the prior pointer order of ordinary rows inside an unchanged section', () => {
    const view = render(
      <CommandResults
        {...props}
        query="project"
        rows={[row('command:first'), row('command:second')]}
      />,
    );
    view.rerender(
      <CommandResults
        {...props}
        query="project"
        rows={[row('command:new'), row('command:second'), row('command:first')]}
      />,
    );
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'command:first',
      'command:second',
      'command:new',
    ]);
  });
});
