// @vitest-environment jsdom
/**
 * CHECK LASER JOB…: offered only where there are parts to cut, from the listing a plane shows or a
 * probe of a folder no plane shows, and saying what its check compares there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, FileKind } from '../src/domain/contracts';
import type { CommandContext } from '../src/renderer/commands/registry';
import type * as Check from '../src/renderer/fabrication/check';
import { checkCommands } from '../src/renderer/fabrication/commands';
import { openCheck } from '../src/renderer/fabrication/check';
import { subscribeJobContents } from '../src/renderer/fabrication/contents';

const { shown } = vi.hoisted(() => ({ shown: new Map<string, FileEntry[]>() }));
vi.mock('../src/renderer/explorer/useFolder', () => ({
  shownEntries: (path: string) => shown.get(path),
}));
vi.mock('../src/renderer/fabrication/check', async (original) => ({
  ...(await original<typeof Check>()),
  openCheck: vi.fn(),
}));

const entry = (folder: string, name: string, kind: FileKind = 'file', modified = 1): FileEntry => ({
  path: `${folder}/${name}`,
  parent: folder,
  name,
  extension: name.includes('.') ? name.split('.').pop()!.toLowerCase() : '',
  kind,
  directory: kind === 'directory',
  size: 1000,
  modified,
  created: 1,
  hidden: false,
  mime: '',
  identity: `${folder}/${name}`,
});
const files = (folder: string, names: readonly string[]) =>
  names.map((name) => entry(folder, name));
const parts = (count: number) =>
  Array.from({ length: count }, (_, index) => `g6-PL6${index}-B2-2buc.dxf`);
const context = (directory: string, selection: FileEntry[] = []): CommandContext => ({
  scope: selection.length ? 'files' : 'folder',
  workspaceID: 'workspace',
  paneID: 'plane',
  directory,
  selection,
  clipboard: null,
  jobs: [],
});
const [command] = checkCommands() as [ReturnType<typeof checkCommands>[number]];
const detail = (at: CommandContext) =>
  typeof command.detail === 'function' ? command.detail(at) : command.detail;
const unavailable = (at: CommandContext) =>
  typeof command.unavailable === 'function' ? command.unavailable(at) : command.unavailable;
/** Asks until every folder the check would read is counted; the probes answer one at a time. */
async function counted(at: CommandContext): Promise<void> {
  await vi.waitFor(() => {
    if (!command.when(at))
      expect(unavailable(at)).not.toBe('Viewer is still counting the files here.');
  });
}

