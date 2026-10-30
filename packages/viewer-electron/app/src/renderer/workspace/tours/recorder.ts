import {
  sameSourceVersion,
  sourceVersion,
  type EvidenceAnchor,
} from '../../../domain/files/inspection';
import {
  anchorFromPreviewState,
  recordedCaption,
  stateAnchored,
  type PreviewMeasures,
} from '../../../domain/tours/record';
import {
  commonFolder,
  fileName,
  resolveTourPath,
  tourDefinitionSchema,
  tourFileName,
  tourFileSuffix,
  tourPath,
  type RecordedVersion,
  type TourDocument,
  type TourStop,
} from '../../../domain/tours/tour';
import { slugID } from '../../../domain/ids';
import { activeWorkspace, getState, previewValues } from '../../state/store';
import { choosePreview } from '../../previews/registry';
import type { WorkspaceController } from '../context';
import { rememberTour } from '../tour';
import type { PlayableTour } from './player';

/** A stop while it is edited: its file by full path, until the tour is saved beside it. */
export type DraftStop = Omit<TourStop, 'target'> & {
  target:
    | {
        kind: 'file';
        file: string;
        version: RecordedVersion;
        anchor?: EvidenceAnchor;
        quote?: string;
      }
    | { kind: 'view'; bookmark: string };
};
export interface TourDraft {
  name: string;
  /** The tour file this edits; a new tour has none until it is saved. */
  file?: string;
  /** That file's revision when it was read, so a save never replaces someone else's edits. */
  revision: string;
  /** The tour's own dwell, kept as the file had it. */
  dwell?: number | null;
  stops: DraftStop[];
}

let draft: TourDraft | null = null;
const listeners = new Set<() => void>();
const changed = (next: TourDraft | null) => {
  draft = next;
  for (const listener of listeners) listener();
};
export const tourDraft = () => draft;
export function subscribeDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** Starts editing: a new, empty tour, or the stops of one read from its file. */
export function editTour(document?: TourDocument): void {
  if (!document) {
    changed({ name: '', revision: '', stops: [] });
    return;
  }
  changed({
    name: document.definition.name,
    file: document.file,
    revision: document.revision,
    dwell: document.definition.dwell,
    stops: document.definition.stops.map((stop) =>
      stop.target.kind === 'view'
        ? { ...stop, target: { ...stop.target } }
        : {
            ...stop,
            target: {
              kind: 'file',
              file: resolveTourPath(document.root, stop.target.path),
              version: stop.target.version,
              anchor: stop.target.anchor,
              quote: stop.target.quote,
            },
          },
    ),
  });
}
export const closeDraft = () => changed(null);
export function changeDraft(change: (draft: TourDraft) => TourDraft): void {
  if (draft) changed(change(draft));
}
export function updateStop(id: string, change: Partial<Pick<DraftStop, 'caption' | 'note'>>) {
  changeDraft((current) => ({
    ...current,
    stops: current.stops.map((stop) => (stop.id === id ? { ...stop, ...change } : stop)),
  }));
}
export function moveStop(id: string, by: -1 | 1): void {
  changeDraft((current) => {
    const stops = [...current.stops];
    const index = stops.findIndex((stop) => stop.id === id);
    const target = index + by;
    if (index < 0 || target < 0 || target >= stops.length) return current;
    [stops[index], stops[target]] = [stops[target]!, stops[index]!];
    return { ...current, stops };
  });
}
export function removeStop(id: string): void {
  changeDraft((current) => ({ ...current, stops: current.stops.filter((stop) => stop.id !== id) }));
}

/** What the recorder measures on screen for a plane: a picture's fitted size, a drawing's canvas. */
function measured(paneID: string): PreviewMeasures {
  const plane = Array.from(document.querySelectorAll<HTMLElement>('[data-viewer-pane]')).find(
    (element) => element.dataset.viewerPane === paneID,
  );
  const image = plane?.querySelector<HTMLImageElement>('.image-stage img');
  const stage = image?.parentElement;
  const drawing = plane?.querySelector<HTMLElement>('.dxf-stage');
  return {
    image:
      image && stage
        ? {
            shown: { width: image.clientWidth, height: image.clientHeight },
            stage: { width: stage.clientWidth, height: stage.clientHeight },
          }
        : undefined,
    drawing: drawing ? { width: drawing.clientWidth, height: drawing.clientHeight } : undefined,
  };
}
/**
 * The active file plane as a stop: where its preview is now (page, zoom, the part of a picture
 * or drawing in view, a model's camera), else for a preview without such state the evidence it
 * was opened at, and the camera's hold on its plane (docked or framed). Its file is read for its
 * SHA-256 when it is no larger than `tourHashLimit`.
 */
