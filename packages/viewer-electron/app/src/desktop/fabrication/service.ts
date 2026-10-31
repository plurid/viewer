/**
 * THE FABRICATION CHECK: a job folder or selection read as an inventory of opaque refs, one model
 * call at the `images` data level with the request's text, the drawings' pages and the photos as
 * pictures and Viewer's measurement of each DXF, then the answer checked: refs and pages validated,
 * every finding graded against Viewer's own measurement and page text, the tour built and confirmed
 * pitch findings turned into reviewed corrections. Private documents retain paid results and
 * explicit human confirmations; reopening never repeats a model call. Source versions are checked
 * again before correction or handoff, independently of the renderer's stale indicator
 * (docs/reference/fabrication.md).
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import type { ApplicationSettings, DocumentData, ModelProvider } from '../../domain/services';
import type { FileEntry, OperationJob, OperationRequest } from '../../domain/contracts';
import type { ModelDataPermission } from '../../domain/models/permissions';
import type { ModelImage } from '../../domain/models/images';
import type { SegmentationPicture } from '../../domain/models/segmentation';
import type {
  InventoryFile,
  InventorySource,
  FabricationAnswer,
} from '../../domain/fabrication/answer';
import type { GradeJob } from '../../domain/fabrication/grade';
import type { MeasureOutcome, Measurement } from '../../domain/fabrication/measure';
import type { CheckChange, JobContents, JobFolder } from '../../domain/fabrication/job-files';
import type {
  CheckChanges,
  CheckFinding,
  CheckNothing,
  CheckOpening,
  CheckOutline,
  CheckProgress,
  CheckProvider,
  CheckRecord,
  CheckResult,
  CheckSending,
  CheckSaved,
  CheckSummary,
  FabricationReply,
  FabricationRequest,
  PageText,
  RecordInput,
  RecordPicture,
  RenderedPage,
} from '../../domain/fabrication/check';
import type {
  CheckInputDXF,
  CheckInputDrawing,
  CheckInputPhoto,
  CheckInputRequest,
} from '../../domain/fabrication/prompt';
import type { StopMark } from '../../domain/fabrication/tour';
import type { EvidenceAnchor, EvidenceRegion } from '../../domain/files/inspection';
import type { TourStop } from '../../domain/tours/tour';
import type { Providers } from '../models/providers';
import type { Segmenter } from '../models/segmentation';
import type { HandoffCheck } from './handoff';
import type { CheckDocument } from '../../domain/fabrication/check-document';
import type { DXFCorrection } from '../../domain/fabrication/plan';
import type { HandoffTransform } from '../../domain/fabrication/handoff';
import {
  enumerateRequirements,
  requirementConfirmationSchema,
  verifyRequirement,
} from '../../domain/fabrication/requirements';
import { CheckStore } from './check-store';
import type { PhotoEncoder, PhotoRenderer } from './inputs';
import {
  answerIssues,
  buildInventory,
  fabricationAnswerSchema,
  modelInventory,
} from '../../domain/fabrication/answer';
import { checkFileKind, checkLimits, pageTextLabel } from '../../domain/fabrication/check';
import { checkAnswerSchema, checkInput, checkInstructions } from '../../domain/fabrication/prompt';
import { correctedName, listText } from '../../domain/fabrication/plan';
import { readJobName } from '../../domain/fabrication/names';
import {
  correctedCopy,
  folderContents,
  isHandoff,
  jobContents,
  jobFileKind,
  jobFolders,
  jobLimits,
  nothingText,
} from '../../domain/fabrication/job-files';
import { modelImageLimits } from '../../domain/models/images';
import {
  modelDataLabels,
  modelEndpoint,
  modelPermissionCovers,
} from '../../domain/models/permissions';
import {
  providerModelID,
  providerPresets,
  providerTakesImages,
} from '../../domain/models/providers';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import { commonFolder, tourDefinitionSchema } from '../../domain/tours/tour';
import { boxRegion } from '../../domain/files/regions';
import { modelBoxLabel } from '../../domain/models/segmentation';
import { countText } from '../../domain/layout/nesting/format';
import { quoteOn } from '../../domain/fabrication/quotes';
import { errorMessage } from '../../domain/errors';
import { DXF_MAX_BYTES } from '../../domain/previews/drawings/dxf/math';
import { absolute, entry, list } from '../files/filesystem';
import { boxSegmenter } from '../models/segmentation';
import {
  hashListed,
  pagePicture,
  preparePhoto,
  readListed,
  requestInput,
  requestText,
  sha256,
} from './inputs';

export interface FabricationPorts {
  /** Private desktop data, never a job or imported project folder. */
  dataPath?: string;
  operate?(request: OperationRequest): string;
  operations?(): readonly OperationJob[];
  matchesOutput?(id: string, path: string): Promise<boolean>;
  /** PDF text extracted by the desktop; renderer runs may position highlights only. */
  extract?(file: string, signal: AbortSignal): Promise<DocumentData>;
  settings(): ApplicationSettings;
  access(files: readonly string[]): Promise<void>;
  permission(provider: ModelProvider): Promise<ModelDataPermission | null>;
  generate: Providers['generate'];
  encodePhoto: PhotoEncoder;
  renderPhoto?: PhotoRenderer;
  /** What outlines a finding's region for the provider asked; its box unless given. */
  segmenter?(provider: ModelProvider): Segmenter | undefined;
  /** Tells the window running a check what the check does now. */
  progress?(owner: number, progress: CheckProgress): void;
  now?(): number;
}
interface Check extends CheckDocument {
  owners: Set<number>;
  running?: AbortController;
}
/** What one run read and sends. */
interface Prepared {
  requests: CheckInputRequest[];
  drawings: CheckInputDrawing[];
  photos: CheckInputPhoto[];
  dxf: CheckInputDXF[];
  images: ModelImage[];
  /** By `ref` or `ref:page`. */
  pictures: Map<string, SegmentationPicture>;
  texts: Map<string, string>;
  /** A drawing page's text runs, by `ref:page`. */
  runs: Map<string, PageText[]>;
  measured: Map<string, { name: string; outcome: MeasureOutcome }>;
  inputs: RecordInput[];
  notSent: string[];
}
/** A job as it is now: the files its check reads, those it leaves out with why, and why there is
 * nothing to check when there is not. */
interface JobListing {
  folder: string;
  job: string;
  listed: InventoryFile[];
  skipped: CheckOpening['skipped'];
  nothing?: string;
}

