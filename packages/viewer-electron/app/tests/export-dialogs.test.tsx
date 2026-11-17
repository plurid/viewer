// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import type { MediaDraft } from '../src/domain/media/documents';
import { temporalIdentity } from '../src/domain/files/item-identity';
import { mediaTransformSchema } from '../src/domain/operations/transforms';
import { ImageToolsDialog } from '../src/renderer/media/ImageToolsDialog';
import { OptimizeDialog } from '../src/renderer/media/OptimizeDialog';
import MediaPlane from '../src/renderer/media/MediaPlane';
import { flushMediaDrafts } from '../src/renderer/media/drafts';
import { PDFToolsDialog } from '../src/renderer/pdf-tools/PDFToolsDialog';
import { ActionParameters, requestParameters } from '../src/renderer/commands/ActionParameters';
import { DestinationDialog } from '../src/renderer/commands/DestinationDialog';
import { ProjectControls, requestProject } from '../src/renderer/workspace/projects';
import { FileNameField, fileNameError } from '../src/renderer/ui/FileNameField';
import { DestinationField } from '../src/renderer/ui/DestinationField';
import { measurePathLabels } from './support/path-label-room';
import type { PathLabelRoom } from './support/path-label-room';
import {
  activeWorkspace,
  associateProject,
  flushState,
  initialize,
} from '../src/renderer/state/store';

vi.mock('../src/renderer/workspace/context', () => ({
  useWorkspace: () => ({ openPath: vi.fn() }),
}));
vi.mock('../src/renderer/pdf-tools/PDFPagePreview', () => ({
  PDFPagePreview: () => <div>Page preview</div>,
}));

const home = '/Users/fixture';
const folder =
  home +
  '/' +
  Array.from({ length: 18 }, (_, index) => `level-${index}`).join('/') +
  '/oferta-de-pret-snecuri-automata-4-7/3D';
const stem = 'a'.repeat(200);
const file: FileEntry = {
  name: stem + '.png',
  path: folder + '/' + stem + '.png',
  parent: folder,
  extension: 'png',
  mime: 'image/png',
  kind: 'file',
  directory: false,
  size: 100,
  identity: 'image',
  modified: 1,
  created: 1,
  hidden: false,
};

const styles = [
  'styles/base.css',
  'ui/path-label.css',
  'styles/dialogs.css',
  'styles/settings.css',
  'styles/tools.css',
  'ui/form-fields.css',
  'media/image-tools.css',
  'media/media.css',
  'media/optimization.css',
  'pdf-tools/pdf-tools.css',
]
  .map((path) => readFileSync(new URL('../src/renderer/' + path, import.meta.url), 'utf8'))
  .join('\n');
let stylesheet: HTMLStyleElement;
let draft: MediaDraft;

/** A path label fits 45 characters of 7 px (tests/support/path-label-room.ts). */
const labelRoom = 320;
let room: PathLabelRoom;

/** Sentences these dialogs no longer say: filler, jargon or a description of the code. */
const removedSentences = [
  /Orientation is normalized/,
  /Smaller images keep their original size/,
  /Creates new files/,
  /copy streams without re-encoding/,
  /Prepare candidates, compare quality/,
  /Compare files before saving/,
  /Viewer stops here even if the target is missed/,
  /Compression will not go below this quality/,
  /Scanned-image compression supports/,
  /Lossless targets never lower image quality/,
  /External locations are saved/,
  /authorizes that location/,
  /frame accurate|keyframe aligned|nearby frame/,
  /drawing surface/,
  /Export saves a separate copy/,
  /A file with this name exists/,
];

function assertStackedFields(container: HTMLElement) {
  const fields = container.querySelectorAll<HTMLElement>('.dialog-field');
  expect(fields.length).toBeGreaterThan(0);
  for (const field of fields) {
    const style = getComputedStyle(field);
    expect(style.flexDirection).toBe('column');
    expect(style.alignItems).toBe('stretch');
    expect(style.minWidth).toBe('0px');
    expect(style.width).toBe('100%');
    expect(field.firstElementChild?.classList.contains('dialog-field-label')).toBe(true);
  }
}

