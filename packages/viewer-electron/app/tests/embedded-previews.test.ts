// @vitest-environment jsdom
/** Previews embedded in a folder plane, and a preview plane's own frame (2026-10-20). */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import type { FileEntry } from '../src/domain/contracts';

const hosted = vi.hoisted(() => [] as { active?: boolean; interactive?: boolean }[]);
vi.mock('../src/renderer/previews/PreviewHost', () => ({
  PreviewHost: (props: { active?: boolean; interactive?: boolean }) => {
    hosted.push(props);
    return null;
  },
}));
import { GalleryView } from '../src/renderer/explorer/views';
import { PreviewActivity } from '../src/renderer/previews/activity';
import { PreviewFrame } from '../src/renderer/workspace/preview-frame';

afterEach(() => {
  cleanup();
  hosted.length = 0;
});
const file = {
  path: '/Photos/one.png',
  name: 'one.png',
  parent: '/Photos',
  extension: 'png',
  kind: 'file',
  directory: false,
  size: 1,
  modified: 1,
  created: 1,
  hidden: false,
  mime: 'image/png',
  identity: '1:1',
} as FileEntry;

it('pauses a Gallery preview whose plane is off screen or not taking input', () => {
  // Embedded previews passed neither, so their media and animation ran offscreen.
  render(
    createElement(
      PreviewActivity.Provider,
      { value: { active: false, interactive: false } },
      createElement(GalleryView, {
        entries: [file],
        selection: [file.path],
        selectionSet: new Set([file.path]),
        cursor: file.path,
        select: vi.fn(),
        showHidden: false,
        open: vi.fn(),
        context: vi.fn(),
        drag: vi.fn(),
      }),
    ),
  );
  expect(hosted.at(-1)).toMatchObject({ active: false, interactive: false });
});
it('takes the focus of a pressed preview whose content takes none', () => {
  // After a click on an image, PDF or EPUB, the keys went to the body, and plurid moved the camera.
  const activate = vi.fn();
  const view = render(
    createElement(PreviewFrame, { activate, children: createElement('img', { alt: 'picture' }) }),
  );
  fireEvent.pointerDown(view.getByAltText('picture'));
  expect(activate).toHaveBeenCalledOnce();
  expect(document.activeElement?.classList.contains('preview-plane')).toBe(true);
});
