// @vitest-environment jsdom
/**
 * RECORDING A TOUR: the active file plane becomes the next stop, where its preview is now; the tour
 * saves beside its files with paths relative to its folder, and never over another tour.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import type { TourDefinition, TourRequest } from '../src/domain/tours/tour';
import {
  addPane,
  initialize,
  savePreviewValue,
  setActivePane,
  updatePane,
} from '../src/renderer/state/store';
import {
  closeDraft,
  draftFile,
  editTour,
  moveStop,
  recordStop,
  saveDraft,
  tourDraft,
  updateStop,
} from '../src/renderer/workspace/tours/recorder';
import { openedTour } from '../src/renderer/workspace/tour';

const entry = (path: string): FileEntry => ({
  path,
  name: path.split('/').at(-1)!,
  parent: path.replace(/\/[^/]*$/, ''),
  extension: path.split('.').at(-1)!,
  kind: 'file',
  directory: false,
  size: 2048,
  modified: 1_761_800_000_000,
  created: 1,
  hidden: false,
  mime: 'application/octet-stream',
  identity: '1:' + path.length,
});
const existing = new Set<string>();
const linked = new Set<string>();
const saved: TourRequest[] = [];
const hash = 'c'.repeat(64);
beforeEach(() => {
  initialize({ home: '/Jobs', platform: 'darwin', state: null, locations: [], openPaths: [] });
  existing.clear();
  linked.clear();
  saved.length = 0;
  vi.stubGlobal('viewer', {
    save: async () => {},
    stat: async (path: string) => {
      if (path.endsWith('.viewer-tour.jsonc') && !existing.has(path)) throw new Error('ENOENT');
      return entry(path);
    },
    tour: async (request: TourRequest) => {
      if (request.kind === 'stat') {
        const file = `${request.root}/${request.path}`;
        if (linked.has(file)) return { state: 'link' };
        return { state: 'found', entry: entry(file), ...(request.hash ? { sha256: hash } : {}) };
      }
      saved.push(request);
      if (request.kind !== 'save') throw new Error('Only saves are expected.');
      return {
        file: request.file,
        root: request.file.replace(/\/[^/]*$/, ''),
        revision: 'r1',
        definition: request.definition,
      };
    },
  });
});
afterEach(() => {
  closeDraft();
  vi.unstubAllGlobals();
});
function show(path: string, values: Record<string, unknown>): void {
  const pane = addPane(path, 'preview', true);
  for (const [key, value] of Object.entries(values)) savePreviewValue(pane.id, key, value);
  setActivePane(pane.id);
}

it('records each file plane where its preview is, and saves beside the files', async () => {
  editTour();
  const docked = { isDocked: () => true };
  show('/Jobs/Recca/Drawings/Bracket.pdf', { 'pdf.page': 2, 'pdf.view': 'width' });
  await recordStop(docked);
  show('/Jobs/Recca/Models/Bracket.stl', {
    'model.camera': { position: [120, 80, 60], target: [0, 0, 5] },
  });
  await recordStop({ isDocked: () => false });
  const [drawing, model] = tourDraft()!.stops;
  expect(drawing).toMatchObject({
    caption: 'Bracket.pdf, page 2',
    source: 'recorded',
    target: {
      kind: 'file',
      file: '/Jobs/Recca/Drawings/Bracket.pdf',
      version: { size: 2048, sha256: hash },
      anchor: { kind: 'pdf', page: 2, zoom: 'width' },
    },
  });
  // the pose alone: no plane ID of this workspace goes into a file that travels
  expect(drawing!.view).toEqual({ pose: 'dock' });
  expect(model).toMatchObject({
    caption: 'Bracket.stl, the recorded camera view',
    view: { pose: 'frame' },
    target: { anchor: { kind: 'model', position: [120, 80, 60], target: [0, 0, 5] } },
  });
  // unnamed, the tour takes the name of the folder that holds every stop
  expect(draftFile(tourDraft()!)).toBe('/Jobs/Recca/Recca.viewer-tour.jsonc');
  updateStop(model!.id, { caption: 'The part as it will be cut' });
  moveStop(model!.id, -1);
  const document = await saveDraft();
  const definition = (saved[0] as { definition: TourDefinition }).definition;
  expect(definition.name).toBe('Recca');
  expect(definition.stops.map((stop) => [stop.caption, stop.target])).toEqual([
    [
      'The part as it will be cut',
      expect.objectContaining({ kind: 'file', path: 'Models/Bracket.stl' }),
    ],
    [
      'Bracket.pdf, page 2',
      expect.objectContaining({ kind: 'file', path: 'Drawings/Bracket.pdf' }),
    ],
  ]);
  expect(JSON.stringify(definition)).not.toContain('/Jobs/');
  // what Present plays next, and what Edit reopens
  expect(openedTour()).toBe(document);
  expect(tourDraft()).toMatchObject({
    file: '/Jobs/Recca/Recca.viewer-tour.jsonc',
    revision: 'r1',
  });
});

it('needs a file plane, and never saves over a tour already there', async () => {
  editTour();
  await expect(recordStop({ isDocked: () => false })).rejects.toThrow('Click a file’s plane');
  show('/Jobs/Recca/photo.jpg', {});
  await recordStop({ isDocked: () => false });
  expect(tourDraft()!.stops[0]).toMatchObject({ caption: 'photo.jpg', target: { kind: 'file' } });
  expect(tourDraft()!.stops[0]!.target).not.toHaveProperty('anchor');
  existing.add('/Jobs/Recca/Recca.viewer-tour.jsonc');
  await expect(saveDraft()).rejects.toThrow(
    'A tour named “Recca” is already in “Recca”. Choose another name, or open that tour to edit it.',
  );
  expect(saved).toEqual([]);
});

it('records from a preview’s state alone, and keeps opened evidence only where there is none', async () => {
  editTour();
  const version = {
    identity: entry('/Jobs/Recca/photo.jpg').identity,
    modified: 1_761_800_000_000,
    size: 2048,
  };
  // a picture opened at a region, then shown whole again
  const photo = addPane('/Jobs/Recca/photo.jpg', 'preview', true);
  updatePane(photo.id, {
    evidence: {
      path: '/Jobs/Recca/photo.jpg',
      version,
      anchor: { kind: 'image', x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
      quote: 'the hole',
    },
  });
  savePreviewValue(photo.id, 'image.zoom', 1);
  setActivePane(photo.id);
  await recordStop({ isDocked: () => false });
  expect(tourDraft()!.stops[0]).toMatchObject({ caption: 'photo.jpg' });
  expect(tourDraft()!.stops[0]!.target).not.toHaveProperty('anchor');
  expect(tourDraft()!.stops[0]!.target).not.toHaveProperty('quote');
  // a text file has no such state: the line it was opened at stays the stop's
  const notes = addPane('/Jobs/Recca/notes.txt', 'preview', true);
  updatePane(notes.id, {
    evidence: {
      path: '/Jobs/Recca/notes.txt',
      version: { ...version, identity: entry('/Jobs/Recca/notes.txt').identity },
      anchor: { kind: 'text', line: 4, start: 30, end: 36 },
      quote: 'pitch',
    },
  });
  setActivePane(notes.id);
  await recordStop({ isDocked: () => false });
  expect(tourDraft()!.stops[1]!.target).toMatchObject({
    anchor: { kind: 'text', line: 4 },
    quote: 'pitch',
  });
});

it('refuses to save a stop reached through a link from the tour’s folder', async () => {
  editTour();
  show('/Jobs/Recca/Linked/Bracket.pdf', { 'pdf.page': 1 });
  await recordStop({ isDocked: () => false });
  linked.add('/Jobs/Recca/Linked/Bracket.pdf');
  await expect(saveDraft()).rejects.toThrow(
    'Bracket.pdf is reached through a link from “Linked”. Remove the stop, or record the tour in the folder that holds the file.',
  );
  expect(saved).toEqual([]);
});