/** A choice button is named by its label, then the choice it shows. */
async function choose(label: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: (name) => name.startsWith(label + ' ') }));
  const menu = await screen.findByRole('dialog', { name: label });
  fireEvent.click(within(menu).getByText(value));
}

beforeEach(() => {
  stylesheet = document.createElement('style');
  stylesheet.textContent = styles;
  document.head.append(stylesheet);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  draft = {
    version: 1,
    id: crypto.randomUUID(),
    revision: 1,
    sources: [
      {
        path: folder + '/source.mp4',
        version: { identity: temporalIdentity('video'), modified: 1, size: 100 },
        info: {
          duration: 10,
          extension: 'mp4',
          width: 2400,
          height: 900,
          fps: 30,
          video: true,
          audio: true,
          videoCodec: 'h264',
          audioCodec: 'aac',
        },
      },
    ],
    plan: mediaTransformSchema.parse({
      kind: 'media',
      format: 'mp4',
      segments: [{ source: 0, start: 0, end: 10 }],
    }),
  };
  Object.assign(window, {
    viewer: {
      imageInspect: vi.fn(async () => ({
        width: 2400,
        height: 900,
        alpha: true,
        preview: { id: 'preview', url: '' },
      })),
      release: vi.fn(async () => {}),
      onEvent: vi.fn(() => () => {}),
      save: vi.fn(async () => {}),
      stat: vi.fn(async () => {
        throw new Error('Not found');
      }),
      chooseFolder: vi.fn(async () => home),
      copyPaths: vi.fn(async () => {}),
      clipboardRead: vi.fn(async () => null),
      operate: vi.fn<ViewerAPI['operate']>(async () => 'export'),
      pdfInspect: vi.fn<ViewerAPI['pdfInspect']>(async () => ({
        pages: 2,
        version: { identity: temporalIdentity('pdf'), modified: 1, size: 100 },
      })),
      media: vi.fn<ViewerAPI['media']>(async (request) => {
        if (request.kind === 'get') return draft;
        if (request.kind === 'update') {
          draft = {
            ...draft,
            revision: draft.revision + 1,
            plan: mediaTransformSchema.parse(request.plan),
          };
          return draft;
        }
        if (request.kind === 'export') return { jobs: ['media-export'] };
      }),
    },
  });
  initialize({ home, platform: 'darwin', state: null, locations: [], openPaths: [] });
  room = measurePathLabels(labelRoom);
});

afterEach(async () => {
  cleanup();
  room.remove();
  await flushMediaDrafts();
  await flushState(false);
  stylesheet.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps a long image name stem and its fixed extension in a shared full-width field', async () => {
  const view = render(<ImageToolsDialog files={[file]} onClose={vi.fn()} />);
  await screen.findByText('2400 × 900 px, transparent');
  const input = screen.getByRole('textbox', { name: /^File name:/ }) as HTMLInputElement;
  expect(input.value).toBe(stem + ' converted');
  expect(input.selectionStart).toBe(input.value.length);
  expect(view.container.querySelector('.file-name-suffix')?.textContent).toBe('.webp');
  expect(input.closest('.dialog-field')).toBeTruthy();
});

it('shows the destination leaf and a home-relative tail, with concrete image output dimensions', async () => {
  render(<ImageToolsDialog files={[file]} onClose={vi.fn()} />);
  await screen.findByText('2400 × 900 px, transparent');
  expect(screen.getByText('3D')).toBeTruthy();
  expect(screen.getByText('~/…/oferta-de-pret-snecuri-automata-4-7/3D')).toBeTruthy();
  expect(screen.getByTitle(folder).getAttribute('aria-label')).toContain(folder);
  fireEvent.change(screen.getByLabelText('Output width'), { target: { value: '1200' } });
  expect(screen.getByText('Exports 1200 × 450 px WebP')).toBeTruthy();
  expect(screen.queryByText(/Orientation is normalized|Smaller images keep/)).toBeNull();
});

