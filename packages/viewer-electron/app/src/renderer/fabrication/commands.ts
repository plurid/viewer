import type { CommandContext, CommandDefinition } from '../commands/registry';
import type { JobContents } from '../../domain/fabrication/job-files';
import type { WorkspaceController } from '../workspace/context';
import type { ContentsSource } from './contents';
import { inventoryLimit } from '../../domain/fabrication/answer';
import { folderContents, jobContents } from '../../domain/fabrication/job-files';
import { listText } from '../../domain/fabrication/plan';
import { countText } from '../../domain/layout/nesting/format';
import { fileName } from '../../domain/tours/tour';
import {
  checkSession,
  clockText,
  exportHandoff,
  handoffNestings,
  keptCheck,
  openCheck,
  playCheckTour,
  prepareCutSheets,
  saveCorrection,
} from './check';
import { knownJob } from './contents';
import { gradedCheck, gradedText, sameJob } from './spoken';

/** Where a check reads: the selected files, or one folder, with what the window knows it holds. */
export type CheckPlace = 'files' | 'folder';
interface CheckTarget {
  place: CheckPlace;
  paths: string[];
  contents: JobContents;
  /** For a folder: whether its own files were counted from a plane showing it, or a probe. */
  source?: ContentsSource;
}
/** What a check reads here, cutting work or not: the selected files, a selected folder, or the
 * folder shown when nothing is selected. Undefined while the folder is still being counted. */
function reads(context: CommandContext): CheckTarget | undefined {
  const { selection } = context;
  const files = selection.filter((entry) => !entry.directory);
  if (files.length) {
    if (files.length > inventoryLimit) return undefined;
    const job = fileName(files[0]!.parent);
    return {
      place: 'files',
      paths: files.map((entry) => entry.path),
      contents: jobContents(job, folderContents(files), []),
    };
  }
  const [only] = selection;
  if (selection.length > 1 || (only && only.kind !== 'directory')) return undefined;
  const folder = only?.path ?? context.directory;
  if (!folder) return undefined;
  const known = knownJob(folder, only?.modified);
  return known && { place: 'folder', paths: [folder], ...known };
}
/** A target with parts to cut: a DXF or DWG file, and not a folder of several jobs. */
const cutting = (target: CheckTarget | undefined) =>
  !!target && !target.contents.jobs.length && target.contents.dxf + target.contents.dwg > 0;
function checked(context: CommandContext): CheckTarget | undefined {
  const target = reads(context);
  return cutting(target) ? target : undefined;
}

/** "request email", "2 requests". */
function requestText({ request, email }: JobContents): string {
  const noun = email === request ? 'request email' : 'request';
  return request === 1 ? noun : countText(request, noun);
}
/** "5 DXF parts", "DXF part". */
const partsText = (count: number) => (count === 1 ? 'DXF part' : `${count} DXF parts`);

/**
 * What the check of this target compares, by what is there: "Compare Job 1042’s request email and
 * 1 drawing with its 5 DXF parts". Counted by a probe only, it says no more than the parts.
 */
function checkDetail(target: CheckTarget): string {
  const { contents, place } = target;
  const { job, dxf, dwg, drawing, photo } = contents;
  const selected = place === 'files';
  if (!dxf)
    return `${countText(dwg, 'DWG file')}${selected ? ' selected' : ` in ${job}`} and no DXF: save ${dwg === 1 ? 'it' : 'them'} as DXF to check ${dwg === 1 ? 'it' : 'them'}`;
  if (target.source === 'probed') return `Check the ${partsText(dxf)} in ${job}`;
  const photos = photo ? countText(photo, 'photo') : undefined;
  if (!contents.request && !drawing) {
    const what = listText([countText(dxf, 'DXF part'), ...(photos ? [photos] : [])]);
    const checks = photo ? 'names, measurements and photos' : 'names and measurements only';
    return `${what}${selected ? ' selected' : ` in ${job}`}, with no request or drawing: checks ${checks}`;
  }
  const compared = listText([
    ...(contents.request ? [requestText(contents)] : []),
    ...(drawing ? [countText(drawing, 'drawing')] : []),
    ...(photos ? [photos] : []),
  ]);
  return selected
    ? `Compare the selected ${compared} with ${dxf === 1 ? 'the DXF part' : `${dxf} DXF parts`}`
    : `Compare ${job}’s ${compared} with its ${partsText(dxf)}${contents.partsIn ? ` in ${contents.partsIn}` : ''}`;
}
/** "Show the check from 22:14: 3 findings, 2 confirmed by Viewer"; its grades are not given once
 * the job is known to have changed since. */
