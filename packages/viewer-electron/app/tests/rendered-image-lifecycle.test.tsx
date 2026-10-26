// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import RenderedImagePreview from '../src/renderer/previews/modules/RenderedImagePreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import type { Resource } from '../src/domain/contracts';
import type { ImageRenditionRequest } from '../src/domain/previews/images/rendered';

afterEach(cleanup);
it('cancels an ordinary image request on view closure and releases late bytes', async () => {
  let finish!: (value: Resource) => void;
  const rendition = vi.fn(
    (_id: string, _request?: ImageRenditionRequest) =>
      new Promise<Resource>((resolve) => {
        finish = resolve;
      }),
  );
  const cancelDocument = vi.fn(),
    release = vi.fn();
  const context = {
    resource: { id: 'source', entry: { extension: 'tiff' } },
    services: { rendition, cancelDocument, release },
  } as unknown as PreviewContext;
  const view = render(createElement(RenderedImagePreview, context));
  const request = rendition.mock.calls[0]![1] as { requestID: string };
  view.unmount();
  expect(cancelDocument).toHaveBeenCalledWith('source', request.requestID);
  await act(async () => finish({ id: 'late-image' } as Resource));
  expect(release).toHaveBeenCalledWith('late-image');
});
