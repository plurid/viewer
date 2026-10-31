// @vitest-environment jsdom
/**
 * The hex view reads a file in pages through its resource, only those the rows on screen fall in,
 * and moves its cursor with keys and Go to offset. It is what a file no preview reads shows, under
 * what its first bytes say, and Show as hex shows any other file the same way.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import type { FileEntry, Resource } from '../src/domain/contracts';
import type { PreviewContext, PreviewModule } from '../src/renderer/previews/contracts';
import type * as Registry from '../src/renderer/previews/registry';
import { hexPage } from '../src/domain/files/hex';
import { changeWorkspace } from '../src/renderer/state/core';
import { initialize } from '../src/renderer/state/store';
import { mockElementBox } from './support/layout';
import { inspectionSamples, noise } from '../tools/playground/samples/inspection';

const probe = vi.hoisted(() => ({
  module: undefined as PreviewModule | undefined,
}));
// the host previews with a probe module where a test sets one
vi.mock('../src/renderer/previews/registry', async (original) => {
  const actual = await original<typeof Registry>();
  return {
    ...actual,
    choosePreview: (entry: FileEntry, modules?: PreviewModule[]) =>
      probe.module ?? actual.choosePreview(entry, modules),
  };
});
const { default: HexPreview } = await import('../src/renderer/previews/modules/HexPreview');
const { default: TextPreview } = await import('../src/renderer/previews/modules/TextPreview');
const { PreviewHost } = await import('../src/renderer/previews/PreviewHost');
const { CommandsContext } = await import('../src/renderer/commands/context');
const { CommandRegistry } = await import('../src/renderer/commands/registry');

/** A file of `size` bytes whose byte at `offset` is `pattern(offset)`, served by range. */
let size = 0;
let pattern: (offset: number) => number = () => 0;
const fetched = vi.fn(async (_url: string, init?: RequestInit) => {
  const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '');
  if (!range) throw new Error('The hex view asked for the whole file.');
  const start = Number(range[1]);
  const end = Math.min(Number(range[2]), size - 1);
  return new Response(
    Uint8Array.from({ length: end - start + 1 }, (_, index) => pattern(start + index)),
  );
});
const probeCommands = [{ id: 'probe', label: 'Probe command', run() {} }];
/** A module that registers a command of its own, and can ask for hex. */
function Probe(context: PreviewContext) {
  useEffect(() => context.commands?.register(probeCommands), [context.commands]);
  return <button onClick={() => context.showHex?.()}>Probe content</button>;
}
const ranges = () =>
  fetched.mock.calls.map(([, init]) => new Headers(init?.headers).get('range') ?? 'none');

