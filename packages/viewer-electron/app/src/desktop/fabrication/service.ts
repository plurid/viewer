/**
 * THE FABRICATION CHECK: a job folder or selection read as an inventory of opaque refs, one model
 * call at the `images` data level with the request's text, the drawings' pages and the photos as
 * pictures and Viewer's measurement of each DXF, then the answer checked: refs and pages validated,
 * every finding graded against Viewer's own measurement and page text, the tour built and confirmed
 * pitch findings turned into reviewed corrections. Its record stays in memory until a handoff
 * writes it. A check belongs to the window that opened it (docs/reference/fabrication.md).
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ApplicationSettings, ModelProvider } from '../../domain/services';
import type { FileEntry } from '../../domain/contracts';
import type { ModelDataPermission } from '../../domain/models/permissions';
import type { ModelImage } from '../../domain/models/images';
import type { SegmentationPicture } from '../../domain/models/segmentation';
import type { InventorySource, FabricationAnswer } from '../../domain/fabrication/answer';
import type { GradeJob } from '../../domain/fabrication/grade';
import type { MeasureOutcome, Measurement } from '../../domain/fabrication/measure';
import type {
  CheckFinding,
  CheckOpening,
  CheckProvider,
  CheckRecord,
  CheckResult,
  CheckSending,
  CheckSource,
  FabricationReply,
  FabricationRequest,
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
import type { TourDefinition, TourStop } from '../../domain/tours/tour';
import type { Providers } from '../models/providers';
import type { Segmenter } from '../models/segmentation';
import type { HandoffCheck } from './handoff';
import type { PhotoEncoder, PhotoRenderer } from './inputs';
import {
  answerIssues,
  buildInventory,
  fabricationAnswerSchema,
  modelInventory,
} from '../../domain/fabrication/answer';
import { checkFileKind, checkLimits } from '../../domain/fabrication/check';
import {
  checkAnswerSchema,
  checkInput,
  checkInstructions,
  pageText,
} from '../../domain/fabrication/prompt';
import { correctedName, correctionDescription } from '../../domain/fabrication/plan';
import { readJobName } from '../../domain/fabrication/names';
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
import { regionBounds } from '../../domain/files/regions';
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
  settings(): ApplicationSettings;
  access(files: readonly string[]): Promise<void>;
  permission(provider: ModelProvider): Promise<ModelDataPermission | null>;
  generate: Providers['generate'];
  encodePhoto: PhotoEncoder;
  renderPhoto?: PhotoRenderer;
  /** What outlines a finding's region for the provider asked; its box unless given. */
  segmenter?(provider: ModelProvider): Segmenter | undefined;
  now?(): number;
}
interface Check {
  id: string;
  owner: number;
  folder: string;
  job: string;
  sources: InventorySource[];
  running?: AbortController;
  result?: CheckResult;
  record?: CheckRecord;
  tour?: { root: string; definition: TourDefinition };
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
  measured: Map<string, { name: string; outcome: MeasureOutcome }>;
  inputs: RecordInput[];
  notSent: string[];
}

const sendings: Record<InventorySource['kind'], CheckSending> = {
  request: 'text',
  drawing: 'pages',
  photo: 'picture',
  dxf: 'measurement',
};
/** Open checks, oldest closed first past this. */
const openLimit = 16;
const seconds = (milliseconds: number) => Math.round(milliseconds / 100) / 10;

