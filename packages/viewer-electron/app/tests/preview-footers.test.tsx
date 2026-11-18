// @vitest-environment jsdom
/**
 * THE FOOTERS OF A PREVIEW IN A DIALOG (DESIGN.md, the Preview Identity Rule): Quick Preview's and
 * the Trash's name no file, as their titles do, and show the facts the preview's toolbar gave, the
 * Trash's place the file came from last, as it gives way first.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { FileEntry, Resource } from '../src/domain/contracts';
import type { PreviewModule } from '../src/renderer/previews/contracts';

/** The facts every preview's toolbar gives its footer here. */
const facts = ['2400 × 900'];
vi.mock('../src/renderer/previews/PreviewHost', async () => {
  const { choosePreview } = await import('../src/renderer/previews/registry');
  return {
    PreviewHost: ({
      path,
      resource: supplied,
      renderFooter,
    }: {
      path?: string;
      resource?: Resource;
      renderFooter(
        resource: Resource,
        module: PreviewModule,
        hex: undefined,
        details: readonly string[],
      ): unknown;
    }) => {
      const entry: FileEntry = supplied?.entry ?? {
        path: path!,
        name: path!.split('/').pop()!,
        parent: '/fixtures',
        extension: 'png',
        size: 2_100_000,
        kind: 'file',
        directory: false,
        modified: 1,
        created: 1,
        hidden: false,
        mime: 'image/png',
        identity: path!,
      };
      return renderFooter(
        supplied ?? { id: 'r', url: '', entry },
        choosePreview(entry),
        undefined,
        facts,
      );
    },
  };
});
const { QuickPreview } = await import('../src/renderer/previews/QuickPreview');
const { TrashPreview } = await import('../src/renderer/ui/trash/TrashPreview');
const { WorkspaceContext } = await import('../src/renderer/workspace/context');
const { getState, initialize, quickPreview } = await import('../src/renderer/state/store');

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      applications: vi.fn(async () => ({ defaultName: 'Preview', applications: [] })),
      release: vi.fn(async () => {}),
      trashPreview: vi.fn(async (id: string) => ({
        id: `trash:${id}`,
        url: '',
        entry: {
          path: `/Trash/${id}`,
          name: id,
          parent: '/Trash',
          extension: 'png',
          size: 2_100_000,
          kind: 'file',
          directory: false,
          modified: 1,
          created: 1,
          hidden: false,
          mime: 'image/png',
          identity: id,
        },
      })),
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A footer's facts, as it shows them. */
const shown = (footer: Element) =>
  [
    ...footer.querySelectorAll(
      '.preview-file-info > .preview-file-details:not(.preview-info-measure) > *',
    ),
  ].map((fact) => fact.textContent!.replace('·', ''));

it('leaves the name to Quick Preview’s title and shows the toolbar’s facts', () => {
  quickPreview(['/fixtures/photo.png'], {
    paneID: 'folder',
    workspaceID: getState().saved.activeWorkspace,
  });
  const view = render(
    createElement(
      WorkspaceContext.Provider,
      { value: { openPath: vi.fn(), focusPane: vi.fn() } as never },
      createElement(QuickPreview, { session: getState().quickPreview! }),
    ),
  );
  const footer = view.container.ownerDocument.querySelector('.quick-preview-footer')!;
  expect(footer.querySelector('.preview-filename:not(.preview-info-measure)')).toBeNull();
  expect(shown(footer)).toEqual(['PNG image', '2.1 MB', '2400 × 900']);
  // the first fact has no separator before it
  expect(
    footer.querySelector(
      '.preview-file-details:not(.preview-info-measure) > :first-child .separator',
    ),
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Open Linked Plane' })).toBeTruthy();
});

it('shows where a file in the Trash came from last, after the preview’s facts', async () => {
  render(
    createElement(TrashPreview, {
      items: [
        {
          id: 'photo.png',
          name: 'photo.png',
          directory: false,
          size: 2_100_000,
          location: '~/Desktop',
        },
      ],
      initial: 0,
      onClose: vi.fn(),
      restore: vi.fn(async () => true),
    }),
  );
  await waitFor(() =>
    expect(document.querySelector('.quick-preview-footer .preview-file-info')).toBeTruthy(),
  );
  const footer = document.querySelector('.quick-preview-footer')!;
  expect(footer.querySelector('.preview-filename:not(.preview-info-measure)')).toBeNull();
  expect(shown(footer)).toEqual(['Image', '2.1 MB', '2400 × 900', '~/Desktop']);
});