let listings: Map<string, FileEntry[]>;
let list: ReturnType<typeof vi.fn>;
beforeEach(() => {
  shown.clear();
  listings = new Map();
  list = vi.fn(async (folder: string) => {
    const entries = listings.get(folder);
    if (!entries) throw Object.assign(new Error('No such folder.'), { code: 'ENOENT' });
    return { path: folder, parent: folder.replace(/\/[^/]+$/, ''), entries };
  });
  vi.stubGlobal('viewer', { list });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Check laser job…', () => {
  it('is not offered in a photo folder, or in one of albums', async () => {
    shown.set('/Pictures', files('/Pictures', ['Beach.jpg', 'Sea.png', 'Notes.txt']));
    expect(command.when(context('/Pictures'))).toBe(false);
    expect(unavailable(context('/Pictures'))).toBe('Pictures holds no DXF or DWG file.');
    expect(list).not.toHaveBeenCalled();

    shown.set('/Photos', [
      ...files('/Photos', ['Cover.jpg']),
      entry('/Photos', 'Summer', 'directory'),
      entry('/Photos', 'Winter', 'directory'),
    ]);
    listings.set('/Photos/Summer', files('/Photos/Summer', ['Sun.jpg', 'Sand.heic']));
    listings.set('/Photos/Winter', files('/Photos/Winter', ['Snow.jpg']));
    await counted(context('/Photos'));
    expect(command.when(context('/Photos'))).toBe(false);
    expect(unavailable(context('/Photos'))).toBe('Photos holds no DXF or DWG file.');
  });

  it('offers a job folder, naming what its check compares', () => {
    const job = '/Jobs/Job 1042';
    shown.set(
      job,
      files(job, ['Job 1042 request.eml', 'Job 1042 drawing.pdf', 'Notes.json', ...parts(5)]),
    );
    expect(command.when(context(job))).toBe(true);
    expect(detail(context(job))).toBe(
      'Compare Job 1042’s request email and 1 drawing with its 5 DXF parts',
    );
    shown.set(job, files(job, ['Job 1042 request.eml', 'Plate.jpg', 'Edge.jpg', ...parts(1)]));
    expect(detail(context(job))).toBe(
      'Compare Job 1042’s request email and 2 photos with its DXF part',
    );

    const bare = '/Jobs/Parts';
    shown.set(bare, files(bare, parts(5)));
    expect(detail(context(bare))).toBe(
      '5 DXF parts in Parts, with no request or drawing: checks names and measurements only',
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('offers a selection holding a DXF or DWG file, and says what a DWG needs', async () => {
    const folder = '/Jobs/Job 1042';
    shown.set(folder, files(folder, ['Holiday.jpg']));
    const job = files(folder, ['Job 1042 request.eml', 'Job 1042 drawing.pdf', ...parts(2)]);
    expect(command.when(context(folder, job))).toBe(true);
    expect(detail(context(folder, job))).toBe(
      'Compare the selected request email and 1 drawing with 2 DXF parts',
    );
    const one = files(folder, parts(1));
    expect(detail(context(folder, one))).toBe(
      '1 DXF part selected, with no request or drawing: checks names and measurements only',
    );
    const dwg = files(folder, ['Bracket.dwg', 'Plate.DWG']);
    expect(command.when(context(folder, dwg))).toBe(true);
    expect(detail(context(folder, dwg))).toBe(
      '2 DWG files selected and no DXF: save them as DXF to check them',
    );
    expect(command.when(context(folder, files(folder, ['Holiday.jpg'])))).toBe(false);
    expect(unavailable(context(folder, files(folder, ['Holiday.jpg'])))).toBe(
      'The selection holds no DXF or DWG file.',
    );
    await command.run(context(folder, job));
    expect(openCheck).toHaveBeenCalledWith(
      job.map((item) => item.path),
      'workspace',
      'plane',
      undefined,
    );
  });

  it('offers a job folder whose parts are in a DXF folder, once that folder is counted', async () => {
    const job = '/Jobs/Job 2001';
    shown.set(job, [
      ...files(job, ['Job 2001 request.eml', 'Job 2001 drawing.pdf']),
      entry(job, 'DXF', 'directory', 5),
      entry(job, 'Job 2001 handoff', 'directory', 5),
    ]);
    listings.set(`${job}/DXF`, files(`${job}/DXF`, parts(5)));
    const told = vi.fn();
    const stop = subscribeJobContents(told);
    // the palette is not kept waiting: it hears once the folder is counted
    expect(command.when(context(job))).toBe(false);
    await vi.waitFor(() => expect(told).toHaveBeenCalled());
    stop();
    expect(command.when(context(job))).toBe(true);
    expect(detail(context(job))).toBe(
      'Compare Job 2001’s request email and 1 drawing with its 5 DXF parts in DXF',
    );
    // counted once: a handoff a check saved is not read, and the count is kept
    expect(list.mock.calls.map(([path]) => path)).toEqual([`${job}/DXF`]);
  });

  it('probes a selected folder no plane shows, and says no more than its parts', async () => {
    const folder = '/Jobs/Job 1043';
    const selected = entry('/Jobs', 'Job 1043', 'directory', 7);
    shown.set('/Jobs', [selected]);
    listings.set(folder, files(folder, ['Job 1043 request.eml', ...parts(3)]));
    await counted(context('/Jobs', [selected]));
    expect(command.when(context('/Jobs', [selected]))).toBe(true);
    expect(detail(context('/Jobs', [selected]))).toBe('Check the 3 DXF parts in Job 1043');
    await command.run(context('/Jobs', [selected]));
    expect(openCheck).toHaveBeenCalledWith([folder], 'workspace', 'plane', undefined);
    expect(list).toHaveBeenCalledTimes(1);

    // a file added changes the folder's date: it is counted again
    listings.set(folder, files(folder, ['Job 1043 request.eml']));
    const changed = { ...selected, modified: 8 };
    await counted(context('/Jobs', [changed]));
    expect(command.when(context('/Jobs', [changed]))).toBe(false);
    expect(unavailable(context('/Jobs', [changed]))).toBe('Job 1043 holds no DXF or DWG file.');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('is not offered for a folder of jobs, and says why', async () => {
    const clients = '/Clients';
    shown.set(clients, [
      entry(clients, 'Job A', 'directory'),
      entry(clients, 'Job B', 'directory'),
    ]);
    listings.set(`${clients}/Job A`, files(`${clients}/Job A`, ['Job A.eml', ...parts(2)]));
    listings.set(`${clients}/Job B`, files(`${clients}/Job B`, ['Job B.eml', ...parts(1)]));
    await counted(context(clients));
    expect(command.when(context(clients))).toBe(false);
    expect(unavailable(context(clients))).toBe(
      'Clients holds Job A and Job B: select one to check it.',
    );
  });

  it('keeps a job and a folder of parts beside it apart', async () => {
    // the playground's "fabrication": Job 1042 with its request, and the Evaluation parts
    const fabrication = '/fabrication';
    shown.set(fabrication, [
      entry(fabrication, 'Evaluation', 'directory'),
      entry(fabrication, 'Job 1042', 'directory'),
    ]);
    listings.set(`${fabrication}/Evaluation`, files(`${fabrication}/Evaluation`, parts(40)));
    listings.set(
      `${fabrication}/Job 1042`,
      files(`${fabrication}/Job 1042`, ['Job 1042 request.eml', ...parts(5)]),
    );
    await counted(context(fabrication));
    expect(command.when(context(fabrication))).toBe(false);
    expect(unavailable(context(fabrication))).toBe(
      'fabrication holds Job 1042 and Evaluation: select one to check it.',
    );
  });
});