function context(name: string, bytes: number): PreviewContext {
  const values = new Map<string, unknown>();
  const entry = {
    path: `/fixtures/${name}`,
    name,
    parent: '/fixtures',
    extension: name.includes('.') ? name.split('.').pop()! : '',
    mime: 'application/octet-stream',
    size: bytes,
    kind: 'file',
    directory: false,
    identity: '1:1',
    modified: 1,
    created: 1,
    hidden: false,
  } as FileEntry;
  return {
    resource: { id: 'resource', entry, url: `viewer-resource://resource/asset/${name}` },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
    services: { read: async () => ({ text: '', binary: true, truncated: false }) },
  } as unknown as PreviewContext;
}
/** jsdom keeps no scroll position: give the grid one. */
function scrollable(grid: HTMLElement) {
  let top = 0;
  Object.defineProperty(grid, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  return (value: number) => {
    top = value;
    fireEvent.scroll(grid);
  };
}
const selected = (view: ReturnType<typeof render>) =>
  view.container.querySelector('[aria-selected="true"]')?.getAttribute('data-offset');

beforeAll(() => {
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
  mockElementBox(800, 400);
});
beforeEach(() => {
  vi.stubGlobal('fetch', fetched);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  probe.module = undefined;
  const bytes = noise();
  size = bytes.length;
  pattern = (offset) => bytes[offset]!;
});
afterEach(() => {
  cleanup();
  fetched.mockClear();
  vi.unstubAllGlobals();
});

describe('the hex view', () => {
  it('shows offset, hexadecimal and ASCII columns, reading only the page on screen', async () => {
    const view = render(<HexPreview {...context('Noise.bin', size)} />);
    const grid = await view.findByRole('grid', { name: 'File bytes' });
    await waitFor(() => expect(grid.querySelector('.hex-byte.pending')).toBeNull());
    const first = grid.querySelector('.hex-row')!;
    expect(first.querySelector('.hex-offset')!.textContent).toBe('00000000');
    const hex = [...first.querySelectorAll('.hex-byte')].map((cell) => cell.textContent);
    expect(hex).toEqual(
      Array.from({ length: 16 }, (_, index) =>
        pattern(index).toString(16).toUpperCase().padStart(2, '0'),
      ),
    );
    expect(first.querySelector('.hex-ascii')!.textContent).toHaveLength(16);
    expect(ranges()).toEqual([`bytes=0-${hexPage - 1}`]);
  });

  it('reads the next pages as the rows reach them, and never the whole file', async () => {
    const view = render(<HexPreview {...context('Noise.bin', size)} />);
    const grid = await view.findByRole('grid', { name: 'File bytes' });
    const scroll = scrollable(grid);
    act(() => scroll(((2 * hexPage) / 16) * 20 + 200));
    await waitFor(() => expect(ranges()).toContain(`bytes=${2 * hexPage}-${3 * hexPage - 1}`));
    for (const range of ranges()) {
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
      expect(Number(end) - Number(start) + 1).toBeLessThanOrEqual(hexPage);
    }
  });

  it('moves the cursor with arrow keys and to the file’s ends with ⌘↑ and ⌘↓', async () => {
    const view = render(<HexPreview {...context('Noise.bin', size)} />);
    const grid = await view.findByRole('grid', { name: 'File bytes' });
    scrollable(grid);
    expect(selected(view)).toBe('0');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(selected(view)).toBe('17');
    fireEvent.keyDown(grid, { key: 'End' });
    expect(selected(view)).toBe('31');
    fireEvent.keyDown(grid, { key: 'ArrowDown', metaKey: true });
    await waitFor(() => expect(selected(view)).toBe(String(size - 1)));
    expect(view.getByText(/^0002FFFF/)).toBeTruthy();
    fireEvent.keyDown(grid, { key: 'ArrowUp', metaKey: true });
    await waitFor(() => expect(selected(view)).toBe('0'));
  });

  it('goes to an offset typed in hexadecimal or decimal, and says when one is past the end', async () => {
    const view = render(<HexPreview {...context('Noise.bin', size)} />);
    const grid = await view.findByRole('grid', { name: 'File bytes' });
    scrollable(grid);
    const field = view.getByRole('textbox', { name: 'Go to offset' });
    fireEvent.change(field, { target: { value: '0x20010' } });
    fireEvent.submit(field);
    await waitFor(() => expect(selected(view)).toBe(String(0x20010)));
    await waitFor(() => expect(ranges()).toContain(`bytes=${2 * hexPage}-${3 * hexPage - 1}`));
    expect(await view.findByText(/^00020010 · /)).toBeTruthy();
    fireEvent.change(field, { target: { value: '4096' } });
    fireEvent.submit(field);
    await waitFor(() => expect(selected(view)).toBe('4096'));
    fireEvent.change(field, { target: { value: '0x900000' } });
    fireEvent.submit(field);
    expect(view.getByRole('alert').textContent).toContain('The file ends at 0002FFFF');
    expect(selected(view)).toBe('4096');
  });

  it('maps a file too long to lay out onto a bounded scroller, and reads its last page alone', async () => {
    size = 10 * 1024 ** 3;
    pattern = (offset) => offset % 251;
    const view = render(<HexPreview {...context('Disk image.raw', size)} />);
    const grid = await view.findByRole('grid', { name: 'File bytes' });
    scrollable(grid);
    const spacer = grid.querySelector<HTMLElement>('.hex-spacer')!;
    expect(Number.parseFloat(spacer.style.height)).toBeLessThanOrEqual(4_000_000);
    const field = view.getByRole('textbox', { name: 'Go to offset' });
    fireEvent.change(field, { target: { value: String(size - 16) } });
    fireEvent.submit(field);
    const last = Math.floor((size - 16) / hexPage) * hexPage;
    await waitFor(() => expect(ranges()).toContain(`bytes=${last}-${size - 1}`));
    await waitFor(() => expect(selected(view)).toBe(String(size - 16)));
    expect(ranges().length).toBeLessThanOrEqual(3);
  });

  it('says an empty file is empty, reading nothing', () => {
    const view = render(<HexPreview {...context('Empty.bin', 0)} />);
    expect(view.getByText('This file is empty')).toBeTruthy();
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe('a file no preview reads', () => {
  it('shows what its header says above its bytes', async () => {
    const universal = Buffer.from(
      inspectionSamples().find((sample) => sample.path.endsWith('Universal object.o'))!.bytes,
    );
    size = universal.length;
    pattern = (offset) => universal[offset]!;
    const view = render(<TextPreview {...context('Universal object.o', size)} />);
    expect(await view.findByText('Looks like a Mach-O universal binary')).toBeTruthy();
    expect(view.getByText('x86_64, 32 B at 0x1000')).toBeTruthy();
    expect(view.getByText('arm64, 32 B at 0x2000')).toBeTruthy();
    expect(view.getByRole('grid', { name: 'File bytes' })).toBeTruthy();
  });
});

describe('Show as hex', () => {
  const resource = (): Resource => ({
    id: 'resource',
    url: 'viewer-resource://resource/asset/report.custom',
    entry: { ...context('report.custom', size).resource.entry },
  });
  const viewer = {
    release: vi.fn(async () => {}),
    onEvent: vi.fn(() => () => {}),
  };
  const host = (module: PreviewModule) => {
    probe.module = module;
    Object.assign(window, { viewer });
    // the plane its commands are valid for
    changeWorkspace((space) => ({
      ...space,
      panes: [{ id: 'plane', type: 'preview', path: resource().entry.path }],
    }));
    const registry = new CommandRegistry();
    const view = render(
      createElement(
        CommandsContext.Provider,
        { value: registry },
        createElement(PreviewHost, { resource: resource(), paneID: 'plane' }),
      ),
    );
    const labels = () =>
      registry.list({ sources: ['preview:plane'] }).map((command) => command.label);
    // the plane's "…" and the palette run it; its footer has no Hex button
    const toggle = () => act(() => registry.invoke('preview.hex', { sources: ['preview:plane'] }));
    return { view, labels, toggle };
  };
  const module = (hex?: 'own'): PreviewModule => ({
    id: 'probe',
    label: 'Probe',
    formats: [],
    hex,
    detect: () => 100,
    load: async () => ({ default: Probe }),
  });

  it('shows any file’s bytes in place of its preview, and offers the preview back', async () => {
    const { view, labels, toggle } = host(module());
    await view.findByText('Probe content');
    await waitFor(() => expect(labels()).toEqual(['Probe command', 'Show as hex']));
    expect(view.queryByRole('button', { name: 'Hex' })).toBeNull();
    await toggle();
    expect(await view.findByRole('grid', { name: 'File bytes' })).toBeTruthy();
    expect(view.queryByText('Probe content')).toBeNull();
    await waitFor(() => expect(labels()).toEqual(['Go to offset', 'Show preview']));
    await toggle();
    expect(await view.findByText('Probe content')).toBeTruthy();
  });

  it('leaves Show as hex to a module that guards its bytes', async () => {
    const { view, labels } = host(module('own'));
    await view.findByText('Probe content');
    await waitFor(() => expect(labels()).toEqual(['Probe command']));
    fireEvent.click(view.getByText('Probe content'));
    expect(await view.findByRole('grid', { name: 'File bytes' })).toBeTruthy();
    await waitFor(() => expect(labels()).toEqual(['Go to offset', 'Show preview']));
  });
});