const sendings: Record<InventorySource['kind'], CheckSending> = {
  request: 'text',
  drawing: 'pages',
  photo: 'picture',
  dxf: 'measurement',
};
const visible = (entries: readonly FileEntry[]) => entries.filter((file) => !file.hidden);
const seconds = (milliseconds: number) => Math.round(milliseconds / 100) / 10;
/** Who reads a job with a provider: "Muse Spark", else the provider's name. */
const readerOf = (provider: ModelProvider) =>
  providerPresets[provider.kind].family ?? provider.name;
const timedOut = (error: unknown) =>
  (error instanceof DOMException && error.name === 'TimeoutError') ||
  errorMessage(error) === 'The provider request timed out.';
/** An answer that took too long, in words: the step, and the faster effort when there is one. */
function timeoutText(provider: ModelProvider): string {
  const faster =
    providerPresets[provider.kind].efforts?.includes('minimal') && provider.effort !== 'minimal'
      ? `, or choose Minimal under Reasoning effort for ${provider.name} in Settings → Models to answer faster`
      : '';
  return `${readerOf(provider)} timed out after ${checkLimits.answerTime / 1000} s reading the job, so nothing was graded. Run the check again${faster}.`;
}
/** What the model reads: "the request, 2 drawing pages, 1 photo and 2 DXF parts". */
function readingText(inputs: Prepared): string {
  const pages = inputs.drawings.reduce((sum, drawing) => sum + drawing.shown.length, 0);
  const counted = (count: number, noun: string) => (count ? [countText(count, noun)] : []);
  return listText([
    ...(inputs.requests.length === 1
      ? ['the request']
      : counted(inputs.requests.length, 'request')),
    ...counted(pages, 'drawing page'),
    ...counted(inputs.photos.length, 'photo'),
    ...counted(inputs.dxf.length, 'DXF part'),
  ]);
}

export class FabricationChecks {
  private checks = new Map<string, Check>();
  private loading = new Map<string, Promise<Check>>();
  private store?: CheckStore;
  private closing = false;
  private runs = new Set<Promise<CheckResult>>();
  constructor(private ports: FabricationPorts) {
    if (ports.dataPath)
      this.store = new CheckStore(path.join(ports.dataPath, 'fabrication-checks'));
  }
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  async request(request: FabricationRequest, owner: number): Promise<FabricationReply> {
    switch (request.kind) {
      case 'open':
        return this.open(request.paths, owner);
      case 'run': {
        const work = this.run(request.id, request.providerID, request.pages, owner);
        this.runs.add(work);
        try {
          return await work;
        } finally {
          this.runs.delete(work);
        }
      }
      case 'cancel':
        this.own(request.id, owner).running?.abort();
        return { kind: 'done' };
      case 'changes':
        return this.changes(request.id, owner);
      case 'list':
        return { kind: 'checks', checks: await this.listSaved(request.paths) };
      case 'read':
        return this.read(request.id, owner);
      case 'confirm':
        return this.confirm(request, owner);
      case 'validate': {
        const check = this.own(request.id, owner);
        await this.validate(check);
        this.requireCutPlan(check);
        return check.result!;
      }
      case 'correct':
        return this.correct(request.id, request.finding, owner);
      case 'close': {
        const check = this.checks.get(request.id);
        check?.owners.delete(owner);
        return { kind: 'done' };
      }
    }
  }
  /** What a handoff of a finished check writes: its tour and its record. */
  handoff(id: string): HandoffCheck | undefined {
    const check = this.checks.get(id);
    if (!check?.result || !check.record) return undefined;
    return {
      ...(check.tour ? { tour: check.tour } : {}),
      record: JSON.stringify(check.record, null, 2) + '\n',
    };
  }
  /** The executor validates the saved check again; reading a record alone never authorizes work. */
  async prepareHandoff(
    id: string,
    plan?: HandoffTransform,
    paths?: readonly string[],
  ): Promise<HandoffCheck | undefined> {
    const check = await this.load(id);
    await this.validate(check);
    if (plan && paths) await this.validateHandoff(check, plan, paths);
    return this.handoff(id);
  }
  /** Persist the desktop queue's identity so a restored result can find its handoff receipt. */
  async rememberOperation(request: OperationRequest, operation: string): Promise<void> {
    if (request.kind !== 'convert' || request.transform?.kind !== 'fabrication-handoff') return;
    const check = await this.load(request.transform.check);
    if (!check.handoffs.includes(operation)) {
      check.handoffs.push(operation);
      await this.save(check);
    }
  }
  /** Views detach without discarding a paid result or cancelling an active request. */
  stopOwner(owner: number): void {
    for (const check of this.checks.values()) check.owners.delete(owner);
  }
  async close(): Promise<void> {
    this.closing = true;
    for (const check of this.checks.values()) {
      if (!check.running) continue;
      check.status = 'interrupted';
      check.error = 'Viewer closed before this check finished. Run it again when ready.';
      check.running.abort();
      await this.save(check);
    }
    await Promise.allSettled([...this.runs]);
    await this.flush();
  }
  async flush(): Promise<void> {
    await this.store?.flush();
  }
  private own(id: string, owner: number): Check {
    const check = this.checks.get(id);
    if (!check || !check.owners.has(owner))
      throw new Error('Open this saved check before continuing.');
    return check;
  }