function keptText(paths: readonly string[]): string | undefined {
  const found = keptCheck(paths);
  const result = found?.result;
  if (!result || found.checked === undefined) return undefined;
  if (found.stale) return `Show the check from ${clockText(found.checked)}, before the job changed`;
  const confirmed = result.findings.filter((item) => item.grade.status === 'confirmed').length;
  const findings = result.findings.length
    ? `${countText(result.findings.length, 'finding')}, ${confirmed} confirmed by Viewer`
    : 'no findings';
  return `Show the check from ${clockText(found.checked)}: ${findings}`;
}
/** Why there is no check here, for discovery. */
function unavailableText(context: CommandContext): string {
  const { selection } = context;
  const files = selection.filter((entry) => !entry.directory);
  if (files.length > inventoryLimit) return `A check reads at most ${inventoryLimit} files.`;
  if (!files.length && selection.length > 1)
    return 'Select one job folder, or its files with a DXF part.';
  if (!selection.length && !context.directory) return 'Open a job folder, or select its files.';
  const target = reads(context);
  if (!target)
    return selection[0] && selection[0].kind !== 'directory'
      ? 'A check reads the job folder itself, not a link to it.'
      : 'Viewer is still counting the files here.';
  const { job, jobs } = target.contents;
  if (jobs.length)
    return jobs.length === 1
      ? `${job} holds ${jobs[0]}: select it to check it.`
      : `${job} holds ${listText(jobs)}: select one to check it.`;
  return target.place === 'files'
    ? 'The selection holds no DXF or DWG file.'
    : `${job} holds no DXF or DWG file.`;
}

export function checkCommands(): CommandDefinition[] {
  return [
    {
      id: 'check-laser-job',
      label: 'Check laser job…',
      group: 'Files',
      icon: 'drawing',
      aliases: [
        'laser',
        'fabrication',
        'check job',
        'check drawing',
        'dxf',
        'cut',
        'hole pitch',
        'muse spark',
      ],
      detail: (context) => {
        const target = checked(context)!;
        return keptText(target.paths) ?? checkDetail(target);
      },
      when: (context) => !!checked(context),
      unavailable: unavailableText,
      run: (context) => openCheck(checked(context)!.paths, context.workspaceID, context.paneID),
      spoken: {
        phrase: (context) => {
          const target = checked(context);
          if (!target) return 'check the laser job';
          const { job } = target.contents;
          return target.place === 'files' ? `check the selected files of ${job}` : `check ${job}`;
        },
        subject: (context) => checked(context)?.contents.job,
        // spoken, "check this job" is graded before the plan goes on
        run: async (context, progress, signal) => {
          const { paths } = checked(context)!;
          const open = checkSession();
          // a check of this job already open, running or graded, is waited for, not begun again
          if (!open || !sameJob(open.paths, paths) || ['empty', 'failed'].includes(open.phase))
            await openCheck(paths, context.workspaceID, context.paneID);
          return gradedText(await gradedCheck(paths, progress, signal));
        },
      },
    },
  ];
}

/** The open check, while its result is current: what its next steps act on. */
function graded() {
  const current = checkSession();
  return current?.phase === 'checked' && current.result && !current.stale ? current : undefined;
}
const checkedJob = () => checkSession()?.opening?.job ?? 'the job';
/** Why a next step is not offered: no check, or one older than the job. */
function notGraded(): string {
  const current = checkSession();
  return current?.stale
    ? `${checkedJob()} changed since its check. Run the check again first.`
    : 'Check a laser job first: this follows its check.';
}
/** The corrections the open check proposes that are not saved yet. */
const unsaved = () => {
  const current = graded();
  return (current?.result?.findings ?? []).filter(
    (item) => item.correction && !current?.corrections[item.finding.id],
  );
};
/** A spoken plan names each after "check this job": the check's result is what they act on. */
const afterCheck = ['check-laser-job'];

