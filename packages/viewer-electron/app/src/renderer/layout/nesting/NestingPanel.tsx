import { useCallback, useMemo, useState } from 'react';
import type { FileEntry } from '../../../domain/contracts';
import { errorMessage } from '../../../domain/errors';
import { nestingAdvice } from '../../../domain/layout/nesting/advice';
import { cuttingEstimate } from '../../../domain/layout/nesting/estimate';
import {
  countText,
  durationText,
  gapText,
  lengthText,
  moneyText,
  percentText,
  weightText,
} from '../../../domain/layout/nesting/format';
import { sheetLength, sheetWidth, type NestFormat } from '../../../domain/layout/nesting/nest';
import {
  cuttingPresets,
  nestingDefaults,
  rotationAngles,
  rotationLabels,
  sheetName,
  sheetPresets,
  type NestingTransform,
} from '../../../domain/layout/nesting/plan';
import {
  looserProblem,
  nestProblem,
  type PartChoice,
} from '../../../domain/layout/nesting/problem';
import { looserRotation } from '../../../domain/layout/nesting/plan';
import { packBoxes, type BoxEstimate } from '../../../domain/layout/nesting/rectangles';
import { verifyNest } from '../../../domain/layout/nesting/verify';
import { report, useViewer } from '../../state/store';
import { useWorkspace } from '../../workspace/context';
import { NestingSettings, type NestingChoices } from './NestingSettings';
import { PartList, partKey } from './PartList';
import type { PartView } from './protocol';
import { SheetView, type SheetPicture } from './SheetView';
import { useNestingFiles, type NestingFile } from './useNestingFiles';
import { useNestSearch } from './useNestSearch';
import './nesting.css';

interface Row {
  file: NestingFile;
  part: PartView;
  key: string;
}
const startPreset = cuttingPresets.findIndex(
  (preset) =>
    preset.material === 'Mild steel' && preset.process === 'fiber' && preset.thickness === 3,
);
const initialChoices: NestingChoices = {
  formats: sheetPresets.map((size) => ({
    ...size,
    enabled: size === nestingDefaults.sheet,
    price: 0,
  })),
  margin: nestingDefaults.margin,
  spacing: nestingDefaults.spacing,
  preset: startPreset,
  cutting: { ...cuttingPresets[startPreset]!, rate: 90, currency: '€' },
  budget: 15,
  labels: true,
};
const defaultChoice = (part: PartView): PartChoice => ({
  quantity: part.copies,
  rotation: 'quarter',
  mirror: false,
  grain: false,
});
const zooms = [1, 2, 4, 8];
/** "1250 × 2500", or with several formats, "2 × 1500 × 3000, 1 × 1250 × 2500". */
function formatsUsed(sheets: readonly NestFormat[]): string {
  const counts = new Map<string, number>();
  for (const sheet of sheets) counts.set(sheetName(sheet), (counts.get(sheetName(sheet)) ?? 0) + 1);
  return counts.size === 1
    ? [...counts.keys()][0]!
    : [...counts].map(([name, count]) => `${count} × ${name}`).join(', ');
}
/** The freedom loosened parts would gain, when they would all gain the same. */
function looserLabel(loosened: readonly PartChoice[]): string {
  const next = new Set(loosened.map((choice) => looserRotation[choice.rotation]));
  const [only] = next;
  return next.size === 1 && only ? rotationLabels[only] : 'finer steps';
}

