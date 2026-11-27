// @vitest-environment jsdom
import { afterEach, beforeEach, it, vi, expect } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import path from 'node:path';
import { initialize } from '../src/renderer/state/store';
import { Resources } from '../src/desktop/previews/resources';
import { fileCoordination, FileCoordination } from '../src/desktop/files/file-coordination';
import { PreviewHost } from '../src/renderer/previews/PreviewHost';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { CommandsContext } from '../src/renderer/commands/context';
import { PreviewWorker } from '../src/renderer/previews/worker-client';
import { ReaderRefusal, readerProblemFields } from '../src/domain/previews/reader-problem';
import { restoreApiErrors } from '../src/renderer/api-boundary';
import { dxf, entity } from './dxf-fixtures';
import { errorMessage } from '../src/domain/errors';

beforeEach(() => {
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  vi.stubGlobal('viewer', {
    diagnosticReport: async () => {},
    applications: async () => ({}),
    release: async () => {},
    watch: async () => {},
    unwatch: async () => {},
    onEvent: () => () => {},
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('offers Try Again after a transient read of a supplied drawing grant', async () => {
  const access = vi.fn(async () => {});
  const diagnose = vi.fn();
  const resources = new Resources(
    access,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    diagnose,
  );
  const drawing = dxf(entity('LINE', [10, 0, 20, 0, 11, 4, 21, 4]));
  const resource = await resources.grantBytes(
    process.cwd(),
    'drawing.dxf',
    Buffer.from(drawing),
    1,
  );
  const original = self.onmessage;
  await import('../src/renderer/previews/dxf/dxf.worker');
  const read = self.onmessage!.bind(self);
  self.onmessage = original;
  vi.stubGlobal(
    'Worker',
    class {
      onmessage?: (message: MessageEvent) => void;
      postMessage(request: unknown) {
        vi.spyOn(self, 'postMessage').mockImplementation((data) =>
          this.onmessage?.(new MessageEvent('message', { data })),
        );
        void read(new MessageEvent('message', { data: request }));
      }
      terminate() {}
    },
  );
  const error = Object.assign(new Error('interrupted drawing read'), { code: 'EIO' });
  access.mockRejectedValueOnce(error);
  const statuses: number[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const res = await resources.response(new Request(url));
    statuses.push(res.status);
    return res;
  });
  render(
    <CommandsContext value={new CommandRegistry()}>
      <PreviewHost resource={resource} renderFooter={() => null} />
    </CommandsContext>,
  );
  await screen.findByText("Viewer couldn't read this drawing.");
  expect(diagnose).toHaveBeenCalledWith(error);
  fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
  await waitFor(() => expect(statuses).toEqual([500, 200]));
  await waitFor(() => expect(screen.queryByText("Viewer couldn't read this drawing.")).toBeNull());
});

it('preserves the file provider’s instruction when an item moves before grant', async () => {
  const location = path.join(process.cwd(), 'package.json');
  const coordination = new FileCoordination(() => ({
    coordinateStart: async () => [path.join(process.cwd(), 'tsconfig.main.json')],
    coordinateEnd: async () => {},
    coordinateCancel: () => {},
    coordinateSameItem: () => false,
  }));
  vi.spyOn(fileCoordination, 'acquire').mockImplementation(coordination.acquire.bind(coordination));
  const resources = new Resources();
  const reader = async () => {
    try {
      return await resources.grant(location, undefined, 1);
    } catch (error) {
      throw structuredClone({ message: errorMessage(error), ...readerProblemFields(error) });
    }
  };
  vi.stubGlobal('viewer', { ...window.viewer, ...restoreApiErrors({ resource: reader }) });
  render(
    <CommandsContext value={new CommandRegistry()}>
      <PreviewHost path={location} />
    </CommandsContext>,
  );
  await screen.findByRole('button', { name: 'Try Again' });
  expect(document.body.textContent).toContain(
    'The item moved while waiting for its file provider. Refresh the folder and retry.',
  );
});

it.each(['internal length detail', ''])(
  'keeps a table worker refusal with diagnostic %j',
  async (detail) => {
    const sentence = 'Use a table filter shorter than 4096 characters.';
    const error = new ReaderRefusal(sentence, detail);
    const worker = new PreviewWorker(
      () =>
        ({
          postMessage(this: Worker, request: { id: number }) {
            const data = structuredClone({
              id: request.id,
              error: errorMessage(error),
              ...readerProblemFields(error),
            });
            this.onmessage?.(new MessageEvent('message', { data }));
          },
          terminate() {},
        }) as Worker,
      'Table processing',
    );
    try {
      await expect(worker.request({ action: 'filter' })).rejects.toMatchObject({
        readerProblem: sentence,
      });
    } finally {
      worker.close();
    }
  },
);