it.each([256, 300, 404])(
  'keeps the suffix fixed while the 200-character stem scrolls in a %ipx field',
  (width) => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1600);
    const view = render(
      <div style={{ width }}>
        <FileNameField value={stem} extension="png" folder={folder} onChange={vi.fn()} />
      </div>,
    );
    const input = screen.getByRole('textbox', {
      name: 'File name: ' + stem + '.png',
    }) as HTMLInputElement;
    const control = view.container.querySelector<HTMLElement>('.file-name-control')!;
    const suffix = view.container.querySelector<HTMLElement>('.file-name-suffix')!;
    expect(getComputedStyle(control).width).toBe('100%');
    expect(getComputedStyle(control).minWidth).toBe('0px');
    expect(getComputedStyle(input).minWidth).toBe('0px');
    expect(getComputedStyle(input).flexGrow).toBe('1');
    expect(getComputedStyle(suffix).flexShrink).toBe('0');
    expect(suffix.textContent).toBe('.png');
    expect(input.value).toHaveLength(200);
    expect(input.title).toBe(stem + '.png');
    expect(input.selectionEnd).toBe(200);
    expect(input.scrollLeft).toBe(1600);
  },
);

it('reports invalid or empty names under the field and preserves ordinary stem edits', () => {
  const onChange = vi.fn();
  const view = render(
    <FileNameField value="" extension="png" folder={folder} onChange={onChange} />,
  );
  expect(screen.getByRole('alert').textContent).toBe('Enter a file name.');
  view.rerender(
    <FileNameField value="bad/name" extension="png" folder={folder} onChange={onChange} />,
  );
  const input = screen.getByRole('textbox');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  const message = screen.getByRole('alert');
  expect(message.textContent).toBe("A file name can't contain “/”.");
  expect(message.parentElement).toBe(input.closest('.dialog-field'));
  expect(getComputedStyle(message).position).not.toBe('absolute');
  fireEvent.change(input, { target: { value: 'report.v2' } });
  expect(onChange).toHaveBeenCalledWith('report.v2');
});

it('drops a typed extension that the suffix already shows once the field loses focus', () => {
  const onChange = vi.fn();
  render(<FileNameField value="report.PNG" extension="png" folder={folder} onChange={onChange} />);
  fireEvent.blur(screen.getByRole('textbox'));
  expect(onChange).toHaveBeenCalledWith('report');
});

it('says what export does with a name that exists, without blocking export', async () => {
  vi.mocked(window.viewer.stat).mockResolvedValue(file);
  render(<FileNameField value="report" extension="png" folder={folder} onChange={vi.fn()} />);
  const message = await screen.findByText(
    'A file named “report.png” is already here. Export adds “copy” to the new name.',
  );
  const input = screen.getByRole('textbox');
  expect(input.getAttribute('aria-invalid')).toBe('false');
  expect(input.getAttribute('aria-describedby')).toBe(message.id);
  expect(window.viewer.stat).toHaveBeenCalledWith(folder + '/report.png');
});

it('ignores an existence check that belongs to a previous name or folder', async () => {
  let resolve!: (entry: FileEntry) => void;
  vi.mocked(window.viewer.stat).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(
    <FileNameField value="old" extension="png" folder={folder} onChange={vi.fn()} />,
  );
  view.rerender(<FileNameField value="new" extension="png" folder={home} onChange={vi.fn()} />);
  await act(async () => resolve(file));
  expect(screen.queryByText(/A file with this name exists/)).toBeNull();
});

