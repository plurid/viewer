/**
 * TOUR FILES: `<job>.viewer-tour.jsonc`, stops at files inside the tour's folder. Reading one never
 * runs anything; a stop is ready, missing or changed by its file as it is now.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Tours } from '../src/desktop/workspaces/tours';
import {
  commonFolder,
  describeAnchor,
  isTourFile,
  resolveTourPath,
  stopDwell,
  stopNotice,
  stopState,
  tourDefinitionSchema,
  tourFileName,
  tourPath,
  type TourDefinition,
  type TourStop,
} from '../src/domain/tours/tour';
import { anchorFromPreviewState, recordedCaption } from '../src/domain/tours/record';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const version = { identity: '16777232:90210', modified: 1_761_800_000_000, size: 48_213 };
const stop = (change: Partial<TourStop> = {}): TourStop => ({
  id: 'drawing',
  caption: 'The drawing asks for 48 mm between the holes',
  source: 'model',
  target: {
    kind: 'file',
    path: 'Drawings/Bracket.pdf',
    version,
    anchor: {
      kind: 'pdf',
      page: 2,
      region: [
        [0.2, 0.3],
        [0.4, 0.3],
        [0.4, 0.4],
      ],
    },
    quote: '48',
  },
  ...change,
});
const tour = (stops: TourStop[] = [stop()]): TourDefinition => ({ version: 1, name: 'Job', stops });

describe('tour definitions', () => {
  it('names tour files by their suffix', () => {
    expect(isTourFile('Job.viewer-tour.jsonc')).toBe(true);
    expect(isTourFile('.viewer-tour.jsonc')).toBe(false);
    expect(isTourFile('Job.viewer-tour.json')).toBe(false);
    expect(tourFileName('/Jobs/g6 brackets.viewer-tour.jsonc')).toBe('g6 brackets');
  });
  it('accepts stops at files in the folder and saved views, with an engine plane anchor', () => {
    const parsed = tourDefinitionSchema.parse(
      tour([
        stop({
          view: { path: '/previews/abc', pose: 'dock' },
          finding: { id: 'f1', grade: 'refuted' },
        }),
        stop({ id: 'view', target: { kind: 'view', bookmark: 'Overview' }, dwell: null }),
        stop({
          id: 'pose',
          view: {
            path: '/previews/x',
            occurrence: 1,
            pose: { yaw: 12, pitch: 0, scale: 1.5, pivot: { x: 10, y: 20, z: 0 } },
          },
        }),
        // Viewer saves the pose alone
        stop({ id: 'recorded', view: { pose: 'frame' } }),
      ]),
    );
    expect(parsed.stops).toHaveLength(4);
  });
  it('refuses a pose the engine could not place', () => {
    for (const pose of [
      { yaw: 12 },
      { yaw: 0, pitch: 0, scale: 0, pivot: { x: 0, y: 0, z: 0 } },
      { yaw: 0, pitch: 0, scale: 1, pivot: { x: 0, y: 0 } },
      { yaw: 0, pitch: 0, scale: 1, pivot: { x: 0, y: 0, z: 0 }, spin: 3 },
    ])
      expect(
        tourDefinitionSchema.safeParse(tour([stop({ view: { pose } as never })])).success,
      ).toBe(false);
  });
  it.each([['Other.viewer-tour.jsonc'], ['Jobs/viewer.project.jsonc']])(
    'refuses a stop at %s: opening it would play a tour or install a project',
    (file) => {
      const result = tourDefinitionSchema.safeParse(
        tour([stop({ target: { kind: 'file', path: file, version } })]),
      );
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain('tour or project file');
    },
  );
  it.each([
    ['../Elsewhere/Bracket.pdf'],
    ['Drawings/../../Bracket.pdf'],
    ['/Users/someone/Bracket.pdf'],
    ['C:/Jobs/Bracket.pdf'],
    ['Drawings\\Bracket.pdf'],
    ['./Bracket.pdf'],
    ['Drawings//Bracket.pdf'],
  ])('refuses the stop path %s: it must stay inside the tour’s folder', (file) => {
    const result = tourDefinitionSchema.safeParse(
      tour([stop({ target: { kind: 'file', path: file, version } })]),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('inside the tour');
  });
  it('refuses duplicate stop IDs, commands and unknown fields', () => {
    expect(tourDefinitionSchema.safeParse(tour([stop(), stop()])).success).toBe(false);
    expect(tourDefinitionSchema.safeParse({ ...tour(), run: 'open -a Calculator' }).success).toBe(
      false,
    );
    expect(
      tourDefinitionSchema.safeParse(tour([{ ...stop(), command: 'git push' } as TourStop]))
        .success,
    ).toBe(false);
  });
  it('maps stop paths to the tour’s folder and back, never outside it', () => {
    expect(resolveTourPath('/Jobs/Recca/', 'Drawings/Bracket.pdf')).toBe(
      '/Jobs/Recca/Drawings/Bracket.pdf',
    );
    expect(() => resolveTourPath('/Jobs/Recca', '../secret.pdf')).toThrow();
    expect(tourPath('/Jobs/Recca', '/Jobs/Recca/Drawings/Bracket.pdf')).toBe(
      'Drawings/Bracket.pdf',
    );
    expect(tourPath('/Jobs/Recca', '/Jobs/Other/Bracket.pdf')).toBeUndefined();
    expect(tourPath('/Jobs/Recca', '/Jobs/Recca')).toBeUndefined();
    expect(commonFolder(['/Jobs/Recca/a.dxf', '/Jobs/Recca/Drawings/b.pdf'])).toBe('/Jobs/Recca');
    expect(commonFolder(['/Jobs/Recca/a.dxf'])).toBe('/Jobs/Recca');
  });
});

describe('stop states', () => {
  it('is ready, changed or missing by the file as it is now', () => {
    expect(stopState(stop(), { file: version })).toBe('ready');
    // a copy on another computer: new identity, same size and date (to 2 s)
    expect(
      stopState(stop(), {
        file: { ...version, identity: '1:5', modified: version.modified + 1500 },
      }),
    ).toBe('ready');
    expect(stopState(stop(), { file: { ...version, size: 48_214 } })).toBe('changed');
    expect(stopState(stop(), { file: { ...version, modified: version.modified + 60_000 } })).toBe(
      'changed',
    );
    expect(stopState(stop(), {})).toBe('missing');
    // with both hashes, the bytes decide: a zip moved the date by an hour, or a tool kept it
    const hashed = (sha256: string) =>
      stop({ target: { kind: 'file', path: 'Bracket.pdf', version: { ...version, sha256 } } });
    const a = 'a'.repeat(64),
      b = 'b'.repeat(64);
    expect(
      stopState(hashed(a), {
        file: { ...version, modified: version.modified + 3_600_000, sha256: a },
      }),
    ).toBe('ready');
    expect(stopState(hashed(a), { file: { ...version, sha256: b } })).toBe('changed');
    // one side without a hash: size and date, as before
    expect(stopState(hashed(a), { file: version })).toBe('ready');
    expect(stopState(stop(), { file: { ...version, sha256: b } })).toBe('ready');
    const view = stop({ target: { kind: 'view', bookmark: 'Overview' } });
    expect(stopState(view, { views: ['Overview'] })).toBe('ready');
    expect(stopState(view, { views: ['1'] })).toBe('missing');
  });
  it('says what a changed or missing stop means for this stop', () => {
    expect(stopNotice(stop(), 'ready')).toBeUndefined();
    expect(stopNotice(stop(), 'changed')).toBe(
      'Bracket.pdf opens as it is now; this stop pointed at the outline on page 2.',
    );
    expect(stopNotice(stop(), 'denied', 'Recca')).toBe(
      'Viewer has no access to “Recca”, so it cannot show Drawings/Bracket.pdf. Allow the folder in the folder picker, then play the tour again.',
    );
    expect(stopNotice(stop(), 'link', 'Recca')).toBe(
      'Drawings/Bracket.pdf is reached through a link, and a tour shows only files stored in “Recca”. Skipping this stop.',
    );
    expect(stopNotice(stop(), 'missing', 'Recca')).toBe(
      'Drawings/Bracket.pdf is not in “Recca”. Skipping this stop.',
    );
    expect(stopNotice(stop({ target: { kind: 'view', bookmark: 'Overview' } }), 'missing')).toBe(
      'The view “Overview” is not saved in this workspace. Skipping this stop.',
    );
  });
  it('describes each kind of anchor as a reader says it', () => {
    expect(describeAnchor({ kind: 'pdf', page: 4 })).toBe('page 4');
    expect(describeAnchor({ kind: 'cells', sheet: 'Parts', row: 12, column: 28 })).toBe(
      'Parts AB12',
    );
    expect(describeAnchor({ kind: 'media', seconds: 3725 })).toBe('1:02:05');
    expect(
      describeAnchor({
        kind: 'dxf',
        entities: ['3', '4'],
        measure: [
          {
            tool: 'distance',
            points: [
              [0, 0],
              [48, 0],
            ],
          },
        ],
      }),
    ).toBe('2 highlighted entities and 1 measurement');
    expect(describeAnchor({ kind: 'model', position: [1, 1, 1], target: [0, 0, 0] })).toBe(
      'the recorded camera view',
    );
  });
  it('shows a stop long enough to read it, and never less than the Tour setting', () => {
    const timing = { dwell: 3000 };
    expect(stopDwell({ caption: 'Holes', dwell: undefined }, undefined, timing)).toBe(3000);
    expect(stopDwell({ caption: 'x'.repeat(100) }, undefined, timing)).toBe(7700);
    expect(stopDwell({ caption: 'x'.repeat(2000) }, undefined, timing)).toBe(30000);
    expect(stopDwell({ caption: 'Holes' }, 1500, timing)).toBe(1500);
    expect(stopDwell({ caption: 'Holes', dwell: null }, 1500, timing)).toBeNull();
  });
});

describe('recording a stop from a preview', () => {
  it('keeps the page and zoom of a PDF, a model camera, a media position and a chapter', () => {
    expect(anchorFromPreviewState('pdf', { 'pdf.page': 3, 'pdf.view': 1.5 })).toEqual({
      kind: 'pdf',
      page: 3,
      zoom: 1.5,
    });
    expect(anchorFromPreviewState('pdf', { 'pdf.page': 3, 'pdf.view': 'odd' })).toEqual({
      kind: 'pdf',
      page: 3,
    });
    expect(
      anchorFromPreviewState('model', {
        'model.camera': { position: [3, 2, 5], target: [0, 0, 0.5] },
      }),
    ).toEqual({ kind: 'model', position: [3, 2, 5], target: [0, 0, 0.5] });
    expect(anchorFromPreviewState('media', { 'media.position': 42 })).toEqual({
      kind: 'media',
      seconds: 42,
    });
    expect(anchorFromPreviewState('media', { 'media.position': 0.2 })).toBeUndefined();
    expect(anchorFromPreviewState('epub', { 'epub.chapter': 4 })).toEqual({
      kind: 'epub',
      chapter: 4,
    });
    expect(anchorFromPreviewState('text', { 'scroll.source': { top: 900 } })).toBeUndefined();
  });
  it('records the part of a zoomed picture in view, as it will be framed again', () => {
    const anchor = anchorFromPreviewState(
      'image',
      { 'image.zoom': 4, 'image.pan': { x: 0, y: 0 } },
      { image: { shown: { width: 800, height: 600 }, stage: { width: 800, height: 600 } } },
    );
    // a quarter of the picture is in view; the stop keeps its middle 60%, which replays at 4×
    expect(anchor).toMatchObject({ kind: 'image', x: 0.425, y: 0.425 });
    if (anchor?.kind !== 'image') throw new Error('Expected an image anchor.');
    expect(anchor.width).toBeCloseTo(0.15);
    expect(anchorFromPreviewState('image', { 'image.zoom': 1 })).toBeUndefined();
  });
  it('records the part of a drawing in view, unless it shows the whole drawing', () => {
    expect(
      anchorFromPreviewState(
        'dxf',
        { 'dxf.view': { center: { x: 50, y: 25 }, scale: 4 } },
        { drawing: { width: 400, height: 200 } },
      ),
    ).toEqual({ kind: 'dxf', entities: [], view: { min: [0, 0], max: [100, 50] } });
    expect(
      anchorFromPreviewState(
        'dxf',
        { 'dxf.view': { center: { x: 0, y: 0 }, scale: 1, fit: true } },
        { drawing: { width: 400, height: 200 } },
      ),
    ).toBeUndefined();
  });
  it('captions a new stop with its file and the place in it', () => {
    expect(recordedCaption('/Jobs/Bracket.pdf', { kind: 'pdf', page: 2 })).toBe(
      'Bracket.pdf, page 2',
    );
    expect(recordedCaption('/Jobs/photo.jpg', undefined)).toBe('photo.jpg');
  });
});

describe('the desktop tour files', () => {
  let root: string;
  const access = vi.fn(async (_files: readonly string[]) => {});
  const coordination = { run: async <T>(_intents: unknown, work: () => Promise<T>) => work() };
  beforeEach(async () => {
    root = await temporaryRoot('viewer-tours-');
  });
  afterEach(async () => {
    await trashTemporary(root);
  });
  it('saves with its comments, reads it back and checks the revision', async () => {
    const tours = new Tours(access, coordination),
      file = path.join(root, 'Job.viewer-tour.jsonc');
    const saved = await tours.save(file, '', tour());
    const text = await readFile(file, 'utf8');
    expect(text).toContain('// Viewer tour, version 1');
    expect(text).toContain('it never runs commands');
    const read = await tours.read(file);
    expect(read).toMatchObject({ root, revision: saved.revision, definition: tour() });
    await expect(tours.save(file, '', tour())).rejects.toThrow('changed on disk');
    expect(access).toHaveBeenCalledWith([file]);
  });
  it('reads only tour files, and refuses a stop outside its folder', async () => {
    const tours = new Tours(access, coordination);
    const other = path.join(root, 'Job.jsonc');
    await writeFile(other, JSON.stringify(tour()));
    await expect(tours.read(other)).rejects.toThrow('.viewer-tour.jsonc');
    const file = path.join(root, 'Escape.viewer-tour.jsonc');
    await writeFile(
      file,
      JSON.stringify(tour([stop({ target: { kind: 'file', path: '../secret.pdf', version } })])),
    );
    await expect(tours.read(file)).rejects.toThrow('inside the tour');
  });
  it('looks a stop up inside its folder, never through a link, and hashes it on request', async () => {
    const tours = new Tours(access, coordination);
    const job = path.join(root, 'Job'),
      outside = path.join(root, 'Private');
    await mkdir(path.join(job, 'Drawings'), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(job, 'Drawings', 'Bracket.pdf'), 'drawing');
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    // a folder and a file inside the job that lead out of it, and one that stays inside
    await symlink(outside, path.join(job, 'Linked'));
    await symlink(path.join(outside, 'secret.txt'), path.join(job, 'secret.txt'));
    await symlink(path.join(job, 'Drawings'), path.join(job, 'Again'));
    const found = await tours.stat(job, 'Drawings/Bracket.pdf', true);
    expect(found).toMatchObject({
      state: 'found',
      entry: { path: path.join(job, 'Drawings', 'Bracket.pdf'), kind: 'file', size: 7 },
      sha256: createHash('sha256').update('drawing').digest('hex'),
    });
    expect(await tours.stat(job, 'Drawings/Bracket.pdf')).not.toHaveProperty('sha256');
    expect(await tours.stat(job, 'Linked/secret.txt')).toEqual({ state: 'link' });
    expect(await tours.stat(job, 'secret.txt')).toEqual({ state: 'link' });
    expect(await tours.stat(job, 'Again/Bracket.pdf')).toEqual({ state: 'link' });
    expect(await tours.stat(job, 'Drawings/Gone.pdf')).toEqual({ state: 'missing' });
    expect(await tours.stat(job, 'Drawings/Bracket.pdf/inner')).toEqual({ state: 'missing' });
    // the folder itself may be reached through a link, as a synced folder is
    await symlink(job, path.join(root, 'Job link'));
    expect(await tours.stat(path.join(root, 'Job link'), 'Drawings/Bracket.pdf')).toMatchObject({
      state: 'found',
    });
    // words that leave the folder never reach the disk
    await expect(tours.stat(job, '../Private/secret.txt')).rejects.toThrow('inside the tour');
    await expect(tours.stat(job, 'Other.viewer-tour.jsonc')).rejects.toThrow(
      'tour or project file',
    );
  });
  it('says a folder Viewer may not read is denied, not missing', async () => {
    const denied = Object.assign(new Error('Allow access to this folder.'), {
      code: 'FILE_ACCESS_REQUIRED',
    });
    const tours = new Tours(async () => {
      throw denied;
    }, coordination);
    expect(await tours.stat(root, 'Bracket.pdf')).toEqual({ state: 'denied' });
  });
});