/** Nesting DXF parts on stock sheets, inside the Layout plane (docs/guides/layout.md). */
export function NestingPanel({ files }: { files: FileEntry[] }) {
  const drawings = useMemo(
    () => files.filter((file) => !file.directory && /\.dxf$/i.test(file.name)),
    [files],
  );
  const { files: read, configure } = useNestingFiles(drawings);
  const [chosen, setChosen] = useState<ReadonlyMap<string, PartChoice>>(new Map());
  const [settings, setSettings] = useState(initialChoices);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState<{ job?: string; error?: string; busy?: boolean }>({});
  const jobs = useViewer((state) => state.jobs);
  const workspace = useWorkspace();

  const rows = useMemo<Row[]>(
    () =>
      read.flatMap((file) =>
        file.status === 'ready' && file.parts
          ? file.parts.parts.map((part) => ({ file, part, key: partKey(file, part.index) }))
          : [],
      ),
    [read],
  );
  const choices = useMemo(
    () => new Map(rows.map((row) => [row.key, chosen.get(row.key) ?? defaultChoice(row.part)])),
    [rows, chosen],
  );
  const choose = useCallback(
    (key: string, patch: Partial<PartChoice>) =>
      setChosen((current) => {
        const row = rows.find((item) => item.key === key);
        if (!row) return current;
        return new Map(current).set(key, {
          ...(current.get(key) ?? defaultChoice(row.part)),
          ...patch,
        });
      }),
    [rows],
  );
  const active = useMemo(
    () => rows.filter((row) => choices.get(row.key)!.quantity > 0),
    [rows, choices],
  );
  const enabled = useMemo(
    () => settings.formats.filter((format) => format.enabled),
    [settings.formats],
  );
  const formats = useMemo<NestFormat[]>(
    () =>
      enabled.map((format) => ({
        width: format.width,
        height: format.height,
        price: format.price,
        ...(format.stock === undefined ? {} : { stock: format.stock }),
      })),
    [enabled],
  );
  const problem = useMemo(
    () =>
      active.length && formats.length
        ? nestProblem(
            active.map((row) => ({ part: row.part, choice: choices.get(row.key)! })),
            formats,
            { margin: settings.margin, spacing: settings.spacing },
          )
        : undefined,
    [active, choices, formats, settings.margin, settings.spacing],
  );
  const looser = useMemo(
    () =>
      problem
        ? looserProblem(
            problem,
            active.map((row) => choices.get(row.key)!),
          )
        : undefined,
    [problem, active, choices],
  );
  const boxes = useMemo<BoxEstimate[]>(
    () =>
      problem
        ? formats.map((format) =>
            packBoxes(
              active.map((row) => {
                const choice = choices.get(row.key)!;
                return {
                  width: row.part.width,
                  height: row.part.height,
                  area: row.part.area,
                  quantity: choice.quantity,
                  turn: rotationAngles(choice.rotation, choice.grain).includes(90),
                };
              }),
              format,
              settings.margin,
              settings.spacing,
            ),
          )
        : [],
    [problem, formats, active, choices, settings.margin, settings.spacing],
  );
  const search = useNestSearch(problem, looser?.problem, settings.budget * 1000);
  const best = search.update?.best;
  const settled = search.status === 'done' || search.status === 'stopped';
  const verification = useMemo(
    () => (problem && best && settled ? verifyNest(problem, best.layout.sheets) : undefined),
    [problem, best, settled],
  );
  const names = useMemo(() => active.map((row) => row.part.name), [active]);
  const advice = useMemo(
    () =>
      problem
        ? nestingAdvice({
            names,
            parts: problem.parts,
            formats,
            margin: settings.margin,
            best,
            single: search.update?.formats ?? [],
            boxes,
            looser:
              looser && search.update?.looser
                ? {
                    summary: search.update.looser,
                    loosened: looser.loosened,
                    rotation: looserLabel(
                      looser.loosened.map((index) => choices.get(active[index]!.key)!),
                    ),
                  }
                : undefined,
            currency: settings.cutting.currency,
          })
        : [],
    [
      problem,
      names,
      formats,
      settings.margin,
      best,
      search.update,
      boxes,
      looser,
      choices,
      active,
      settings.cutting.currency,
    ],
  );

  // What the views show: the true-shape layout once there is one, else the cheapest box packing.
  const boxFormat = boxes.reduce<number | undefined>((pick, estimate, index) => {
    if (pick === undefined) return index;
    const a = boxes[pick]!;
    const left = (e: BoxEstimate) => e.unplaced.reduce((sum, count) => sum + count, 0);
    const material = (e: BoxEstimate, at: number) =>
      e.sheets.length * formats[at]!.width * formats[at]!.height;
    return left(estimate) < left(a) ||
      (left(estimate) === left(a) && material(estimate, index) < material(a, pick))
      ? index
      : pick;
  }, undefined);
  const pictures: SheetPicture[] = best
    ? best.layout.sheets.map((sheet, index) => {
        const format = formats[sheet.format]!;
        return {
          length: sheetLength(format),
          width: sheetWidth(format),
          margin: settings.margin,
          title: `Sheet ${index + 1} · ${sheetName(format)} · ${percentText(sheet.area / (format.width * format.height))} used · ${countText(sheet.placements.length, 'part')}`,
          placements: sheet.placements,
        };
      })
    : boxFormat !== undefined
      ? boxes[boxFormat]!.sheets.map((sheet, index) => {
          const format = formats[boxFormat]!;
          return {
            length: sheetLength(format),
            width: sheetWidth(format),
            margin: settings.margin,
            title: `Boxes estimate, sheet ${index + 1} · ${sheetName(format)}`,
            boxes: sheet.placements.map((box) => ({
              ...box,
              width: active[box.part]!.part.width,
              height: active[box.part]!.part.height,
            })),
          };
        })
      : [];
  const placedCounts = useMemo(() => {
    const counts = active.map(() => 0);
    if (best)
      for (const sheet of best.layout.sheets) for (const p of sheet.placements) counts[p.part]!++;
    return counts;
  }, [active, best]);
  const placed = useMemo(
    () => new Map(best ? active.map((row, index) => [row.key, placedCounts[index]!]) : []),
    [active, best, placedCounts],
  );
  const estimate = useMemo(() => {
    const sheets = best
      ? best.layout.sheets.map((sheet) => formats[sheet.format]!)
      : boxFormat !== undefined
        ? boxes[boxFormat]!.sheets.map(() => formats[boxFormat]!)
        : [];
    return cuttingEstimate(
      active.map((row, index) => ({
        ...row.part,
        quantity: best ? placedCounts[index]! : choices.get(row.key)!.quantity,
      })),
      sheets,
      settings.cutting,
    );
  }, [best, formats, boxFormat, boxes, active, placedCounts, choices, settings.cutting]);
  const requested = active.reduce((sum, row) => sum + choices.get(row.key)!.quantity, 0);
  const last = best?.layout.sheets.at(-1);
  const remnant = last
    ? Math.max(
        0,
        sheetLength(formats[last.format]!) - settings.margin - last.used - settings.spacing,
      )
    : 0;

  const title = `Nesting of ${countText(active.length, 'part')}`;
  const job = jobs.find((item) => item.id === saving.job);
  const save = async () => {
    if (!best || !problem) return;
    const used = read.filter((file) => active.some((row) => row.file.key === file.key));
    const source = new Map(used.map((file, index) => [file.key, index]));
    const plan: NestingTransform = {
      kind: 'nesting',
      format: 'dxf',
      title,
      sources: used.map((file) => ({
        units: file.units,
        together: file.together,
        marks: file.marks,
      })),
      parts: active.map((row) => ({
        source: source.get(row.file.key)!,
        index: row.part.index,
        name: row.part.name,
        quantity: choices.get(row.key)!.quantity,
        width: row.part.width,
        height: row.part.height,
        area: row.part.area,
      })),
      formats: formats.map((format) => ({
        width: format.width,
        height: format.height,
        price: format.price,
      })),
      sheets: best.layout.sheets.map((sheet) => ({
        format: sheet.format,
        placements: sheet.placements,
      })),
      margin: settings.margin,
      spacing: settings.spacing,
      cutting: settings.cutting,
      labels: settings.labels,
    };
    setSaving({ busy: true });
    try {
      const id = await window.viewer.operate({
        kind: 'convert',
        sources: used.map((file) => file.entry.path),
        destination: used[0]!.entry.parent,
        name: title,
        transform: plan,
        expectedSources: used.map((file) => ({ path: file.entry.path, version: file.version! })),
      });
      setSaving({ job: id });
    } catch (error) {
      setSaving({ error: errorMessage(error) });
    }
  };

  // a search that ends at once reads as such, not as 0.0 s
  const seconds = (milliseconds: number) =>
    milliseconds < 100 ? 'under 0.1 s' : `${(milliseconds / 1000).toFixed(1)} s`;
  const status =
    search.status === 'waiting'
      ? 'Nesting true shapes…'
      : search.status === 'searching'
        ? `Nesting true shapes… ${search.update ? `${(search.update.elapsed / 1000).toFixed(1)} s, ${countText(search.update.passes, 'layout')} tried` : ''}`
        : search.status === 'done'
          ? `Best of ${countText(search.update?.passes ?? 0, 'layout')} in ${seconds(search.update?.elapsed ?? 0)}.`
          : search.status === 'stopped'
            ? `Stopped. Best of ${countText(search.update?.passes ?? 0, 'layout')} so far.`
            : search.status === 'failed'
              ? search.error
              : '';
  const reading = read.filter((file) => file.status === 'reading').length;
  return (
    <div className="nesting-panel">
      <aside className="nesting-sidebar">
        {!drawings.length && <p className="muted">Select DXF drawings to nest.</p>}
        <PartList
          files={read}
          choices={choices}
          choose={choose}
          configure={configure}
          placed={placed}
        />
        <NestingSettings
          choices={settings}
          change={(patch) => setSettings((current) => ({ ...current, ...patch }))}
        />
      </aside>
      <main className="nesting-main">
        <section className="nesting-summary" aria-live="polite" aria-label="Nesting summary">
          {reading > 0 && <p className="muted">Reading {countText(reading, 'drawing')}…</p>}
          {problem ? (
            <>
              <h2>
                {best
                  ? countText(best.sheets, 'sheet')
                  : boxFormat !== undefined
                    ? `About ${countText(boxes[boxFormat]!.sheets.length, 'sheet')}`
                    : ''}
                {best
                  ? ` · ${formatsUsed(best.layout.sheets.map((sheet) => formats[sheet.format]!))} mm`
                  : boxFormat !== undefined
                    ? ` · ${sheetName(formats[boxFormat]!)} mm`
                    : ''}
              </h2>
              <p className="nesting-figures">
                {best && <span>{percentText(best.utilisation)} used</span>}
                <span>
                  {best ? best.placed : requested} of {countText(requested, 'part')}
                </span>
                <span>{lengthText(estimate.cutLength)} cut</span>
                <span>{countText(estimate.pierces, 'pierce')}</span>
                <span>{durationText(estimate.minutes)}</span>
                <span>{moneyText(estimate.total, settings.cutting.currency)}</span>
                {settings.cutting.density > 0 && estimate.partWeight > 0 && (
                  <span>{weightText(estimate.partWeight)} of parts</span>
                )}
              </p>
              {best && last && remnant > 0 && (
                <p className="muted">
                  Remnant on sheet {best.sheets}:{' '}
                  {sheetWidth(formats[last.format]!).toLocaleString('en')} ×{' '}
                  {Math.round(remnant).toLocaleString('en')} mm
                </p>
              )}
              <div className="nesting-status">
                <span className={search.status === 'failed' ? 'nesting-problem' : 'muted'}>
                  {best ? status : `Boxes estimate. ${status}`}
                </span>
                {verification && (
                  <span className={verification.ok ? 'muted' : 'nesting-problem'}>
                    {verification.ok
                      ? Number.isFinite(verification.closest)
                        ? `Checked: parts at least ${gapText(verification.closest)} apart, inside the margin.`
                        : 'Checked: every part inside the margin.'
                      : verification.problems[0]}
                  </span>
                )}
                {(search.status === 'searching' || search.status === 'waiting') && (
                  <button type="button" onClick={search.stop}>
                    Stop
                  </button>
                )}
                {settled && (
                  <button type="button" onClick={search.longer}>
                    Search longer
                  </button>
                )}
                <button
                  type="button"
                  className="primary"
                  disabled={!best || !!saving.busy || (verification && !verification.ok)}
                  onClick={() => void save()}
                >
                  Save nesting
                </button>
              </div>
              {saving.error && (
                <p className="nesting-problem" role="alert">
                  {saving.error}
                </p>
              )}
              {job && (
                <p className="nesting-saved">
                  {job.status === 'running' || job.status === 'queued'
                    ? `${Math.round((job.progress || 0) * 100)}% · ${job.detail || 'Saving…'}`
                    : job.status === 'completed'
                      ? `Saved ${title}.`
                      : `${job.status}${job.errors[0] ? `: ${job.errors[0].message}` : ''}`}
                  {job.completed
                    .filter((item) => item.destination)
                    .map((item) => (
                      <button
                        type="button"
                        key={item.destination}
                        onClick={() =>
                          void workspace
                            .openPath(item.destination!, { activate: true })
                            .catch(report)
                        }
                      >
                        Open folder
                      </button>
                    ))}
                </p>
              )}
              {advice.length > 0 && (
                <ul className="nesting-advice" aria-label="Advice">
                  {advice.map((item) => (
                    <li key={item.text} className={`nesting-advice-${item.tone}`}>
                      {item.text}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            !reading && (
              <p className="muted">Give at least one part a quantity and choose a sheet.</p>
            )
          )}
        </section>
        {pictures.length > 0 && (
          <section className="nesting-sheets" aria-label="Sheets">
            <div className="nesting-zoom" role="group" aria-label="Zoom">
              {zooms.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={zoom === value}
                  onClick={() => setZoom(value)}
                >
                  {value === 1 ? 'Fit' : `${value}×`}
                </button>
              ))}
            </div>
            {pictures.map((picture, index) => (
              <SheetView
                key={index}
                sheet={picture}
                parts={active.map((row) => row.part)}
                zoom={zoom}
              />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