it('shows a newer name without the answer about the last one while its check runs', async () => {
  let resolve!: (entry: FileEntry) => void;
  vi.mocked(window.viewer.stat)
    .mockResolvedValueOnce(file)
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  const view = render(
    <FileNameField value="report" extension="png" folder={folder} onChange={vi.fn()} />,
  );
  await screen.findByText(/is already here/);
  view.rerender(
    <FileNameField value="report 2" extension="png" folder={folder} onChange={vi.fn()} />,
  );
  expect(screen.queryByText(/is already here/)).toBeNull();
  await act(async () => resolve({ ...file, directory: true }));
  expect(
    screen.getByText(
      'A folder named “report 2.png” is already here. Export adds “copy” to the new name.',
    ),
  ).toBeTruthy();
});

it('checks the first numbered name and counts its number in the 255 limit', async () => {
  const view = render(
    <FileNameField
      value={'a'.repeat(250)}
      extension="pdf"
      folder={folder}
      numberedSuffix=" 001"
      onChange={vi.fn()}
    />,
  );
  // 250 + " 001" + ".pdf" = 258 code units: over the limit, so nothing is checked
  expect(screen.getByRole('alert').textContent).toBe('Keep the file name within 255 characters.');
  expect(window.viewer.stat).not.toHaveBeenCalled();
  view.rerender(
    <FileNameField
      value={'a'.repeat(247)}
      extension="pdf"
      folder={folder}
      numberedSuffix=" 001"
      onChange={vi.fn()}
    />,
  );
  // exactly 255
  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() =>
    expect(window.viewer.stat).toHaveBeenCalledWith(folder + '/' + 'a'.repeat(247) + ' 001.pdf'),
  );
  expect(fileNameError('a'.repeat(251), 'png')).toBe('');
  expect(fileNameError('a'.repeat(252), 'png')).toBe('Keep the file name within 255 characters.');
});

it.each([
  ['.', 'Enter a name other than “.” or “..”.'],
  ['..', 'Enter a name other than “.” or “..”.'],
  ['.secret', 'A name that starts with “.” makes a hidden file. Remove the dot.'],
  ['line\nbreak', 'Remove the invisible control character from the name.'],
  ['tab\there', 'Remove the invisible control character from the name.'],
  ['nul\0here', 'Remove the invisible control character from the name.'],
  ['photo\u202egnp', 'Remove the invisible control character from the name.'],
  ['   ', 'Enter a file name.'],
])('refuses %j with a reason', (stem, message) => {
  expect(fileNameError(stem, 'png')).toBe(message);
});

it('refuses the Windows-only characters on Windows only', () => {
  expect(fileNameError('a:b', 'png')).toBe('');
  initialize({ home, platform: 'win32', state: null, locations: [], openPaths: [] });
  expect(fileNameError('a:b', 'png')).toBe(
    'On Windows, a file name can\'t contain < > : " \\ | ? *.',
  );
  expect(fileNameError('.secret', 'png')).toBe('');
});

it.each([
  ['photo.jpeg', 'jpg', 'photo'],
  ['photo.JPG', 'jpg', 'photo'],
  ['scan.tiff', 'tif', 'scan'],
  ['  photo  ', 'png', 'photo'],
  ['report.pdf.png', 'png', 'report.pdf'],
])('cleans %j for the .%s suffix once the field loses focus', (value, extension, stem) => {
  const onChange = vi.fn();
  render(<FileNameField value={value} extension={extension} folder={folder} onChange={onChange} />);
  fireEvent.blur(screen.getByRole('textbox'));
  expect(onChange).toHaveBeenCalledWith(stem);
});

it('keeps a stem that is only the suffix rather than emptying it', () => {
  const onChange = vi.fn();
  render(<FileNameField value=".png" extension="png" folder={folder} onChange={onChange} />);
  fireEvent.blur(screen.getByRole('textbox'));
  expect(onChange).not.toHaveBeenCalled();
});

