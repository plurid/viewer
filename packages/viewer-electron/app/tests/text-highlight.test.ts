// @vitest-environment jsdom
/**
 * COMMON LANGUAGES ARE HIGHLIGHTED (2026-10-23): a grammar beyond the first seven loads on first use,
 * and a Markdown document's fenced code is highlighted in its language.
 */
import { afterEach, beforeAll, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { FileEntry, ResourceRead } from '../src/domain/contracts';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import TextPreview from '../src/renderer/previews/modules/TextPreview';
import { initialize } from '../src/renderer/state/store';

beforeAll(() => {
  // the code view reads the editor's font settings
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
  // the virtualized list measures its scroller; jsdom lays nothing out
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 800, height: 800, top: 0, left: 0, right: 800, bottom: 800, x: 0, y: 0 }) as DOMRect;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  });
});
afterEach(cleanup);

const context = (name: string, text: string): PreviewContext => {
  const extension = name.split('.').pop()!;
  const entry = {
    path: `/fixtures/${name}`,
    name,
    parent: '/fixtures',
    extension,
    mime: 'text/plain',
    size: text.length,
    kind: 'file',
    directory: false,
    identity: '1:1',
    modified: 1,
    created: 1,
    hidden: false,
  } as FileEntry;
  const read: ResourceRead = { text, truncated: false, binary: false };
  return {
    resource: { id: 'resource', entry, url: '' } as unknown as PreviewContext['resource'],
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    services: { read: async () => read } as unknown as PreviewContext['services'],
  };
};

it('highlights a Rust file once its grammar has loaded', async () => {
  const view = render(createElement(TextPreview, context('main.rs', 'fn main() { let x = 1; }')));
  await waitFor(() =>
    expect(view.container.querySelector('.token.keyword')?.textContent).toBe('fn'),
  );
});

it("highlights a Markdown document's fenced code in its language", async () => {
  const view = render(
    createElement(TextPreview, context('notes.md', '# Notes\n\n```rust\nfn main() {}\n```\n')),
  );
  await waitFor(() =>
    expect(view.container.querySelector('article.markdown .token.keyword')?.textContent).toBe('fn'),
  );
});
