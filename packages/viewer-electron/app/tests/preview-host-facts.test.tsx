// @vitest-environment jsdom
/**
 * WHAT A PREVIEW'S HOST GIVES A FORMAT: its footer shows what the format's toolbar gives, such as a
 * picture's dimensions, only with the file it was given for, never for a moment with the next one;
 * and a format that cannot show its file offers the file's own app, for a file of its own only.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import type { FileEntry, Resource } from '../src/domain/contracts';
import type { PreviewContext, PreviewModule } from '../src/renderer/previews/contracts';
import type * as Registry from '../src/renderer/previews/registry';

const probe = vi.hoisted(() => ({ module: undefined as PreviewModule | undefined }));
vi.mock('../src/renderer/previews/registry', async (original) => {
  const actual = await original<typeof Registry>();
  return {
    ...actual,
    choosePreview: (entry: FileEntry, modules?: PreviewModule[]) =>
      probe.module ?? actual.choosePreview(entry, modules),
  };
});
const { PreviewHost } = await import('../src/renderer/previews/PreviewHost');
const { PreviewToolbar } = await import('../src/renderer/previews/controls');
const { PreviewFailure } = await import('../src/renderer/previews/PreviewFailure');
const { headerItem } = await import('../src/renderer/workspace/header-overflow');
const { initialize } = await import('../src/renderer/state/store');
const { CommandsContext } = await import('../src/renderer/commands/context');
const { CommandRegistry } = await import('../src/renderer/commands/registry');

/** A format whose toolbar gives a fact for the file called "a" only. */
function Facts(context: PreviewContext) {
  return (
    <>
      <PreviewToolbar context={context}>
        {context.resource.id === 'a' && <span {...headerItem('size', 9, 'detail')}>A’s fact</span>}
      </PreviewToolbar>
      <p>Showing {context.resource.id}</p>
    </>
  );
}
const resource = (id: string): Resource => ({
  id,
  url: '',
  entry: {
    path: `/fixtures/${id}.probe`,
    name: `${id}.probe`,
    parent: '/fixtures',
    extension: 'probe',
    size: 6,
    kind: 'file',
    directory: false,
    modified: 1,
    created: 1,
    hidden: false,
    mime: '',
    identity: id,
  },
});

beforeEach(() => {
  probe.module = {
    id: 'facts',
    label: 'Facts',
    formats: [],
    detect: () => 100,
    load: async () => ({ default: Facts }),
  };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.assign(window, {
    viewer: {
      onEvent: () => () => {},
      release: vi.fn(async () => {}),
      resource: vi.fn(async () => resource('a')),
      openExternal: vi.fn(async () => {}),
      // a file of its own is watched for changes
      watch: vi.fn(async () => {}),
      unwatch: vi.fn(async () => {}),
      stat: vi.fn(async () => resource('a').entry),
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows a file’s facts with that file only', async () => {
  /** Each footer drawn: for which file, with which facts. */
  const drawn: [string, readonly string[]][] = [];
  const footer = (shown: Resource, _module: PreviewModule, _hex: unknown, details = []) => {
    drawn.push([shown.id, details]);
    return <footer>{(details as string[]).join(' · ')}</footer>;
  };
  const registry = new CommandRegistry();
  const host = (id: string) =>
    createElement(
      CommandsContext.Provider,
      { value: registry },
      createElement(PreviewHost, { resource: resource(id), renderFooter: footer }),
    );
  const view = render(host('a'));
  await view.findByText('A’s fact');
  view.rerender(host('b'));
  await view.findByText('Showing b');
  expect(drawn.some(([id, details]) => id === 'b' && details.includes('A’s fact'))).toBe(false);
  expect(view.queryByText('A’s fact')).toBeNull();
});

it('offers the file’s own app when a format cannot show it, for a file of its own only', async () => {
  probe.module = {
    id: 'failing',
    label: 'Failing',
    formats: [],
    detect: () => 100,
    load: async () => ({
      default: (context: PreviewContext) => (
        <PreviewFailure context={context} title="Can’t show this probe" />
      ),
    }),
  };
  const registry = new CommandRegistry();
  const host = (props: Record<string, unknown>) =>
    createElement(CommandsContext.Provider, { value: registry }, createElement(PreviewHost, props));
  const view = render(host({ path: '/fixtures/a.probe' }));
  (await view.findByRole('button', { name: 'Open in Default App' })).click();
  expect(window.viewer.openExternal).toHaveBeenCalledWith('/fixtures/a.probe');
  cleanup();
  // an archive's entry or an attachment, given to the host, has no path of its own outside Viewer
  const given = render(host({ resource: resource('b') }));
  await given.findByText('Can’t show this probe');
  expect(given.queryByRole('button', { name: 'Open in Default App' })).toBeNull();
});