it('opens a long name at its end once its dialog opens', async () => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1600);
  const dialog = document.createElement('dialog');
  document.body.append(dialog);
  render(<FileNameField value={stem} extension="png" folder={folder} onChange={vi.fn()} />, {
    container: dialog,
  });
  const input = screen.getByRole('textbox') as HTMLInputElement;
  input.scrollLeft = 0;
  input.setSelectionRange(0, 0);
  dialog.setAttribute('open', '');
  await act(async () => {});
  expect(input.selectionStart).toBe(stem.length);
  expect(input.scrollLeft).toBe(1600);
  dialog.remove();
});

it('names its field by the label it shows', () => {
  render(<FileNameField value="report" extension="png" folder={folder} onChange={vi.fn()} />);
  expect(screen.getByRole('textbox', { name: 'File name: report.png' })).toBeTruthy();
});

it('shows a root folder once, home by its name and ~, and chooser errors with ~', async () => {
  vi.mocked(window.viewer.chooseFolder).mockRejectedValue(
    new Error(`Viewer can't read ${home}/Private.`),
  );
  const view = render(<DestinationField path="/" onChange={vi.fn()} />);
  expect(view.container.querySelector('.destination-name')!.textContent).toBe('/');
  expect(view.container.querySelector('.destination-path')).toBeNull();
  view.rerender(<DestinationField path={home} onChange={vi.fn()} />);
  expect(view.container.querySelector('.destination-name')!.textContent).toBe('fixture');
  expect(view.container.querySelector('.destination-path .path-label-text')!.textContent).toBe('~');
  fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
  expect((await screen.findByRole('alert')).textContent).toBe("Viewer can't read ~/Private.");
});

it('uses the home marker and keeps deep paths and folder choices complete', async () => {
  const onChange = vi.fn();
  const view = render(<DestinationField path={folder} onChange={onChange} />);
  const location = screen.getByTitle(folder);
  expect(location.getAttribute('aria-label')).toBe('Save in: ' + folder);
  expect(location.querySelector('svg')).toBeTruthy();
  expect(location.querySelector('.destination-name')?.textContent).toBe('3D');
  expect(location.querySelector('.destination-path .path-label-text')?.textContent).toBe(
    '~/…/oferta-de-pret-snecuri-automata-4-7/3D',
  );
  expect(location.querySelector('.destination-path .path-label-whole')?.textContent).toBe(folder);
  expect(
    getComputedStyle(view.container.querySelector('.destination-field')!).gridTemplateColumns,
  ).toBe('minmax(0, 1fr) auto');
  fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(home));
  expect(window.viewer.chooseFolder).toHaveBeenCalledWith(folder);
  view.rerender(<DestinationField path={home + '/'} onChange={onChange} />);
  expect(screen.getByText('~')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy folder path' }));
  await waitFor(() => expect(window.viewer.copyPaths).toHaveBeenCalledWith([home + '/']));
});

it('says what an unchosen folder means and keeps Choose… beside it', () => {
  const empty = 'Not chosen. Planes in this folder stay closed.';
  render(<DestinationField path="" empty={empty} onChange={vi.fn()} />);
  expect(screen.getByText(empty)).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Save in: ' + empty })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Copy folder path' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Choose…' })).toBeTruthy();
});

it('keeps a path outside home shortened from the left and reports chooser errors inline', async () => {
  vi.mocked(window.viewer.chooseFolder).mockRejectedValue(new Error('Folder access was refused.'));
  const external = folder.replace(home, '/Volumes/Shared');
  render(<DestinationField path={external} onChange={vi.fn()} />);
  // outside home the label starts at the root
  expect(screen.getByText('/…/oferta-de-pret-snecuri-automata-4-7/3D')).toBeTruthy();
  expect(screen.getByTitle(external).getAttribute('aria-label')).toBe('Save in: ' + external);
  fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
  const error = await screen.findByRole('alert');
  expect(error.textContent).toBe('Folder access was refused.');
  expect(error.closest('.dialog-field')).toBeTruthy();
});