export class FabricationChecks {
  private checks = new Map<string, Check>();
  constructor(private ports: FabricationPorts) {}
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  async request(request: FabricationRequest, owner: number): Promise<FabricationReply> {
    switch (request.kind) {
      case 'open':
        return this.open(request.paths, owner);
      case 'run':
        return this.run(request.id, request.providerID, request.pages, owner);
      case 'cancel':
        this.own(request.id, owner).running?.abort();
        return { kind: 'done' };
      case 'close': {
        const check = this.checks.get(request.id);
        if (check?.owner === owner) {
          check.running?.abort();
          this.checks.delete(check.id);
        }
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
  /** A window's checks end with it. */
  stopOwner(owner: number): void {
    for (const check of [...this.checks.values()])
      if (check.owner === owner) {
        check.running?.abort();
        this.checks.delete(check.id);
      }
  }
  close(): void {
    for (const check of this.checks.values()) check.running?.abort();
    this.checks.clear();
  }
  private own(id: string, owner: number): Check {
    const check = this.checks.get(id);
    if (!check || check.owner !== owner)
      throw new Error('This check was closed. Check the job again.');
    return check;
  }

  /** The inventory of a job folder or selection, and the providers that could read it. */
  private async open(paths: readonly string[], owner: number): Promise<CheckOpening> {
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
    const files = fromFolder
      ? (await list(folder)).entries.filter((file) => !file.hidden && !file.directory)
      : chosen;
    const skipped: CheckOpening['skipped'] = [];
    const listed: Parameters<typeof buildInventory>[0][number][] = [];
    let photos = 0;
    for (const file of files) {
      const kind = checkFileKind(file.name);
      if (file.directory)
        skipped.push({ name: file.name, reason: 'a folder; the check reads files' });
      else if (!kind)
        skipped.push({ name: file.name, reason: 'not a request, drawing, photo or DXF' });
      else if (file.kind !== 'file') skipped.push({ name: file.name, reason: 'a link' });
      else if (kind === 'photo' && ++photos > checkLimits.photos)
        skipped.push({
          name: file.name,
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
    const sources = buildInventory(listed);
    if (!sources.some((source) => source.kind === 'dxf'))
      throw new Error(
        'A check compares the request and drawings with the DXF parts, and this job has no DXF.',
      );
    if (!sources.some((source) => source.kind === 'request' || source.kind === 'drawing'))
      throw new Error(
        'A check compares the DXF parts with a request or drawing, and this job has neither.',
      );
    const id = randomUUID();
    const job = path.basename(folder) || folder;
    if (this.checks.size >= openLimit) {
      const [oldest] = this.checks.values();
      oldest!.running?.abort();
      this.checks.delete(oldest!.id);
    }
    this.checks.set(id, { id, owner, folder, job, sources });
    const providers = await this.providers();
    const providerID = defaultProvider(providers, this.ports.settings());
    return {
      kind: 'opened',
      id,
      folder,
      job,
      sources: sources.map((source): CheckSource => ({
        ref: source.ref,
        kind: source.kind,
        name: source.name,
        path: source.path,
        version: source.version,
        sending: sendings[source.kind],
      })),
      skipped,
      providers,
      ...(providerID ? { providerID } : {}),
    };
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

  private async run(
    id: string,
    providerID: string,
    pages: readonly RenderedPage[],
    owner: number,
  ): Promise<CheckResult> {
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
    if (!modelPermissionCovers(permission, provider, 'images'))
      throw new Error(
        permission
          ? `${provider.name} may receive ${modelDataLabels[permission.level]}. This check also sends pictures: allow ${modelDataLabels.images} for ${provider.name}.`
          : `${provider.name} may not receive file data yet. Allow ${modelDataLabels.images} for ${provider.name} to check this job.`,
      );
    const abort = new AbortController();
    check.running = abort;
    check.result = undefined;
    check.tour = undefined;
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
      corrections: [],
      tour: { stops: 0, skipped: [] },
      timings: { prepare: 0, model: 0, check: 0, total: 0 },
    };
    check.record = record;
    let prepared: number | undefined, answered: number | undefined;
    try {
      const inputs = await this.prepare(check, pages, signal);
      record.inputs = inputs.inputs;
      prepared = this.now();
      const raw = await this.ports.generate(
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
        { images: inputs.images },
      );
      answered = this.now();
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
      const result = await this.verify(check, parsed.data, inputs, provider, signal);
      record.validation = { valid: true, issues: result.issues };
      result.seconds = seconds(this.now() - started);
      check.result = result;
      return result;
    } catch (error) {
      record.error = signal.aborted ? 'The check was cancelled.' : errorMessage(error);
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
        const shown: CheckInputDrawing['shown'] = [];
        const pictures: RecordPicture[] = [];
        let left = 0;
        for (const page of list) {
          const image = pagePicture(page, source.name);
          out.texts.set(`${source.ref}:${page.page}`, pageText(page.text));
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
            text: page.text,
          });
          pictures.push(picture(image, number, page, page.page));
        }
        const total = list[0]?.pages;
        if (total !== undefined) source.pages = total;
        const unshown = (total ?? 0) - shown.length;
        const note = !list.length
          ? 'No page of it was drawn.'
          : unshown > 0
            ? `${unshown === 1 ? 'One page is' : `${unshown} pages are`} not shown${left ? ': the pictures would pass their limit' : ''}.`
            : undefined;
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

  /** The answer checked against the job: issues, grades, the tour, outlines and corrections. */
  private async verify(
    check: Check,
    answer: FabricationAnswer,
    inputs: Prepared,
    provider: ModelProvider,
    signal: AbortSignal,
  ): Promise<CheckResult> {
    const record = check.record!;
    const inventory = modelInventory(check.sources);
    const issues = answerIssues(answer, inventory);
    const job: GradeJob = {
      inventory,
      dxf: (ref) => inputs.measured.get(ref),
      text: (ref, page) => inputs.texts.get(`${ref}:${page}`) || undefined,
    };
    const { gradeFinding } = await import('../../domain/fabrication/grade');
    const { reconcileJob } = await import('../../domain/fabrication/reconcile');
    const { checkTour } = await import('../../domain/fabrication/tour');
    const { correctionFor } = await import('../../domain/fabrication/correction');
    const grades = answer.findings.map((finding) => gradeFinding(finding, job));
    const measurement = (ref: string): Measurement | undefined => {
      const outcome = inputs.measured.get(ref)?.outcome;
      return outcome?.status === 'measured' ? outcome.measurement : undefined;
    };
    const reconciled = reconcileJob({
      answer,
      sources: check.sources,
      grading: job,
      pieces: (ref) => measurement(ref)?.outlines.length || undefined,
    });
    record.grades = [...grades, ...reconciled.findings.map((item) => item.grade)];
    const tour = checkTour({
      answer,
      sources: check.sources,
      grades,
      folder: check.folder,
      measurement,
      sha256: (ref) => inputs.inputs.find((item) => item.ref === ref)?.sha256,
    });
    const byRef = new Map(check.sources.map((source) => [source.ref, source]));
    const outlines = new Map<string, CheckFinding['outlines']>();
    const reader = providerPresets[provider.kind].family ?? provider.name;
    const segmenter = this.ports.segmenter?.(provider) ?? boxSegmenter(reader);
    for (const stop of tour.stops) {
      const outlined = await this.outline(stop, answer, inputs, segmenter, signal);
      if (!outlined) continue;
      record.segmentation.push(outlined);
      if (!stop.finding) continue;
      outlines.set(stop.finding.id, [...(outlines.get(stop.finding.id) ?? []), outlined]);
    }
    const findings: CheckFinding[] = answer.findings.map((finding, index) => {
      const grade = grades[index]!;
      const name = (ref?: string) => (ref ? byRef.get(ref)?.name : undefined);
      const dxf = finding.dxf && byRef.get(finding.dxf.ref);
      const measured = finding.dxf && measurement(finding.dxf.ref);
      const plan = dxf && measured ? correctionFor(finding, grade, measured) : undefined;
      if (plan) record.corrections.push({ finding: finding.id, plan });
      const names = {
        drawing: name(finding.drawing?.ref),
        dxf: name(finding.dxf?.ref),
        photo: name(finding.photo?.ref),
      };
      return {
        finding,
        grade,
        origin: 'model',
        names: Object.fromEntries(Object.entries(names).filter(([, value]) => value)),
        ...(plan && dxf
          ? {
              correction: {
                plan,
                source: dxf.path,
                version: dxf.version,
                name: correctedName(dxf.name),
                description: correctionDescription(plan),
              },
            }
          : {}),
        outlines: outlines.get(finding.id) ?? [],
      };
    });
    for (const item of reconciled.findings)
      findings.push({
        finding: item.finding,
        grade: item.grade,
        origin: 'viewer',
        ...(item.request ? { request: item.request } : {}),
        ...(item.question ? { question: item.question } : {}),
        names: Object.fromEntries(
          [
            ['drawing', item.finding.drawing && byRef.get(item.finding.drawing.ref)?.name],
            ['dxf', byRef.get(item.part)?.name],
          ].filter(([, value]) => value),
        ),
        outlines: [],
      });
    const definition = { version: 1 as const, name: check.job, stops: tour.stops };
    if (tour.stops.length && tourDefinitionSchema.safeParse(definition).success)
      check.tour = { root: check.folder, definition };
    record.tour = { stops: tour.stops.length, skipped: tour.skipped };
    return {
      kind: 'result',
      id: check.id,
      provider: { name: provider.name, model: providerModelID(provider.kind, provider.model) },
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
    };
  }

  /** A stop's region outlined by the segmenter, from the picture the model read and its box. */
  private async outline(
    stop: TourStop,
    answer: FabricationAnswer,
    inputs: Prepared,
    segmenter: Segmenter,
    signal: AbortSignal,
  ) {
    if (stop.target.kind !== 'file') return undefined;
    const anchor = stop.target.anchor;
    const asked = answer.tour[Number(stop.id.replace(/^stop-/, '')) - 1];
    if (!asked) return undefined;
    const region =
      anchor?.kind === 'pdf' && anchor.region
        ? {
            picture: inputs.pictures.get(`${asked.ref}:${anchor.page}`),
            box: regionBounds(anchor.region),
          }
        : anchor?.kind === 'image'
          ? { picture: inputs.pictures.get(asked.ref), box: anchor }
          : undefined;
    if (!region?.picture || !anchor) return undefined;
    const { x, y, width, height } = region.box;
    const outline = await segmenter.segment(
      region.picture,
      { kind: 'box', box: { x, y, width, height } },
      signal,
    );
    if (!outline) return undefined;
    if (anchor.kind === 'pdf') anchor.region = outline.polygon;
    else if (anchor.kind === 'image') anchor.polygon = outline.polygon;
    return {
      stop: stop.id,
      ref: asked.ref,
      source: outline.source,
      label: outline.label,
      ...(outline.confidence === undefined ? {} : { confidence: outline.confidence }),
      ...(outline.note ? { note: outline.note } : {}),
    };
  }
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