  private async save(check: Check): Promise<void> {
    check.updated = this.now();
    const { owners: _owners, running: _running, ...document } = check;
    await this.store?.save(document);
  }
  private progress(check: Check, progress: Omit<CheckProgress, 'id'>): void {
    for (const owner of check.owners) this.ports.progress?.(owner, { id: check.id, ...progress });
  }
  private async listSaved(paths?: readonly string[]): Promise<CheckSummary[]> {
    const normalized = paths?.map(absolute).sort();
    const stored = (await this.store?.list()) ?? [];
    const summaries = new Map(stored.map((check) => [check.id, check]));
    for (const check of this.checks.values())
      summaries.set(check.id, {
        id: check.id,
        job: check.job,
        folder: check.folder,
        paths: check.paths,
        status: check.status,
        updated: check.updated,
        ...(check.result ? { summary: check.result.summary } : {}),
      });
    return [...summaries.values()]
      .filter(
        (check) =>
          !normalized || JSON.stringify([...check.paths].sort()) === JSON.stringify(normalized),
      )
      .sort((a, b) => b.updated - a.updated)
      .map(({ paths: _paths, ...summary }) => summary);
  }
  private async load(id: string): Promise<Check> {
    const current = this.checks.get(id);
    if (current) return current;
    const loading = this.loading.get(id);
    if (loading) return loading;
    const work = this.restore(id).finally(() => this.loading.delete(id));
    this.loading.set(id, work);
    return work;
  }
  private async restore(id: string): Promise<Check> {
    const document = await this.store?.read(id);
    if (!document) throw new Error('This saved check is unavailable. Check the job again.');
    const check: Check = { ...document, owners: new Set() };
    if (check.status === 'running') {
      check.status = 'interrupted';
      check.error = 'Viewer closed before this check finished. Run it again when ready.';
      await this.save(check);
    }
    this.checks.set(id, check);
    return check;
  }
  private async opening(check: Check): Promise<CheckOpening> {
    const providers = await this.providers();
    const providerID = defaultProvider(providers, this.ports.settings());
    return {
      kind: 'opened',
      id: check.id,
      folder: check.folder,
      job: check.job,
      sources: check.sources.map((source) => ({
        ref: source.ref,
        kind: source.kind,
        name: source.name,
        path: source.path,
        version: source.version,
        sending: sendings[source.kind],
      })),
      skipped: check.skipped,
      providers,
      ...(providerID ? { providerID } : {}),
    };
  }
  private async read(id: string, owner: number): Promise<CheckSaved> {
    const check = await this.load(id);
    check.owners.add(owner);
    let changes: CheckChange[];
    let error = check.error;
    if (check.result && !check.verification)
      error ??=
        'This saved check is available for inspection. Run it again before confirming requirements, correcting drawings or exporting.';
    try {
      changes = (await this.changes(id, owner)).changes;
    } catch (cause) {
      changes = check.sources.map((source) => ({ name: source.name, change: 'changed' as const }));
      error = errorMessage(cause);
    }
    return {
      kind: 'saved',
      paths: [...check.paths],
      opening: await this.opening(check),
      status: check.status,
      updated: check.updated,
      ...(check.result ? { result: check.result } : {}),
      ...(error ? { error } : {}),
      changes,
      corrections: { ...check.corrections },
      handoffs: [...check.handoffs],
    };
  }
  /** Recheck the complete source snapshot, including source documents that are not transform inputs. */
  private async current(check: Check): Promise<void> {
    for (const source of check.sources) {
      await this.ports.access([source.path]);
      const actual = sourceVersion(await entry(source.path));
      if (!sameSourceVersion(actual, source.version))
        throw new Error(
          `${source.name} changed since this check. Check the job again before continuing.`,
        );
      const expected = check.record?.inputs.find((input) => input.ref === source.ref)?.sha256;
      if (
        expected &&
        (await hashListed(
          source.path,
          source.version,
          this.ports.access,
          new AbortController().signal,
        )) !== expected
      )
        throw new Error(
          `${source.name} no longer matches this check's evidence. Check the job again.`,
        );
    }
  }
  private async recheck(check: Check): Promise<CheckResult> {
    if (!check.verification || !check.record || !check.result)
      throw new Error(
        'This older result has no verified source record. Run the check again before correcting or exporting.',
      );
    const inputs: Prepared = {
      requests: [],
      drawings: [],
      photos: [],
      dxf: [],
      images: [],
      pictures: new Map(),
      texts: new Map(Object.entries(check.verification.texts)),
      runs: new Map(Object.entries(check.verification.runs)),
      measured: new Map(),
      inputs: check.record.inputs,
      notSent: check.result.notSent,
    };
    const [{ decodeDXF }, { parseDrawing }, { measureDrawing }] = await Promise.all([
      import('../../domain/previews/drawings/dxf/decode'),
      import('../../domain/previews/drawings/dxf/geometry'),
      import('../../domain/fabrication/measure'),
    ]);
    for (const source of check.sources.filter((source) => source.kind === 'dxf')) {
      const bytes = await readListed(source.path, source.version, this.ports.access, DXF_MAX_BYTES);
      let outcome: MeasureOutcome;
      try {
        outcome = measureDrawing(parseDrawing(decodeDXF(bytes)));
      } catch (error) {
        outcome = { status: 'refused', reason: errorMessage(error) };
      }
      inputs.measured.set(source.ref, { name: source.name, outcome });
    }
    const previousSeconds = check.result.seconds;
    const result = await this.verify(
      check,
      check.verification.answer,
      inputs,
      undefined,
      new AbortController().signal,
      false,
    );
    result.seconds = previousSeconds;
    check.result = result;
    return result;
  }
  private async validate(check: Check): Promise<void> {
    if (check.running) throw new Error('Wait for this check to finish before continuing.');
    await this.current(check);
    await this.recheck(check);
  }
  private async confirm(
    request: Extract<FabricationRequest, { kind: 'confirm' }>,
    owner: number,
  ): Promise<CheckResult> {
    const check = this.own(request.id, owner);
    await this.validate(check);
    const claim = enumerateRequirements(check.verification!.answer).find(
      (claim) => claim.key === request.key,
    );
    if (!claim)
      throw new Error('This requirement is no longer part of the check. Reopen its evidence.');
    const source = check.sources.find((source) => source.ref === claim.ref);
    if (!source) throw new Error('This requirement does not name a source in this job.');
    const confirmation = requirementConfirmationSchema.parse({
      key: claim.key,
      kind: claim.kind,
      value: request.value,
      unit: request.unit,
      evidence: { ref: claim.ref, page: claim.page, version: source.version, quote: claim.quote },
      ...(claim.part ? { part: claim.part } : {}),
      confirmedAt: this.now(),
    });
    const verified = verifyRequirement(claim, { source, confirmation });
    if (verified.status !== 'human-confirmed')
      throw new Error(
        verified.status === 'unverified' ? verified.reason : 'The requirement was not confirmed.',
      );
    const previous = check.confirmations;
    const previousResult = check.result;
    const previousRecord = structuredClone(check.record);
    const previousTour = check.tour;
    check.confirmations = [...previous.filter((item) => item.key !== claim.key), confirmation];
    try {
      const result = await this.recheck(check);
      await this.current(check);
      await this.save(check);
      return result;
    } catch (error) {
      check.confirmations = previous;
      check.result = previousResult;
      check.record = previousRecord;
      check.tour = previousTour;
      throw error;
    }
  }
  private async correct(
    id: string,
    finding: string,
    owner: number,
  ): Promise<{ kind: 'operation'; id: string }> {
    const check = this.own(id, owner);
    await this.validate(check);
    const correction = check.result!.findings.find(
      (item) => item.finding.id === finding,
    )?.correction;
    if (!correction || !this.ports.operate)
      throw new Error(
        'This finding has no verified correction to save. Review its requirement first.',
      );
    const operation = this.ports.operate({
      kind: 'convert',
      sources: [correction.source],
      destination: path.dirname(correction.source),
      name: correction.name,
      transform: correction.plan,
      expectedSources: [{ path: correction.source, version: correction.version }],
    });
    check.corrections[finding] = operation;
    await this.save(check);
    return { kind: 'operation', id: operation };
  }
  /** Renderer-supplied targets cannot replace the correction the desktop verified. */
  async authorizeCorrection(plan: DXFCorrection, sources: readonly string[]): Promise<void> {
    if (!plan.review) throw new Error('Save this correction from its reviewed fabrication check.');
    const check = await this.load(plan.review.check);
    await this.validate(check);
    const correction = check.result!.findings.find(
      (item) => item.finding.id === plan.review!.finding,
    )?.correction;
    if (
      !correction ||
      sources.length !== 1 ||
      absolute(sources[0]!) !== correction.source ||
      !isDeepStrictEqual(plan, correction.plan)
    )
      throw new Error(
        'This correction no longer matches the reviewed requirement. Review it again.',
      );
  }
  private async validateHandoff(
    check: Check,
    plan: HandoffTransform,
    paths: readonly string[],
  ): Promise<void> {
    const result = check.result!;
    this.requireCutPlan(check);
    const allowed = new Map(result.parts.map((part) => [part.path, part]));
    for (const operation of this.ports.operations?.() ?? []) {
      if (
        operation.status !== 'completed' ||
        !Object.values(check.corrections).includes(operation.id)
      )
        continue;
      for (const item of operation.completed) {
        const original = allowed.get(item.source);
        if (original && item.destination && item.correction) {
          if (
            paths.includes(item.destination) &&
            !(await this.ports.matchesOutput?.(operation.id, item.destination))
          )
            throw new Error(
              `${path.basename(item.destination)} changed after its correction. Save a new reviewed copy before exporting.`,
            );
          allowed.set(item.destination, original);
        }
      }
    }
    const evidence = plan.evidence.map((index) => paths[index]);
    if (check.sources.some((source) => !evidence.includes(source.path)))
      throw new Error('The handoff must include this check’s source evidence.');
    for (const nesting of plan.nestings) {
      for (const [local, index] of nesting.sources.entries()) {
        const source = allowed.get(paths[index]!);
        if (!source) throw new Error('The nesting includes a drawing outside this checked job.');
        const quantities = nesting.plan.parts
          .filter((part) => part.source === local)
          .reduce((sum, part) => sum + part.quantity, 0);
        const pieces = nesting.plan.sources[local]!.together
          ? quantities * source.pieces
          : quantities;
        if (pieces !== source.quantity!.pieces)
          throw new Error(
            `${source.name}: the nesting quantity differs from the reviewed requirement.`,
          );
        if (Math.abs(nesting.plan.cutting.thickness - source.thickness!.value) > 0.000001)
          throw new Error(
            `${source.name}: the nesting thickness differs from the reviewed requirement.`,
          );
      }
    }
  }
  private requireCutPlan(check: Check): void {
    if (check.result!.parts.some((part) => part.question || !part.quantity || !part.thickness))
      throw new Error(
        'Resolve the job’s quantities and thicknesses before preparing cut sheets or exporting.',
      );
  }

