// @vitest-environment jsdom
/**
 * A DATA TREE'S TOOLBAR (DESIGN.md, the Preview Bar Rule): JSON, YAML, TOML and XML trees have the
 * one toolbar every preview has. Expand All and Collapse All are commands too, so they give way
 * into "…" rather than hiding below a width; Copy stays in place, waiting for a row.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { PreviewCommand, PreviewContext } from '../src/renderer/previews/contracts';
import { StructuredTree } from '../src/renderer/previews/StructuredTree';
import { inspectStructured } from '../src/domain/previews/data/structured';
import { PreviewFrameFixture } from './support/preview-frame';

let registered: PreviewCommand[] = [];
const values = new Map<string, unknown>();
const context = {
  resource: { id: 'data', url: '', entry: { path: '/fixtures/a.json', name: 'a.json' } },
  active: true,
  interactive: true,
  state: { get: (key: string) => values.get(key), set: values.set.bind(values) },
  commands: {
    register: (commands: readonly PreviewCommand[]) => {
      registered = [...commands];
      return () => {};
    },
  },
} as unknown as PreviewContext;

beforeEach(() => {
  registered = [];
  values.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('has one toolbar whose Expand All and Collapse All give way as commands', () => {
  const view = render(
    <PreviewFrameFixture>
      <StructuredTree context={context} data={inspectStructured('{"a":{"b":1}}', 'json')} />
    </PreviewFrameFixture>,
  );
  expect(view.container.querySelectorAll('.preview-toolbar')).toHaveLength(1);
  const item = (name: string) =>
    screen.getByRole('button', { name }).closest<HTMLElement>('[data-header-item]')!;
  expect(item('Expand All').dataset.headerCommands).toBe('preview.tree-expand');
  expect(item('Collapse All').dataset.headerCommands).toBe('preview.tree-collapse');
  expect(registered.map((command) => command.label)).toEqual(['Expand All', 'Collapse All']);
  act(() => void registered[0]!.run());
  expect(values.get('tree.expansion')).toEqual({ all: true, open: [], closed: [] });
  // Copy is there before a row is chosen, so choosing one moves nothing
  expect(screen.getByRole('button', { name: 'Copy' })).toHaveProperty('disabled', true);
});

it('hides nothing by a width breakpoint', () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, '../src/renderer/styles/formats.css'),
    'utf8',
  );
  expect(css).not.toMatch(/@container/);
  expect(css).not.toMatch(/tree-expand-inline|office-row-count/);
});