/**
 * The open check's next steps, as its panel offers them: the cut sheets, the tour, the corrected
 * copies and the handoff. Each acts on the check's current result. The last two save files, so a
 * spoken plan waits for the person's press on them.
 */
export function checkResultCommands(workspace: WorkspaceController): CommandDefinition[] {
  const subject = () => graded()?.opening?.job;
  return [
    {
      id: 'check-cut-sheets',
      label: 'Prepare cut sheets',
      group: 'Files',
      icon: 'grid',
      aliases: ['cut sheets', 'nest', 'nest the parts', 'nesting'],
      detail: () =>
        `Nest ${checkedJob()}’s ${countText(graded()!.result!.parts.length, 'part')} in a Layout plane, as the check reads them`,
      when: () => !!graded()?.result?.parts.length,
      unavailable: notGraded,
      run: () => prepareCutSheets(workspace),
      spoken: {
        phrase: () =>
          graded() ? `prepare ${checkedJob()}’s cut sheets` : 'prepare the cut sheets',
        follows: 'prepare its cut sheets',
        subject,
        after: afterCheck,
        run: async () => {
          const parts = graded()!.result!.parts.length;
          prepareCutSheets(workspace);
          return `Opened ${countText(parts, 'part')} in a Layout plane`;
        },
      },
    },
    {
      id: 'check-tour',
      label: 'Play the check’s tour',
      group: 'Files',
      icon: 'play',
      aliases: ['tour', 'play the tour', 'show the findings', 'walk through the findings'],
      detail: () =>
        `${countText(graded()!.result!.tour.stops.length, 'stop')} through ${checkedJob()}’s files`,
      when: () => !!graded()?.result?.tour.stops.length,
      unavailable: notGraded,
      run: () => playCheckTour(workspace),
      spoken: {
        phrase: () => (graded() ? `play ${checkedJob()}’s tour` : 'play the check’s tour'),
        follows: 'play its tour',
        subject,
        after: afterCheck,
      },
    },
    {
      id: 'check-corrections',
      label: 'Save corrected copies',
      group: 'Files',
      icon: 'drawing',
      aliases: ['save the corrections', 'correct the dxf', 'fix the pitch', 'fix the holes'],
      detail: () =>
        `${listText(unsaved().map((item) => item.correction!.name))}, beside each original, which is kept`,
      when: () => unsaved().length > 0,
      unavailable: () => (graded() ? 'The check proposes no correction to save.' : notGraded()),
      run: async () => {
        for (const item of unsaved()) await saveCorrection(item);
      },
      spoken: {
        phrase: () =>
          graded() ? `save ${checkedJob()}’s corrected copies` : 'save the corrected copies',
        follows: 'save its corrected copies',
        subject,
        after: afterCheck,
      },
    },
    {
      id: 'check-handoff',
      label: 'Export handoff',
      group: 'Files',
      icon: 'share',
      aliases: ['handoff', 'export the job', 'export for the shop', 'send to the shop'],
      detail: (context) =>
        `Save “${checkedJob()} handoff” in the job’s folder${handoffNestings(graded()!, context.jobs).missing.length ? ', nesting first what no Layout plane has' : ''}`,
      when: (context) => {
        const current = graded();
        return (
          !!current &&
          !current.handoff &&
          !current.handoffProgress &&
          !handoffNestings(current, context.jobs).hold
        );
      },
      unavailable: (context) => {
        const current = graded();
        if (!current) return notGraded();
        if (current.handoff) return 'The handoff is saved.';
        return handoffNestings(current, context.jobs).hold ?? 'The handoff is being exported.';
      },
      run: () => exportHandoff(),
      spoken: {
        phrase: () => (graded() ? `export ${checkedJob()}’s handoff` : 'export the handoff'),
        follows: 'export its handoff',
        subject,
        after: afterCheck,
      },
    },
  ];
}