  /**
   * A job folder or selection as it is now. A folder is read with the files of the folders in it,
   * one level down, as a job keeps its parts in `DXF/`; a selection is read as it is.
   */
  private async listJob(paths: readonly string[]): Promise<JobListing> {
    const chosen: FileEntry[] = [];
    for (const file of paths) {
      const normalized = absolute(file);
      await this.ports.access([normalized]);
      chosen.push(await entry(normalized));
    }
    const [only] = chosen;
    const fromFolder = chosen.length === 1 && only!.directory && only!.kind === 'directory';
    const folder = fromFolder
      ? only!.path
      : (commonFolder(chosen.map((file) => file.path)) ?? path.dirname(only!.path));
    const job = path.basename(folder) || folder;
    const skipped: CheckOpening['skipped'] = [];
    /** Each file, by the name a person reads it under: "DXF/g6-PL60-B2-2buc.dxf" in a folder. */
    let files: { file: FileEntry; name: string }[];
    let contents: JobContents;
    if (fromFolder) {
      const own = visible((await list(folder)).entries);
      const ownContents = folderContents(own);
      const read: { folder: JobFolder; entries: FileEntry[] }[] = [];
      for (const inside of jobFolders(job, ownContents))
        try {
          read.push({ folder: inside, entries: visible((await list(inside.path)).entries) });
        } catch (error) {
          skipped.push({
            name: inside.name,
            reason: `a folder Viewer could not read: ${errorMessage(error)}`,
          });
        }
      contents = jobContents(
        job,
        ownContents,
        read.map(({ folder, entries }) => ({
          name: folder.name,
          contents: folderContents(entries),
        })),
      );
      // a folder of jobs is not read: nothing is checked, and why says which jobs it holds
      const opened = contents.jobs.length ? [] : read;
      if (ownContents.folders.length > jobLimits.folders)
        skipped.push({
          name: countText(ownContents.folders.length, 'folder'),
          reason: `more than ${jobLimits.folders}, so the check reads none of them`,
        });
      else
        for (const item of ownContents.folders.filter(({ name }) => isHandoff(job, name)))
          skipped.push({ name: item.name, reason: 'a handoff a check saved' });
      files = [
        ...own.filter((file) => !file.directory).map((file) => ({ file, name: file.name })),
        ...opened.flatMap(({ folder, entries }) =>
          entries.map((file) => ({ file, name: `${folder.name}/${file.name}` })),
        ),
      ];
    } else {
      contents = jobContents(job, folderContents(chosen), []);
      files = chosen.map((file) => ({ file, name: file.name }));
    }
    const listed: InventoryFile[] = [];
    let photos = 0;
    for (const { file, name } of files) {
      const kind = checkFileKind(file.name);
      if (file.directory)
        skipped.push({
          name,
          reason:
            name === file.name
              ? 'a folder; the check reads files'
              : 'a folder in a folder; the check looks one level down',
        });
      else if (!kind)
        skipped.push({
          name,
          reason:
            jobFileKind(file.name) === 'dwg'
              ? 'a DWG; Viewer measures DXF only'
              : 'not a request, drawing, photo or DXF',
        });
      else if (file.kind !== 'file') skipped.push({ name, reason: 'a link' });
      else if (kind === 'photo' && ++photos > checkLimits.photos)
        skipped.push({
          name,
          reason: `the check sends at most ${checkLimits.photos} photos`,
        });
      else
        listed.push({
          path: file.path,
          kind,
          version: sourceVersion(file),
          ...(kind === 'request' ? { pages: 1 } : {}),
        });
    }
    const nothing = nothingText(contents, fromFolder);
    return { folder, job, listed, skipped, ...(nothing ? { nothing } : {}) };
  }