it('uses the chosen image format suffix without losing dots in the edited stem', async () => {
  render(<ImageToolsDialog files={[file]} onClose={vi.fn()} />);
  await screen.findByText('2400 × 900 px, transparent');
  fireEvent.change(screen.getByRole('textbox', { name: /^File name:/ }), {
    target: { value: 'report.v2' },
  });
  await choose('Image output format', 'PNG');
  expect(screen.getByRole('textbox', { name: 'File name: report.v2.png' })).toBeTruthy();
  expect(screen.getByText('Exports 2400 × 900 px PNG')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Export Image' }));
  await waitFor(() =>
    expect(window.viewer.operate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'report.v2.png', destination: folder }),
    ),
  );
});

it('explains a skipped enlargement only when the target would enlarge the image', async () => {
  render(<ImageToolsDialog files={[file]} onClose={vi.fn()} />);
  await screen.findByText('2400 × 900 px, transparent');
  expect(screen.queryByText(/Already smaller/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Output width'), { target: { value: '4800' } });
  expect(screen.getByText('Already smaller than the target; keeps 2400 × 900.')).toBeTruthy();
  expect(screen.getByText('Exports 2400 × 900 px WebP')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Output width'), { target: { value: '1200' } });
  expect(screen.queryByText(/Already smaller/)).toBeNull();
  expect(screen.getByText('Exports 1200 × 450 px WebP')).toBeTruthy();
});

it('shows dimensions for rotation, crop, fill and stretch', async () => {
  render(<ImageToolsDialog files={[file]} onClose={vi.fn()} />);
  await screen.findByText('Exports 2400 × 900 px WebP');
  fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
  expect(screen.getByText('Exports 900 × 2400 px WebP')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Crop$/ }));
  fireEvent.change(screen.getByLabelText('Crop width'), { target: { value: '800' } });
  fireEvent.change(screen.getByLabelText('Crop height'), { target: { value: '600' } });
  expect(screen.getByText('Exports 800 × 600 px WebP')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Output width'), { target: { value: '400' } });
  fireEvent.change(screen.getByLabelText('Output height'), { target: { value: '400' } });
  expect(screen.getByText('Exports 400 × 300 px WebP')).toBeTruthy();
  await choose('Image resize fit', 'Fill and crop');
  expect(screen.getByText('Exports 400 × 400 px WebP')).toBeTruthy();
  await choose('Image resize fit', 'Stretch to size');
  expect(screen.getByText('Exports 400 × 400 px WebP')).toBeTruthy();
});

type ExportSurface =
  'image' | 'pdf' | 'optimize' | 'media' | 'project' | 'parameters' | 'destination';
const surfaces: ExportSurface[] = [
  'image',
  'pdf',
  'optimize',
  'media',
  'project',
  'parameters',
  'destination',
];

it.each(surfaces)(
  'uses the shared label layout in %s with a long name and deep folder at minimum window width',
  async (surface) => {
    vi.stubGlobal('innerWidth', 780);
    let view: ReturnType<typeof render>;
    switch (surface) {
      case 'image':
        view = render(<ImageToolsDialog files={[file]} onClose={vi.fn()} />);
        await screen.findByText('2400 × 900 px, transparent');
        break;
      case 'pdf':
        view = render(
          <PDFToolsDialog
            files={[{ ...file, extension: 'pdf', name: stem + '.pdf' }]}
            onClose={vi.fn()}
          />,
        );
        await waitFor(() =>
          expect(screen.getByRole('button', { name: 'Save PDF' }).hasAttribute('disabled')).toBe(
            false,
          ),
        );
        break;
      case 'optimize':
        view = render(<OptimizeDialog files={[file]} onClose={vi.fn()} />);
        fireEvent.click(screen.getByText('Quality and dimensions'));
        break;
      case 'media':
        view = render(
          <MediaPlane
            pane={{
              id: 'media',
              type: 'media',
              path: folder + '/' + stem + '.mp4',
              draftID: draft.id,
            }}
            active={false}
          />,
        );
        await screen.findByRole('textbox', { name: /^File name:/ });
        break;
      case 'project':
        associateProject({
          file: home + '/Example.viewer',
          root: home,
          revision: 'revision',
          dirty: false,
          folders: {},
          bindings: { external: folder },
          definition: {
            version: 1,
            id: crypto.randomUUID(),
            name: 'Example',
            bindings: [{ name: 'external', label: 'Output folder' }],
            planes: [],
            folders: [],
            layout: { placements: [] },
            arrangements: {},
          },
        });
        view = render(<ProjectControls />);
        act(() => requestProject('bindings'));
        break;
      case 'parameters':
        view = render(<ActionParameters />);
        act(() => {
          void requestParameters('Export command', [
            {
              name: 'file',
              label: 'File name',
              kind: 'text',
              required: true,
              initial: stem + '.png',
            },
            { name: 'folder', label: 'Save in', kind: 'text', required: true, initial: folder },
            { name: 'quality', label: 'Quality', kind: 'number', required: true, initial: '80' },
            {
              name: 'format',
              label: 'Format',
              kind: 'choice',
              required: true,
              choices: ['PNG', 'JPEG'],
              initial: 'PNG',
            },
            { name: 'metadata', label: 'Keep metadata', kind: 'boolean', required: false },
          ]);
        });
        break;
      case 'destination':
        view = render(
          <DestinationDialog
            kind="copy"
            context={{
              scope: 'files',
              workspaceID: activeWorkspace().id,
              selection: [file],
              directory: folder,
              clipboard: null,
              jobs: [],
            }}
            onClose={vi.fn()}
          />,
        );
        break;
    }
    assertStackedFields(view.container);
    for (const sentence of removedSentences)
      expect(document.body.textContent).not.toMatch(sentence);
    if (surface === 'parameters') {
      // a checkbox keeps its text beside it
      const toggle = screen.getByRole('checkbox', { name: 'Keep metadata' }).closest('label')!;
      expect(toggle.classList.contains('dialog-field-toggle')).toBe(true);
      expect(getComputedStyle(toggle).display).toBe('flex');
      expect(getComputedStyle(toggle).flexDirection).not.toBe('column');
      expect(getComputedStyle(screen.getByLabelText('Quality')).width).toBe('110px');
      expect(getComputedStyle(screen.getByLabelText('File name')).width).toBe('100%');
    } else {
      expect(screen.getByText('~/…/oferta-de-pret-snecuri-automata-4-7/3D')).toBeTruthy();
      expect(screen.getByTitle(folder).getAttribute('aria-label')).toContain(folder);
    }
  },
);

it('keeps media stems while switching audio formats and PNG frame export', async () => {
  render(
    <MediaPlane
      pane={{ id: 'media', type: 'media', path: folder + '/source.mp4', draftID: draft.id }}
      active={false}
    />,
  );
  const input = await screen.findByRole('textbox', { name: /^File name:/ });
  fireEvent.change(input, { target: { value: stem } });
  await choose('Export format', 'AAC audio');
  expect(screen.getByRole('textbox', { name: 'File name: ' + stem + '.m4a' })).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Export current frame as PNG'));
  expect(screen.getByRole('textbox', { name: 'File name: ' + stem + '.png' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Export Frame' }));
  await waitFor(() =>
    expect(window.viewer.media).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'export',
        name: stem + '.png',
        destination: folder,
        frame: expect.objectContaining({ format: 'png' }),
      }),
    ),
  );
  expect(screen.queryByText(/copy streams|re-encoding/)).toBeNull();
});

it('says what a fast cut does only once it is chosen', async () => {
  render(
    <MediaPlane
      pane={{ id: 'media', type: 'media', path: folder + '/source.mp4', draftID: draft.id }}
      active={false}
    />,
  );
  await screen.findByRole('textbox', { name: /^File name:/ });
  expect(screen.queryByText(/Fast cuts/)).toBeNull();
  await choose('Cut accuracy', 'Fast');
  expect(await screen.findByText('Fast cuts can start a few seconds early.')).toBeTruthy();
});