export async function recordStop(workspace: Pick<WorkspaceController, 'isDocked'>): Promise<void> {
  if (!draft) return;
  const space = activeWorkspace();
  const pane = space.panes.find((item) => item.id === getState().activePane);
  if (pane?.type !== 'preview')
    throw new Error('Click a file’s plane first. A tour stop shows a file.');
  const name = fileName(pane.path);
  const parent = pane.path.slice(0, pane.path.length - name.length - 1) || '/';
  const lookup = await window.viewer.tour({ kind: 'stat', root: parent, path: name, hash: true });
  if (lookup.state !== 'found')
    throw new Error(
      lookup.state === 'link'
        ? `${name} is a link. A tour stop shows a file stored in the tour’s folder.`
        : lookup.state === 'denied'
          ? `Viewer has no access to “${fileName(parent)}”, so ${name} cannot be added.`
          : `${name} is no longer in “${fileName(parent)}”.`,
    );
  const { entry } = lookup;
  const version: RecordedVersion = {
    ...sourceVersion(entry),
    ...(lookup.sha256 ? { sha256: lookup.sha256 } : {}),
  };
  const values = previewValues(pane.id, space.id);
  const saved = values['_sourceVersion'] as RecordedVersion | undefined;
  // State saved for an earlier version of the file says nothing about this one.
  const current = !saved || sameSourceVersion(saved, sourceVersion(entry));
  const module = choosePreview(entry).id;
  const recorded = current ? anchorFromPreviewState(module, values, measured(pane.id)) : undefined;
  // A preview with state is where its state says, or shows the whole file; any other keeps the
  // evidence it was opened at, if the file is still that one.
  const opened =
    !stateAnchored(module) &&
    pane.evidence &&
    sameSourceVersion(pane.evidence.version, sourceVersion(entry))
      ? pane.evidence
      : undefined;
  const anchor: EvidenceAnchor | undefined = recorded ?? opened?.anchor;
  const stop: DraftStop = {
    id: slugID(entry.name, 'stop', draft?.stops.map((item) => item.id) ?? []),
    caption: recordedCaption(entry.path, anchor),
    source: 'recorded',
    // the pose only: the plane is the one showing the file when the tour plays
    view: { pose: workspace.isDocked() ? 'dock' : 'frame' },
    target: {
      kind: 'file',
      file: entry.path,
      version,
      ...(anchor ? { anchor } : {}),
      ...(opened?.quote ? { quote: opened.quote } : {}),
    },
  };
  changeDraft((latest) => ({ ...latest, stops: [...latest.stops, stop] }));
}

/** The folder a draft saves in: its file's, else the deepest one holding every stop's file. */
export function draftFolder(current: TourDraft): string | undefined {
  if (current.file) return current.file.replace(/[\\/][^\\/]*$/, '') || '/';
  return commonFolder(
    current.stops.flatMap((stop) => (stop.target.kind === 'file' ? [stop.target.file] : [])),
  );
}
/** The tour file a draft saves to. */
export function draftFile(current: TourDraft): string | undefined {
  if (current.file) return current.file;
  const folder = draftFolder(current);
  const name = current.name.trim() || (folder ? fileName(folder) : '');
  if (!folder || !name) return;
  return folder.replace(/\/$/, '') + '/' + name.replace(/[\\/:]/g, '-') + tourFileSuffix;
}
/** The draft's stops with paths relative to `folder`, as its file holds them. */
function savedStops(current: TourDraft, folder: string): TourStop[] {
  return current.stops.map((stop): TourStop => {
    if (stop.target.kind === 'view') return { ...stop, target: stop.target };
    const { file: path, ...target } = stop.target;
    const relative = tourPath(folder, path);
    if (!relative)
      throw new Error(
        `${fileName(path)} is outside “${fileName(folder)}”, the folder this tour is saved in. ` +
          'Remove the stop, or record the tour again from that folder.',
      );
    return { ...stop, target: { ...target, path: relative } };
  });
}
/** The draft as it would play once saved, so it can be tried first. */
export function draftTour(current: TourDraft): PlayableTour {
  const folder = draftFolder(current);
  if (!current.stops.length || !folder) throw new Error('Add a stop to play the tour.');
  return {
    name: current.name.trim() || fileName(folder),
    root: folder,
    file: current.file,
    dwell: current.dwell,
    stops: savedStops(current, folder),
  };
}
/** Writes the draft's tour file; a new one never replaces a file already there. */
export async function saveDraft(): Promise<TourDocument> {
  const current = draft;
  if (!current?.stops.length) throw new Error('Add a stop before saving the tour.');
  const folder = draftFolder(current),
    file = draftFile(current);
  if (!folder || !file) throw new Error('Name the tour before saving it.');
  const stops = savedStops(current, folder);
  // a stop whose path from the tour's folder goes through a link would never play
  for (const stop of stops) {
    if (stop.target.kind !== 'file') continue;
    const lookup = await window.viewer.tour({ kind: 'stat', root: folder, path: stop.target.path });
    if (lookup.state === 'link')
      throw new Error(
        `${stop.target.path} is reached through a link from “${fileName(folder)}”. ` +
          'Remove the stop, or record the tour in the folder that holds the file.',
      );
    if (lookup.state === 'denied')
      throw new Error(
        `Viewer has no access to “${fileName(folder)}”. Allow the folder in the folder picker, then save again.`,
      );
  }
  if (!current.file) {
    const existing = await window.viewer.stat(file).then(
      () => true,
      () => false,
    );
    if (existing)
      throw new Error(
        `A tour named “${tourFileName(file)}” is already in “${fileName(folder)}”. ` +
          'Choose another name, or open that tour to edit it.',
      );
  }
  const definition = tourDefinitionSchema.parse({
    version: 1,
    name: current.name.trim() || tourFileName(file),
    ...(current.dwell !== undefined ? { dwell: current.dwell } : {}),
    stops,
  });
  const document = await window.viewer.tour({
    kind: 'save',
    file,
    revision: current.revision,
    definition,
  });
  rememberTour(document);
  if (draft === current)
    changed({
      ...current,
      file: document.file,
      revision: document.revision,
      name: definition.name,
    });
  return document;
}