  /** The inventory of a job folder or selection and the providers that could read it, or why
   * there is nothing to check. Without a request or drawing, it checks names and measurements. */
  private async open(
    paths: readonly string[],
    owner: number,
  ): Promise<CheckOpening | CheckNothing> {
    const { folder, job, listed, skipped, nothing } = await this.listJob(paths);
    if (nothing) return { kind: 'nothing', folder, job, text: nothing };
    const sources = buildInventory(listed);
    const id = randomUUID();
    const now = this.now();
    const check: Check = {
      version: 1,
      id,
      owners: new Set([owner]),
      paths: paths.map(absolute),
      folder,
      job,
      sources,
      skipped,
      created: now,
      updated: now,
      status: 'ready',
      confirmations: [],
      corrections: {},
      handoffs: [],
    };
    this.checks.set(id, check);
    await this.save(check);
    return this.opening(check);
  }
  private async providers(): Promise<CheckProvider[]> {
    const listed: CheckProvider[] = [];
    for (const provider of this.ports.settings().providers) {
      const permission = await this.ports.permission(provider).catch(() => null);
      listed.push({
        id: provider.id,
        name: provider.name,
        model: provider.model,
        pictures: providerTakesImages(provider.kind),
        allowed: modelPermissionCovers(permission, provider, 'images'),
      });
    }
    return listed;
  }

  /**
   * What changed in a check's job since it listed the job, by size, date and identity: files
   * changed, new or gone. A corrected copy its correction saved is not a change.
   */
  private async changes(id: string, owner: number): Promise<CheckChanges> {
    const check = this.own(id, owner);
    const now = await this.listJob(check.paths);
    const listed = new Map(now.listed.map((file) => [file.path, file]));
    const changes: CheckChange[] = [];
    for (const source of check.sources) {
      const file = listed.get(source.path);
      if (!file) changes.push({ name: source.name, change: 'removed' });
      else if (!sameSourceVersion(file.version, source.version))
        changes.push({ name: source.name, change: 'changed' });
    }
    const known = new Set(check.sources.map((source) => source.path));
    const parts = check.sources
      .filter((source) => source.kind === 'dxf')
      .map((source) => source.name);
    for (const file of now.listed) {
      const name = path.basename(file.path);
      if (!known.has(file.path) && !correctedCopy(name, parts))
        changes.push({ name, change: 'added' });
    }
    return { kind: 'changes', id, changes };
  }

