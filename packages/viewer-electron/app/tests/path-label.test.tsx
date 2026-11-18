// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import type { ReactNode } from 'react';
import type { DesktopEvent, ViewerAPI } from '../src/domain/contracts';
import type { RemoteConnectionSnapshot } from '../src/domain/remote/contracts';
import { PathHome, PathLabel } from '../src/renderer/ui/PathLabel';
import { PathField } from '../src/renderer/ui/primitives';
import { DestinationField } from '../src/renderer/ui/DestinationField';
import { characterWidth, largeFont, measurePathLabels } from './support/path-label-room';
import type { PathLabelRoom } from './support/path-label-room';

const home = '/Users/fixture';
const deep =
  home +
  '/Library/CloudStorage/' +
  Array.from({ length: 18 }, (_, index) => `level-${index}`).join('/') +
  '/Programs/viewer';
const copyPaths = vi.fn<ViewerAPI['copyPaths']>(async () => {});
const writeText = vi.fn<ViewerAPI['clipboardWriteText']>(async () => {});
let room: PathLabelRoom;
let stylesheet: HTMLStyleElement;
let resizeLabels: (entries: { target: Element }[]) => void;
let observed: Element[];

beforeEach(() => {
  observed = [];
  window.viewer = { copyPaths, clipboardWriteText: writeText } as unknown as ViewerAPI;
  stylesheet = document.createElement('style');
  stylesheet.textContent = ['styles/base.css', 'ui/path-label.css']
    .map((path) => readFileSync(new URL('../src/renderer/' + path, import.meta.url), 'utf8'))
    .join('\n');
  document.head.append(stylesheet);
  room = measurePathLabels(280);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: (entries: { target: Element }[]) => void) {
        resizeLabels = callback;
      }
      observe(element: Element) {
        observed.push(element);
      }
      unobserve(element: Element) {
        observed = observed.filter((item) => item !== element);
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  room.remove();
  stylesheet.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const atHome = (children: ReactNode) => (
  <PathHome.Provider value={home}>{children}</PathHome.Provider>
);
const shown = (container: HTMLElement) =>
  container.querySelector('.path-label-text')!.textContent ?? '';
const resize = (width: number) => {
  room.resize(width);
  act(() => resizeLabels(observed.map((target) => ({ target }))));
};

it('shows home as ~ and drops names from the start so the folder name stays', () => {
  const view = render(atHome(<PathLabel path={deep} />));
  expect(shown(view.container)).toBe('~/…/level-16/level-17/Programs/viewer');
  expect(shown(view.container).length * characterWidth).toBeLessThanOrEqual(280);
  const label = view.container.querySelector('.path-label')!;
  expect(label.getAttribute('title')).toBe(deep);
  // the accessible text is the whole path; the shortened one is only for the eye
  expect(label.querySelector('.path-label-text')!.getAttribute('aria-hidden')).toBe('true');
  expect(label.querySelector('.path-label-whole')!.textContent).toBe(deep);
});

it('watches its own element and refits when its room changes', () => {
  const view = render(atHome(<PathLabel path={deep} />));
  const label = view.container.querySelector('.path-label')!;
  expect(observed).toContain(label);
  resize(2000);
  expect(shown(view.container)).toBe(deep.replace(home, '~'));
  resize(120);
  expect(shown(view.container)).toBe('~/…/viewer');
  view.unmount();
  expect(observed).not.toContain(label);
});

it('fits a new path at once and keeps the whole path without room', () => {
  const view = render(atHome(<PathLabel path={deep} />));
  view.rerender(atHome(<PathLabel path={home + '/Jobs/Job 1042/drawing.dxf'} />));
  expect(shown(view.container)).toBe('~/Jobs/Job 1042/drawing.dxf');
  view.rerender(atHome(<PathLabel path={deep + '/more/names/than/fit/here.txt'} />));
  expect(shown(view.container).startsWith('~/…/')).toBe(true);
  expect(shown(view.container).endsWith('/here.txt')).toBe(true);
  room.resize(0);
  view.rerender(atHome(<PathLabel path={deep + '/other.txt'} />));
  expect(shown(view.container)).toBe(deep.replace(home, '~') + '/other.txt');
});

it('keeps the extension of a name too long for the row, losing its middle', () => {
  room.resize(140);
  const file = home + '/Jobs/' + 'oferta-de-pret-snecuri-automata-4-7-'.repeat(4) + 'final.pdf';
  const view = render(atHome(<PathLabel path={file} />));
  const text = shown(view.container);
  expect(text.startsWith('~/…/')).toBe(true);
  expect(text.endsWith('.pdf')).toBe(true);
  expect(text.slice(4)).toContain('…');
  expect(text.length * characterWidth).toBeLessThanOrEqual(140);
});

it('keeps the start of a folder name whose dot is not an extension', () => {
  room.resize(30 * characterWidth);
  const name = 'Release 1.0 notes for the whole team and the customers';
  const view = render(atHome(<PathLabel path={home + '/Jobs/' + name} />));
  const text = shown(view.container);
  expect(text.length).toBeLessThanOrEqual(30);
  expect(text).toContain('Release');
});

it('starts a path outside home at its root, Windows paths included', () => {
  const view = render(atHome(<PathLabel path={deep.replace(home, '/Volumes/Shared')} />));
  expect(shown(view.container)).toBe('/…/level-16/level-17/Programs/viewer');
  view.rerender(
    <PathHome.Provider value={'C:\\Users\\fixture'}>
      <PathLabel path={'C:\\Users\\fixture\\Documents\\Job 1042\\drawing.dxf'} />
    </PathHome.Provider>,
  );
  expect(shown(view.container)).toBe('~\\Documents\\Job 1042\\drawing.dxf');
});

it('wraps the whole path with home as ~ in the wrapping layout', () => {
  room.resize(40);
  const view = render(atHome(<PathLabel path={deep} layout="wrap" />));
  expect(shown(view.container)).toBe(deep.replace(home, '~'));
  expect(observed).toHaveLength(0);
});

it('copies the whole path when its text is copied', () => {
  const view = render(atHome(<PathLabel path={deep} />));
  const label = view.container.querySelector<HTMLElement>('.path-label')!;
  window.getSelection()!.selectAllChildren(label);
  const setData = vi.fn();
  fireEvent.copy(label, { clipboardData: { setData } });
  expect(setData).toHaveBeenCalledWith('text/plain', deep);
});

it.each(['starts', 'ends'] as const)(
  'leaves a copy alone when the selection %s outside the label',
  (where) => {
    const view = render(
      atHome(
        <p>
          Before <PathLabel path={deep} /> after
        </p>,
      ),
    );
    const paragraph = view.container.querySelector('p')!;
    const inside = view.container.querySelector('.path-label-text')!.firstChild!;
    const outside = where === 'starts' ? paragraph.firstChild! : paragraph.lastChild!;
    const selection = window.getSelection()!;
    if (where === 'starts') selection.setBaseAndExtent(outside, 0, inside, 2);
    else selection.setBaseAndExtent(inside, 0, outside, 2);
    const setData = vi.fn();
    fireEvent.copy(view.container.querySelector('.path-label')!, { clipboardData: { setData } });
    expect(setData).not.toHaveBeenCalled();
  },
);

it('keeps the whole path out of a selection that spans the label', () => {
  render(atHome(<PathLabel path={deep} />));
  // The accessible whole path is not selectable, so a wider copy pastes what shows, once.
  const whole = document.querySelector<HTMLElement>('.path-label-whole')!;
  expect(stylesheet.textContent).toMatch(
    /\.path-label > \.path-label-whole \{\s*user-select: none;/,
  );
  expect(whole.closest('.path-label')).toBeTruthy();
});

it('gives the palette footer a one-line path field whose button copies the whole path', async () => {
  render(atHome(<PathField path={deep} layout="line" />));
  const field = document.querySelector<HTMLElement>('.path-field .path-text')!;
  expect(field.querySelector('.path-label-text')!.textContent).toBe(
    '~/…/level-16/level-17/Programs/viewer',
  );
  expect(field.title).toBe(deep);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
  });
  expect(copyPaths).toHaveBeenCalledWith([deep]);
});

it('shows a path whole without a home folder, as before the window state exists', () => {
  room.resize(0);
  const view = render(<PathLabel path="/fixtures/Job 1042/drawing.pdf" />);
  expect(shown(view.container)).toBe('/fixtures/Job 1042/drawing.pdf');
});

it('tells copies in different folders apart from the folder they share', () => {
  room.resize(19 * characterWidth);
  const base = home + '/Clients';
  const view = render(
    atHome(
      <>
        <PathLabel path={base + '/Job 1041/3D/part.dxf'} base={base} />
        <PathLabel path={base + '/Job 1042/3D/part.dxf'} base={base} />
      </>,
    ),
  );
  const texts = [...view.container.querySelectorAll('.path-label-text')].map(
    (label) => label.textContent,
  );
  expect(texts).toEqual(['Job 1041/…/part.dxf', 'Job 1042/…/part.dxf']);
});

it('never asks for the server connections in a window that shows only local paths', () => {
  const remote = vi.fn(async () => ({ connections: [] }));
  window.viewer = { copyPaths, clipboardWriteText: writeText, remote } as unknown as ViewerAPI;
  render(atHome(<PathField path={deep} layout="line" />));
  expect(remote).not.toHaveBeenCalled();
});

it('measures each font on its own, so a larger font shortens sooner', () => {
  const style = document.createElement('style');
  style.textContent = `.large { font-size: ${largeFont}; }`;
  document.head.append(style);
  const view = render(
    atHome(
      <>
        <PathLabel path={deep} />
        <PathLabel path={deep} className="large" />
      </>,
    ),
  );
  const [normal, large] = [...view.container.querySelectorAll('.path-label-text')].map(
    (label) => label.textContent ?? '',
  );
  expect(normal).toBe('~/…/level-16/level-17/Programs/viewer');
  expect(large).toBe('~/…/Programs/viewer');
  style.remove();
});

it('refits when the interface density changes the font, with no change of room', async () => {
  const style = document.createElement('style');
  style.textContent = `[data-density='large'] .path-label { font-size: ${largeFont}; }`;
  document.head.append(style);
  const view = render(atHome(<PathLabel path={deep} />));
  expect(shown(view.container)).toBe('~/…/level-16/level-17/Programs/viewer');
  await act(async () => {
    document.body.dataset.density = 'large';
  });
  expect(shown(view.container)).toBe('~/…/Programs/viewer');
  delete document.body.dataset.density;
  style.remove();
});

it('names a server location by its server and copies what a person would type', async () => {
  let listener: (event: DesktopEvent) => void = () => {};
  const snapshot = {
    connection: { id: 'server01', name: 'Build', host: 'build', user: 'al' },
    state: 'ready',
    attempt: 0,
    since: 0,
    home: '/home/al',
  } as unknown as RemoteConnectionSnapshot;
  window.viewer = {
    copyPaths,
    clipboardWriteText: writeText,
    chooseFolder: vi.fn(async () => undefined),
    onEvent: (next: (event: DesktopEvent) => void) => {
      listener = next;
      return () => {};
    },
    remote: vi.fn(async () => ({ connections: [] })),
  } as unknown as ViewerAPI;
  const location = 'viewer-sftp://server01/home/al/Jobs/1042';
  let localRenders = 0;
  render(
    <>
      <PathField path={location} layout="line" />
      <DestinationField path={location} onChange={vi.fn()} />
      <Profiler id="local" onRender={() => localRenders++}>
        <PathLabel path={deep} />
      </Profiler>
    </>,
  );
  const field = document.querySelector<HTMLElement>('.path-field .path-text')!;
  const destination = screen.getByRole('group', { name: /^Save in:/ });
  // before the connections arrive: readable, and a copy is the location itself
  expect(field.querySelector('.path-label-text')!.textContent).toBe('server:/home/al/Jobs/1042');
  expect(field.title).toBe('server:/home/al/Jobs/1042');
  expect(destination.title).toBe('server:/home/al/Jobs/1042');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
  });
  expect(copyPaths).toHaveBeenCalledWith([location]);
  window.getSelection()!.selectAllChildren(field);
  const before = vi.fn();
  fireEvent.copy(field, { clipboardData: { setData: before } });
  expect(before).toHaveBeenCalledWith('text/plain', location);
  copyPaths.mockClear();
  const localBefore = localRenders;
  act(() => listener({ type: 'remote', connections: [snapshot] }));
  // a local path's label does not re-render for a server connection's news
  expect(localRenders).toBe(localBefore);
  expect(field.querySelector('.path-label-text')!.textContent).toBe('al@build:~/Jobs/1042');
  expect(field.title).toBe('al@build:/home/al/Jobs/1042');
  expect(field.querySelector('.path-label-whole')!.textContent).toBe('al@build:/home/al/Jobs/1042');
  expect(destination.title).toBe('al@build:/home/al/Jobs/1042');
  expect(destination.getAttribute('aria-label')).toBe('Save in: al@build:/home/al/Jobs/1042');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
  });
  expect(writeText).toHaveBeenCalledWith('al@build:/home/al/Jobs/1042');
  expect(copyPaths).not.toHaveBeenCalled();
  window.getSelection()!.selectAllChildren(field);
  const setData = vi.fn();
  fireEvent.copy(field, { clipboardData: { setData } });
  expect(setData).toHaveBeenCalledWith('text/plain', 'al@build:/home/al/Jobs/1042');
});