  private async run(
    id: string,
    providerID: string,
    pages: readonly RenderedPage[],
    owner: number,
  ): Promise<CheckResult> {
    if (this.closing) throw new Error('Viewer is closing. Reopen this check to run it again.');
    const check = this.own(id, owner);
    if (check.running) throw new Error('This check is already running.');
    const provider = this.ports.settings().providers.find((item) => item.id === providerID);
    if (!provider) throw new Error('That model is no longer in Settings → Models. Choose another.');
    if (!providerModelID(provider.kind, provider.model))
      throw new Error(`Choose a model ID for ${provider.name} in Settings → Models.`);
    if (!providerTakesImages(provider.kind))
      throw new Error(
        `Viewer does not send pictures to ${provider.name} yet. Choose Meta, Gemini, OpenRouter or another Chat Completions provider.`,
      );
    const permission = await this.ports.permission(provider);
    if (this.closing) throw new Error('Viewer is closing. Reopen this check to run it again.');
    if (check.running) throw new Error('This check is already running.');
    if (!modelPermissionCovers(permission, provider, 'images'))
      throw new Error(
        permission
          ? `${provider.name} may receive ${modelDataLabels[permission.level]}. This check also sends pictures: allow ${modelDataLabels.images} for ${provider.name}.`
          : `${provider.name} may not receive file data yet. Allow ${modelDataLabels.images} for ${provider.name} to check this job.`,
      );
    const abort = new AbortController();
    check.running = abort;
    check.status = 'running';
    check.error = undefined;
    check.result = undefined;
    check.tour = undefined;
    check.verification = undefined;
    check.confirmations = [];
    check.corrections = {};
    const signal = abort.signal;
    const started = this.now();
    const record: CheckRecord = {
      version: 1,
      job: check.job,
      started: new Date(started).toISOString(),
      provider: {
        kind: provider.kind,
        name: provider.name,
        endpoint: modelEndpoint(provider),
        model: providerModelID(provider.kind, provider.model),
      },
      level: 'images',
      instructions: checkInstructions,
      schema: checkAnswerSchema,
      inputs: [],
      validation: { valid: false, issues: [] },
      grades: [],
      segmentation: [],
      causes: [],
      corrections: [],
      tour: { stops: 0, skipped: [] },
      timings: { prepare: 0, model: 0, check: 0, total: 0 },
    };
    check.record = record;
    let prepared: number | undefined, answered: number | undefined;
    const reader = readerOf(provider);
    try {
      await this.save(check);
      const inputs = await this.prepare(check, pages, signal);
      signal.throwIfAborted();
      record.inputs = inputs.inputs;
      prepared = this.now();
      this.progress(check, {
        step: 'reading',
        text: `${reader} is reading ${readingText(inputs)}`,
      });
      const raw = await this.ports
        .generate(
          provider,
          checkInstructions,
          checkInput(
            {
              job: check.job,
              inventory: modelInventory(check.sources),
              requests: inputs.requests,
              drawings: inputs.drawings,
              photos: inputs.photos,
              dxf: inputs.dxf,
            },
            inputs.images.length,
          ),
          checkAnswerSchema,
          signal,
          'images',
          'user',
          { images: inputs.images, timeout: checkLimits.answerTime },
        )
        .catch((error: unknown) => {
          throw signal.aborted || !timedOut(error) ? error : new Error(timeoutText(provider));
        });
      answered = this.now();
      signal.throwIfAborted();
      record.output = raw;
      const parsed = fabricationAnswerSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue?.path.length ? issue.path.join('.') : 'the answer';
        record.validation = { valid: false, error: `${where}: ${issue?.message}`, issues: [] };
        throw new Error(
          `${provider.name}’s answer does not fit the check’s form at ${where}, so nothing was graded. Run the check again.`,
        );
      }
      check.verification = {
        version: 1,
        answer: parsed.data,
        texts: Object.fromEntries(inputs.texts),
        runs: Object.fromEntries(inputs.runs),
      };
      const result = await this.verify(check, parsed.data, inputs, provider, signal);
      signal.throwIfAborted();
      record.validation = { valid: true, issues: result.issues };
      result.seconds = seconds(this.now() - started);
      check.result = result;
      check.status = 'completed';
      return result;
    } catch (error) {
      record.error = signal.aborted ? 'The check was cancelled.' : errorMessage(error);
      if (!this.closing) {
        check.status = signal.aborted ? 'cancelled' : 'failed';
        check.error = record.error;
      }
      if (signal.aborted) throw new Error('The check was cancelled. Nothing was graded.');
      throw error;
    } finally {
      const finished = this.now();
      record.timings = {
        prepare: (prepared ?? finished) - started,
        model: prepared === undefined ? 0 : (answered ?? finished) - prepared,
        check: answered === undefined ? 0 : finished - answered,
        total: finished - started,
      };
      if (check.running === abort) check.running = undefined;
      await this.save(check);
      this.progress(check, { step: 'settled', text: `Check ${check.status}.` });
    }
  }

  /** Every listed file read as it is sent, each picture within the limits, in reading order. */
  private async prepare(
    check: Check,
    pages: readonly RenderedPage[],
    signal: AbortSignal,
  ): Promise<Prepared> {
    const access = (files: readonly string[]) => this.ports.access(files);
    const out: Prepared = {
      requests: [],
      drawings: [],
      photos: [],
      dxf: [],
      images: [],
      pictures: new Map(),
      texts: new Map(),
      runs: new Map(),
      measured: new Map(),
      inputs: [],
      notSent: [],
    };
    const byRef = new Map(check.sources.map((source) => [source.ref, source]));
    const drawn = new Map<string, RenderedPage[]>();
    for (const page of pages) {
      const source = byRef.get(page.ref);
      if (source?.kind !== 'drawing') throw new Error(`${page.ref} is not a drawing of this job.`);
      if (!sameSourceVersion(page.version, source.version))
        throw new Error(`${source.name} changed since the check listed it. Check the job again.`);
      const list = drawn.get(page.ref) ?? [];
      if (list.some((item) => item.page === page.page))
        throw new Error(`Page ${page.page} of ${source.name} was drawn twice.`);
      drawn.set(page.ref, [...list, page]);
    }
    let bytes = 0;
    const fits = (image: ModelImage) =>
      out.images.length < modelImageLimits.count &&
      image.data.byteLength <= modelImageLimits.bytes &&
      bytes + image.data.byteLength <= modelImageLimits.total;
    const add = (image: ModelImage): number => {
      out.images.push(image);
      bytes += image.data.byteLength;
      return out.images.length;
    };
    const picture = (
      image: ModelImage,
      number: number,
      size: { width: number; height: number },
      page?: number,
    ): RecordPicture => ({
      image: number,
      ...(page === undefined ? {} : { page }),
      // Only the size: a rendered page or prepared photo also holds its pixels.
      width: size.width,
      height: size.height,
      bytes: image.data.byteLength,
      sha256: sha256(image.data),
    });
    // Pages come first: a drawing's dimensions decide the findings.
    const ordered = [...check.sources].sort(
      (a, b) => (a.kind === 'photo' ? 1 : 0) - (b.kind === 'photo' ? 1 : 0),
    );
    const records = new Map<string, RecordInput>();
    for (const source of ordered) {
      signal.throwIfAborted();
      const base = {
        ref: source.ref,
        kind: source.kind,
        name: source.name,
        size: source.version.size,
        modified: source.version.modified,
      };
      if (source.kind === 'drawing') {
        const hash = await hashListed(source.path, source.version, access, signal);
        const list = (drawn.get(source.ref) ?? []).sort((a, b) => a.page - b.page);
        let extracted: DocumentData | undefined;
        let extractionError: string | undefined;
        try {
          extracted = this.ports.extract
            ? await this.ports.extract(source.path, signal)
            : await (
                await import('../previews/formats')
              ).extractDocument(source.path, {
                pages: 64,
                signal,
              });
        } catch (error) {
          signal.throwIfAborted();
          extractionError = `Text could not be read from the PDF: ${errorMessage(error)}`;
        }
        // Extraction and preview rendering must describe the same captured file.
        if ((await hashListed(source.path, source.version, access, signal)) !== hash)
          throw new Error(
            `${source.name} changed while its source text was read. Check the job again.`,
          );
        const total = Number(extracted?.metadata.pages) || undefined;
        if (total !== undefined) source.pages = total;
        for (const evidence of extracted?.evidence ?? []) {
          if (evidence.anchor?.kind === 'pdf')
            out.texts.set(`${source.ref}:${evidence.anchor.page}`, evidence.text);
        }
        const shown: CheckInputDrawing['shown'] = [];
        const pictures: RecordPicture[] = [];
        let left = 0;
        for (const page of list) {
          const image = pagePicture(page, source.name);
          if (total !== undefined && page.page > total)
            throw new Error(`Page ${page.page} does not exist in ${source.name}.`);
          const sourceText = out.texts.get(`${source.ref}:${page.page}`) ?? '';
          const runs = page.text.filter((run) => quoteOn(sourceText, run.text));
          out.runs.set(`${source.ref}:${page.page}`, runs);
          if (!fits(image)) {
            left++;
            continue;
          }
          const number = add(image);
          out.pictures.set(`${source.ref}:${page.page}`, {
            image,
            width: page.width,
            height: page.height,
          });
          shown.push({
            page: page.page,
            image: number,
            width: page.width,
            height: page.height,
            text: runs,
          });
          pictures.push(picture(image, number, page, page.page));
        }
        const unshown = (total ?? 0) - shown.length;
        const pictureNote = !list.length
          ? 'No page of it was drawn.'
          : unshown > 0
            ? `${unshown === 1 ? 'One page is' : `${unshown} pages are`} not shown${left ? ': the pictures would pass their limit' : ''}.`
            : undefined;
        const note = [pictureNote, extractionError].filter(Boolean).join(' ') || undefined;
        if (!shown.length) out.notSent.push(`${source.name}: ${note ?? 'no page was drawn'}`);
        out.drawings.push({
          ref: source.ref,
          pages: total ?? 0,
          shown,
          ...(note ? { note } : {}),
        });
        records.set(source.ref, {
          ...base,
          sha256: hash,
          sending: shown.length ? 'pages' : 'not sent',
          pictures,
          ...(note ? { note } : {}),
        });
        continue;
      }
      const data = await readListed(
        source.path,
        source.version,
        access,
        source.kind === 'dxf' ? DXF_MAX_BYTES : checkLimits.fileBytes,
      );
      const hash = sha256(data);
      if (source.kind === 'request') {
        const request = requestInput(source.ref, source.name, data);
        out.requests.push(request);
        out.texts.set(`${source.ref}:1`, requestText(request));
        records.set(source.ref, { ...base, sha256: hash, sending: 'text', pictures: [] });
      } else if (source.kind === 'photo') {
        const photo = await preparePhoto(
          source.path,
          data,
          this.ports.encodePhoto,
          this.ports.renderPhoto,
          signal,
        );
        if (!fits(photo.image)) {
          out.notSent.push(`${source.name}: the pictures would pass their limit.`);
          records.set(source.ref, { ...base, sha256: hash, sending: 'not sent', pictures: [] });
          continue;
        }
        const number = add(photo.image);
        out.pictures.set(source.ref, photo);
        out.photos.push({
          ref: source.ref,
          image: number,
          width: photo.width,
          height: photo.height,
        });
        records.set(source.ref, {
          ...base,
          sha256: hash,
          sending: 'picture',
          pictures: [picture(photo.image, number, photo)],
        });
      } else {
        const [{ decodeDXF }, { parseDrawing }, { measureDrawing, measurementSummary }] =
          await Promise.all([
            import('../../domain/previews/drawings/dxf/decode'),
            import('../../domain/previews/drawings/dxf/geometry'),
            import('../../domain/fabrication/measure'),
          ]);
        let outcome: MeasureOutcome;
        try {
          outcome = measureDrawing(parseDrawing(decodeDXF(data)));
        } catch (error) {
          outcome = { status: 'refused', reason: errorMessage(error) };
        }
        out.measured.set(source.ref, { name: source.name, outcome });
        const name = readJobName(source.name);
        out.dxf.push({
          ref: source.ref,
          name: {
            ...(name.part ? { part: name.part } : {}),
            ...(name.thickness ? { thickness: name.thickness.value } : {}),
            ...(name.quantity ? { quantity: name.quantity.value } : {}),
            notes: name.notes,
          },
          ...(outcome.status === 'measured'
            ? { measurement: measurementSummary(outcome.measurement) }
            : { refused: outcome.reason }),
        });
        records.set(source.ref, {
          ...base,
          sha256: hash,
          sending: 'measurement',
          pictures: [],
          ...(outcome.status === 'refused' ? { note: outcome.reason } : {}),
        });
      }
    }
    out.inputs = check.sources.map((source) => records.get(source.ref)!);
    return out;
  }

  /** The answer checked against the job: issues, grades, causes, the tour, outlines and
   * corrections. */
  private async verify(
    check: Check,
    answer: FabricationAnswer,
    inputs: Prepared,
    provider: ModelProvider | undefined,
    signal: AbortSignal,
    outlining = true,
  ): Promise<CheckResult> {
    const record = check.record!;
    const inventory = modelInventory(check.sources);
    const issues = answerIssues(answer, inventory);
    const job: GradeJob = {
      inventory,
      sources: check.sources,
      confirmations: check.confirmations,
      dxf: (ref) => inputs.measured.get(ref),
      text: (ref, page) => inputs.texts.get(`${ref}:${page}`) || undefined,
    };
    const [{ gradeFinding }, { reconcileJob }, { checkTour }, { correctionFor }, { sharedCauses }] =
      await Promise.all([
        import('../../domain/fabrication/grade'),
        import('../../domain/fabrication/reconcile'),
        import('../../domain/fabrication/tour'),
        import('../../domain/fabrication/correction'),
        import('../../domain/fabrication/causes'),
      ]);
    const grades = answer.findings.map((finding) => gradeFinding(finding, job));
    const measurement = (ref: string): Measurement | undefined => {
      const outcome = inputs.measured.get(ref)?.outcome;
      return outcome?.status === 'measured' ? outcome.measurement : undefined;
    };
    const reader = provider ? readerOf(provider) : check.record!.provider.name;
    const reconciled = reconcileJob({
      answer,
      sources: check.sources,
      reader,
      grading: job,
      pieces: (ref) => measurement(ref)?.outlines.length || undefined,
    });
    record.grades = [...grades, ...reconciled.findings.map((item) => item.grade)];
    const plans = answer.findings.map((finding, index) => {
      const measured = finding.dxf && measurement(finding.dxf.ref);
      return measured ? correctionFor(finding, grades[index]!, measured) : undefined;
    });
    const causes = sharedCauses(
      answer.findings.map((finding, index) => ({
        finding,
        grade: grades[index]!,
        ...(plans[index] ? { plan: plans[index] } : {}),
      })),
      measurement,
    );
    const ids = (readings: readonly number[]) =>
      readings.map((index) => answer.findings[index]!.id);
    record.causes = causes.map((cause) => ({
      finding: ids(cause.readings)[0]!,
      readings: ids(cause.readings),
      summary: cause.summary,
    }));
    const tour = checkTour({
      answer,
      sources: check.sources,
      grades,
      folder: check.folder,
      measurement,
      sha256: (ref) => inputs.inputs.find((item) => item.ref === ref)?.sha256,
      runs: (ref, page) => inputs.runs.get(`${ref}:${page}`),
      causes: causes.map((cause) => ({ readings: ids(cause.readings), grade: cause.grade })),
    });

    const previousOutlines = record.segmentation;
    record.segmentation = [];
    record.corrections = [];
    const segmenter =
      (provider && outlining ? this.ports.segmenter?.(provider) : undefined) ??
      boxSegmenter(reader);
    const features = tour.marks.filter((mark) => mark.kind === 'feature').length;
    if (outlining && features && segmenter.name)
      this.progress(check, {
        step: 'outlining',
        text: `${segmenter.name} is outlining ${countText(features, 'feature')}`,
      });
    const outlines = new Map<string, CheckOutline[]>();
    for (const mark of tour.marks) {
      const previous =
        !outlining && mark.kind === 'feature' && mark.asked
          ? previousOutlines.find(
              (outline) =>
                outline.kind === 'feature' &&
                outline.ref === mark.ref &&
                outline.page === mark.page &&
                isDeepStrictEqual(outline.box, mark.asked),
            )
          : undefined;
      const outlined = previous
        ? (({ ref: _ref, page: _page, ...outline }) => ({ ...outline, stop: mark.stop }))(previous)
        : await this.outline(mark, tour.stops, inputs, segmenter, reader, signal);
      if (!outlined) continue;
      if (previous) {
        const stop = tour.stops.find((stop) => stop.id === mark.stop);
        if (stop?.target.kind === 'file' && stop.target.anchor)
          place(stop.target.anchor, mark.at, previous.region);
      }
      record.segmentation.push({
        ...outlined,
        ref: mark.ref,
        ...(mark.page === undefined ? {} : { page: mark.page }),
      });
      if (mark.finding)
        outlines.set(mark.finding, [...(outlines.get(mark.finding) ?? []), outlined]);
    }

    const byRef = new Map(check.sources.map((source) => [source.ref, source]));
    const name = (ref?: string) => (ref ? byRef.get(ref)?.name : undefined);
    const known = (names: Record<string, string | undefined>) =>
      Object.fromEntries(
        Object.entries(names).filter(([, value]) => value),
      ) as CheckFinding['names'];
    const followers = new Set(causes.flatMap((cause) => cause.readings.slice(1)));
    const leading = new Map(causes.map((cause) => [cause.readings[0]!, cause]));
    const findings: CheckFinding[] = [];
    answer.findings.forEach((finding, index) => {
      if (followers.has(index)) return;
      const cause = leading.get(index);
      const plan = cause?.plan ?? plans[index];
      const dxf = finding.dxf && byRef.get(finding.dxf.ref);
      if (plan) record.corrections.push({ finding: finding.id, plan });
      findings.push({
        finding: cause ? { ...finding, summary: cause.summary } : finding,
        grade: cause?.grade ?? grades[index]!,
        origin: 'model',
        ...(cause
          ? {
              readings: cause.readings.map((reading) => ({
                finding: answer.findings[reading]!,
                grade: grades[reading]!,
              })),
            }
          : {}),
        names: known({
          drawing: name(finding.drawing?.ref),
          dxf: name(finding.dxf?.ref),
          photo: name(finding.photo?.ref),
        }),
        ...(plan && dxf
          ? {
              correction: {
                plan: { ...plan, review: { check: check.id, finding: finding.id } },
                source: dxf.path,
                version: dxf.version,
                name: correctedName(dxf.name),
              },
            }
          : {}),
        outlines: outlines.get(finding.id) ?? [],
      });
    });
    for (const item of reconciled.findings)
      findings.push({
        finding: item.finding,
        grade: item.grade,
        origin: 'viewer',
        ...(item.request ? { request: item.request } : {}),
        ...(item.question ? { question: item.question } : {}),
        ...(item.unread ? { unread: item.unread } : {}),
        names: known({ drawing: name(item.finding.drawing?.ref), dxf: name(item.part) }),
        outlines: [],
      });
    const definition = { version: 1 as const, name: check.job, stops: tour.stops };
    if (tour.stops.length && tourDefinitionSchema.safeParse(definition).success)
      check.tour = { root: check.folder, definition };
    record.tour = { stops: tour.stops.length, skipped: tour.skipped };
    return {
      kind: 'result',
      id: check.id,
      provider: provider
        ? { name: provider.name, model: providerModelID(provider.kind, provider.model) }
        : { name: record.provider.name, model: record.provider.model },
      summary: answer.summary,
      request: answer.request,
      findings,
      issues,
      tour: {
        name: check.job,
        root: check.folder,
        stops: check.tour ? tour.stops : [],
        skipped: tour.skipped,
      },
      parts: reconciled.parts,
      notSent: inputs.notSent,
      seconds: 0,
      requirements: enumerateRequirements(answer).map((claim) => ({
        claim,
        verification: verifyRequirement(claim, {
          source: check.sources.find((source) => source.ref === claim.ref),
          text: inputs.texts.get(`${claim.ref}:${claim.page}`),
          confirmation: check.confirmations.find((confirmation) => confirmation.key === claim.key),
        }),
      })),
    };
  }

  /** What a stop outlines: a text by its box, a feature by the segmenter from the picture the model
   * read, placed on the stop's anchor. */
  private async outline(
    mark: StopMark,
    stops: readonly TourStop[],
    inputs: Prepared,
    segmenter: Segmenter,
    reader: string,
    signal: AbortSignal,
  ): Promise<CheckOutline | undefined> {
    const stop = stops.find((item) => item.id === mark.stop);
    const anchor = stop?.target.kind === 'file' ? stop.target.anchor : undefined;
    if (!anchor) return undefined;
    const base = {
      stop: mark.stop,
      kind: mark.kind,
      ...(mark.asked ? { box: mark.asked } : {}),
      ...(mark.quote ? { quote: mark.quote } : {}),
    };
    if (mark.kind === 'text')
      return {
        ...base,
        source: mark.source,
        label: mark.source === 'page-text' ? pageTextLabel : modelBoxLabel(reader),
        region: boxRegion(mark.box),
      };
    const picture = inputs.pictures.get(
      mark.page === undefined ? mark.ref : `${mark.ref}:${mark.page}`,
    );
    if (!picture) return undefined;
    const outline = await segmenter.segment(picture, { kind: 'box', box: mark.box }, signal);
    if (!outline) return undefined;
    place(anchor, mark.at, outline.polygon);
    return {
      ...base,
      source: outline.source,
      label: outline.label,
      region: outline.polygon,
      ...(outline.confidence === undefined ? {} : { confidence: outline.confidence }),
      ...(outline.note ? { note: outline.note } : {}),
    };
  }
}

/** An outline put where a stop's anchor draws its mark. */
function place(anchor: EvidenceAnchor, at: StopMark['at'], polygon: EvidenceRegion): void {
  if (anchor.kind === 'image') anchor.polygon = polygon;
  else if (anchor.kind !== 'pdf') return;
  else if (at === 'region') anchor.region = polygon;
  else if (typeof at === 'number' && anchor.marks?.[at]) anchor.marks[at].region = polygon;
}

/** The provider a check asks first: a Meta model, else the one Ask uses, else any that takes
 * pictures. */
function defaultProvider(
  providers: readonly CheckProvider[],
  settings: ApplicationSettings,
): string | undefined {
  const usable = providers.filter((provider) => provider.pictures && provider.model);
  const kinds = new Map(settings.providers.map((provider) => [provider.id, provider.kind]));
  return (
    usable.find((provider) => kinds.get(provider.id) === 'meta') ??
    usable.find((provider) => provider.id === settings.prompts.providerID) ??
    usable[0]
  )?.id;
}
