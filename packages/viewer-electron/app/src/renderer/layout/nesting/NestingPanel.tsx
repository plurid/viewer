import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileEntry } from '../../../domain/contracts';
import type { GroupFigures } from '../../../domain/fabrication/jobs';
import { errorMessage } from '../../../domain/errors';
import { boxFigures, cuttingFor, fileQuantity } from '../../../domain/fabrication/jobs';
import { groupByThickness, thicknessText } from '../../../domain/fabrication/names';
import { nestingAdvice } from '../../../domain/layout/nesting/advice';
import { cuttingEstimate } from '../../../domain/layout/nesting/estimate';
import type { NestFormat } from '../../../domain/layout/nesting/nest';
import type { LengthUnit, NestingTransform } from '../../../domain/layout/nesting/plan';
import {
  countText,
  durationText,
  gapText,
  lengthText,
  moneyText,
  percentText,
  sizeText,
  unitSymbol,
  weightText,
} from '../../../domain/layout/nesting/format';
import { sheetLength, sheetWidth } from '../../../domain/layout/nesting/nest';
import {
  cuttingPresets,
  defaultSheet,
  inchSheetPresets,
  nestingDefaults,
  rotationAngles,
  rotationLabels,
  sheetAllowance,
  sheetName,
  sheetPresets,
} from '../../../domain/layout/nesting/plan';
import {
  looserProblem,
  nestProblem,
  type PartChoice,
} from '../../../domain/layout/nesting/problem';
import { looserRotation } from '../../../domain/layout/nesting/plan';
import { packBoxes, type BoxEstimate } from '../../../domain/layout/nesting/rectangles';
import { offcutText } from '../../../domain/layout/nesting/report';
import { verifyNest } from '../../../domain/layout/nesting/verify';
import { changePreferences, report, useViewer } from '../../state/store';
import { IconButton } from '../../ui/primitives';
import { useWorkspace } from '../../workspace/context';
import type { FormatChoice, NestingChoices } from './NestingSettings';
import type { SheetPicture } from './SheetView';
import { NestingSettings } from './NestingSettings';
import { PartList, partKey } from './PartList';
import type { PartView } from './protocol';
import type { ThicknessTab } from './ThicknessGroups';
import { PartThumbnail, SheetView } from './SheetView';
import { ThicknessGroups } from './ThicknessGroups';
import { useNestingFiles, type NestingFile } from './useNestingFiles';
import { useNestSearch } from './useNestSearch';
import { prepareNesting } from './prepared';
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
/** Every preset in both units, the unit's usual sheet chosen; removed ones keep their stock. */
const startingFormats = (units: LengthUnit): FormatChoice[] =>
  [...sheetPresets, ...inchSheetPresets].map((size) => ({
    ...size,
    enabled: size === defaultSheet(units),
    price: 0,
  }));
const initialChoices = (units: LengthUnit): NestingChoices => ({
  formats: startingFormats(units),
  margin: nestingDefaults.margin,
  spacing: nestingDefaults.spacing,
  direction: 'compact',
  preset: startPreset,
  cutting: { ...cuttingPresets[startPreset]!, rate: 90, currency: '€' },
  budget: 15,
  labels: true,
});
/** Choices in other units: formats still as they started change to the new unit's usual sheet. */
function inUnits(choices: NestingChoices, from: LengthUnit, to: LengthUnit): NestingChoices {
  const untouched = choices.formats.every(
    (format, index) =>
      format.enabled === (startingFormats(from)[index]?.enabled ?? false) &&
      !format.custom &&
      format.stock === undefined &&
      format.price === 0,
  );
  return untouched ? { ...choices, formats: startingFormats(to) } : choices;
}
/** A part starts with its file's quantity in sets of the drawing, or the copies drawn. */
export const defaultChoice = (part: PartView, sets?: number): PartChoice => ({
  quantity: (sets ?? 1) * part.copies,
  rotation: 'quarter',
  mirror: false,
  grain: false,
});
/** What a thickness starts with: the cutting values for it, when its names give it, with the
 * spacing and margin they need. */
export function startingChoices(thickness?: number, units: LengthUnit = 'mm'): NestingChoices {
  const initial = initialChoices(units);
  if (thickness === undefined) return initial;
  const { preset, cutting } = cuttingFor(thickness, initial.cutting);
  return { ...initial, preset, cutting, ...sheetAllowance(cutting.process, cutting.thickness) };
}
const piecesLeft = (estimate: BoxEstimate) =>
  estimate.unplaced.reduce((sum, count) => sum + count, 0);
const zooms = [1, 2, 4, 8];
/** "1250 × 2500 mm", or with several formats, "2 × 1500 × 3000, 1 × 1250 × 2500 mm". */
function formatsUsed(sheets: readonly NestFormat[], units: LengthUnit): string {
  const counts = new Map<string, number>();
  for (const sheet of sheets) {
    const name = sheetName(sheet, units);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return (
    (counts.size === 1
      ? [...counts.keys()][0]!
      : [...counts].map(([name, count]) => `${count} × ${name}`).join(', ')) +
    ` ${unitSymbol(units)}`
  );
}
/** "Sheet 2", "Sheets 1 and 3", "Sheets 1, 2 and 4". */
function sheetsText(numbers: readonly number[]): string {
  if (numbers.length === 1) return `Sheet ${numbers[0]}`;
  return `Sheets ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}
/** The freedom loosened parts would gain, when they would all gain the same. */
function looserLabel(loosened: readonly PartChoice[]): string {
  const next = new Set(loosened.map((choice) => looserRotation[choice.rotation]));
  const [only] = next;
  return next.size === 1 && only ? rotationLabels[only] : 'finer steps';
}

/**
 * Nesting DXF parts on stock sheets, inside the Layout plane (docs/guides/layout.md). Parts whose
 * names give different thicknesses are nested one thickness at a time, each with its own sheets and
 * cutting values; `quantities` are pieces by path, given when the plane was opened.
 */
export function NestingPanel({
  files,
  quantities,
  thicknesses,
  paneID,
}: {
  files: FileEntry[];
  quantities?: Readonly<Record<string, number>>;
  /** Millimetres by path, as a request gives them; they group a drawing before its name. */
  thicknesses?: Readonly<Record<string, number>>;
  /** The Layout plane, which a drawing opened from a sheet links from. */
  paneID?: string;
}) {
  const drawings = useMemo(
    () => files.filter((file) => !file.directory && /\.dxf$/i.test(file.name)),
    [files],
  );
  const { files: read, configure } = useNestingFiles(drawings);
  const [chosen, setChosen] = useState<ReadonlyMap<string, PartChoice>>(new Map());
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState<{ job?: string; error?: string; busy?: boolean }>({});
  const jobs = useViewer((state) => state.jobs);
  const units = useViewer((state) => state.saved.ui.layout.units);
  const workspace = useWorkspace();

  const groups = useMemo(
    () =>
      groupByThickness(
        drawings,
        (file) => file.name,
        (file) => thicknesses?.[file.path],
      ),
    [drawings, thicknesses],
  );
  const grouped = groups.length > 1;
  const groupOf = useMemo(
    () => new Map(groups.flatMap((group) => group.items.map((file) => [file.path, group.key]))),
    [groups],
  );
  const [picked, setPicked] = useState<string>();
  const group = groups.find((item) => item.key === picked) ?? groups[0];
  const groupKey = group?.key ?? '';
  const [settingsBy, setSettingsBy] = useState<ReadonlyMap<string, NestingChoices>>(new Map());
  // Made once per thickness and unit: the estimates below follow the settings object itself.
  const startingBy = useMemo(
    () => new Map(groups.map((item) => [item.key, startingChoices(item.thickness, units)])),
    [groups, units],
  );
  const fallback = useMemo(() => initialChoices(units), [units]);
  const settingsOf = useCallback(
    (key: string) => settingsBy.get(key) ?? startingBy.get(key) ?? fallback,
    [settingsBy, startingBy, fallback],
  );
  const setUnits = (next: LengthUnit) => {
    if (next === units) return;
    setSettingsBy(
      (current) =>
        new Map([...current].map(([key, value]) => [key, inUnits(value, units, next)] as const)),
    );
    changePreferences((ui) => ({ ...ui, layout: { ...ui.layout, units: next } }));
  };
  const settings = settingsOf(groupKey);
  const sets = useMemo(
    () =>
      new Map(
        drawings.map((file) => [file.path, fileQuantity(file.name, quantities?.[file.path])]),
      ),
    [drawings, quantities],
  );
  // Opening the plane again with quantities replaces those typed for its files.
  useEffect(() => {
    if (!quantities) return;
    setChosen(
      (current) =>
        new Map([...current].filter(([key]) => !Object.hasOwn(quantities, key.split('\0')[0]!))),
    );
  }, [quantities]);

  const everyRow = useMemo<Row[]>(
    () =>
      read.flatMap((file) =>
        file.status === 'ready' && file.parts
          ? file.parts.parts.map((part) => ({ file, part, key: partKey(file, part.index) }))
          : [],
      ),
    [read],
  );
  const rowsOf = useCallback(
    (key: string) =>
      grouped ? everyRow.filter((row) => groupOf.get(row.file.entry.path) === key) : everyRow,
    [grouped, everyRow, groupOf],
  );
  const rows = useMemo(() => rowsOf(groupKey), [rowsOf, groupKey]);
  const starting = useCallback(
    (row: Row) => defaultChoice(row.part, sets.get(row.file.entry.path)?.quantity),
    [sets],
  );
  const choices = useMemo(
    () => new Map(everyRow.map((row) => [row.key, chosen.get(row.key) ?? starting(row)])),
    [everyRow, chosen, starting],
  );
  /** Where each untouched quantity came from. */
  const origins = useMemo(
    () =>
      new Map(
        everyRow.flatMap((row) => {
          const given = sets.get(row.file.entry.path);
          if (!given || chosen.has(row.key)) return [];
          return [[row.key, given.source === 'given' ? 'As requested' : `From “${given.text}”`]];
        }),
      ),
    [everyRow, sets, chosen],
  );
  const choose = useCallback(
    (key: string, patch: Partial<PartChoice>) =>
      setChosen((current) => {
        const row = everyRow.find((item) => item.key === key);
        if (!row) return current;
        return new Map(current).set(key, {
          ...(current.get(key) ?? starting(row)),
          ...patch,
        });
      }),
    [everyRow, starting],
  );
  const changeSettings = (patch: Partial<NestingChoices>) =>
    setSettingsBy((current) =>
      new Map(current).set(groupKey, { ...settingsOf(groupKey), ...patch }),
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
            { margin: settings.margin, spacing: settings.spacing, direction: settings.direction },
          )
        : undefined,
    [active, choices, formats, settings.margin, settings.spacing, settings.direction],
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
            spacing: settings.spacing,
            kerf: settings.cutting.kerf,
            units,
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
      settings.spacing,
      settings.cutting.kerf,
      units,
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
          title: `Sheet ${index + 1} · ${sheetName(format, units)} · ${percentText(sheet.area / (format.width * format.height))} used · ${countText(sheet.placements.length, 'part')}`,
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
            title: `Boxes estimate, sheet ${index + 1} · ${sheetName(format, units)}`,
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

  // Each thickness's figures: the shown one live, the others from a finished search of theirs
  // while nothing they nest has changed, or else from the box estimate.
  const figures = useMemo<GroupFigures | undefined>(
    () =>
      problem
        ? {
            sheets: best
              ? best.sheets
              : boxFormat === undefined
                ? 0
                : boxes[boxFormat]!.sheets.length,
            estimated: !best,
            placed: best
              ? best.placed
              : requested - (boxFormat === undefined ? requested : piecesLeft(boxes[boxFormat]!)),
            pieces: requested,
            minutes: estimate.minutes,
            total: estimate.total,
          }
        : undefined,
    [problem, best, boxFormat, boxes, requested, estimate],
  );
  const signatureOf = useCallback(
    (key: string) =>
      JSON.stringify([rowsOf(key).map((row) => [row.key, choices.get(row.key)]), settingsOf(key)]),
    [rowsOf, choices, settingsOf],
  );
  const signature = useMemo(() => signatureOf(groupKey), [signatureOf, groupKey]);
  const [nested, setNested] = useState<
    ReadonlyMap<string, { signature: string; figures: GroupFigures }>
  >(new Map());
  useEffect(() => {
    if (grouped && settled && best && figures)
      setNested((current) => new Map(current).set(groupKey, { signature, figures }));
  }, [grouped, settled, best, figures, groupKey, signature]);
  const tabs = useMemo<ThicknessTab[]>(
    () =>
      grouped
        ? groups.map((item) => {
            const own = settingsOf(item.key);
            const tab = {
              key: item.key,
              label: item.label,
              files: item.items.length,
              currency: own.cutting.currency,
              reading: read.some(
                (file) => file.status === 'reading' && groupOf.get(file.entry.path) === item.key,
              ),
              unsheeted: !own.formats.some((format) => format.enabled),
            };
            if (item.key === groupKey) return { ...tab, figures };
            const stored = nested.get(item.key);
            if (stored?.signature === signatureOf(item.key))
              return { ...tab, figures: stored.figures };
            const demand = rowsOf(item.key).flatMap((row) => {
              const choice = choices.get(row.key)!;
              return choice.quantity > 0
                ? [
                    {
                      ...row.part,
                      quantity: choice.quantity,
                      turn: rotationAngles(choice.rotation, choice.grain).includes(90),
                    },
                  ]
                : [];
            });
            const sheets = own.formats.filter((format) => format.enabled);
            return demand.length && sheets.length && !tab.reading
              ? {
                  ...tab,
                  figures: boxFigures(demand, sheets, own.margin, own.spacing, own.cutting),
                }
              : tab;
          })
        : [],
    [
      grouped,
      groups,
      settingsOf,
      read,
      groupOf,
      groupKey,
      figures,
      nested,
      signatureOf,
      rowsOf,
      choices,
    ],
  );
  const offcut = best?.offcut && offcutText(best.offcut, units);

  // A part picked on a sheet: every copy of it lights up, wherever it lies.
  const [selected, select] = useState<string>();
  const pickedIndex = active.findIndex((row) => row.key === selected);
  const pickedRow = active[pickedIndex];
  const pickedSheets = useMemo(
    () =>
      best && pickedIndex >= 0
        ? best.layout.sheets.flatMap((sheet, index) =>
            sheet.placements.some((placement) => placement.part === pickedIndex) ? [index + 1] : [],
          )
        : [],
    [best, pickedIndex],
  );
  const openDrawing = (index: number) => {
    const row = active[index];
    if (row)
      void workspace
        .openPath(row.file.entry.path, {
          activate: true,
          ...(paneID ? { paneID, linked: true } : {}),
        })
        .catch(report);
  };

  const title =
    `Nesting of ${countText(active.length, 'part')}` +
    (grouped && group?.thickness !== undefined ? `, ${thicknessText(group.thickness)}` : '');
  const job = jobs.find((item) => item.id === saving.job);
  // What Save nesting writes, and what a fabrication handoff saves as its cut sheets.
  const savable = useMemo(() => {
    if (!best || !problem) return undefined;
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
      units,
    };
    return { plan, used };
  }, [best, problem, read, active, choices, formats, settings, title, units]);
  useEffect(() => {
    if (savable && settled && verification?.ok)
      prepareNesting({
        title,
        sources: savable.used.map((file) => ({ path: file.entry.path, version: file.version! })),
        plan: savable.plan,
      });
  }, [savable, settled, verification, title]);
  const save = async () => {
    if (!savable) return;
    const { plan, used } = savable;
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
          files={grouped ? read.filter((file) => groupOf.get(file.entry.path) === groupKey) : read}
          origins={origins}
          choices={choices}
          choose={choose}
          configure={configure}
          placed={placed}
          units={units}
          selected={pickedRow?.key}
        />
        <NestingSettings
          choices={settings}
          change={changeSettings}
          units={units}
          setUnits={setUnits}
        />
      </aside>
      <main className="nesting-main">
        {grouped && <ThicknessGroups groups={tabs} selected={groupKey} choose={setPicked} />}
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
                  ? ` · ${formatsUsed(
                      best.layout.sheets.map((sheet) => formats[sheet.format]!),
                      units,
                    )}`
                  : boxFormat !== undefined
                    ? ` · ${formatsUsed([formats[boxFormat]!], units)}`
                    : ''}
              </h2>
              <p className="nesting-figures">
                {best && <span>{percentText(best.utilisation)} used</span>}
                <span>
                  {best ? best.placed : requested} of {countText(requested, 'part')}
                </span>
                <span>{lengthText(estimate.cutLength, units)} cut</span>
                <span>{countText(estimate.pierces, 'pierce')}</span>
                <span>{durationText(estimate.minutes)}</span>
                <span>{moneyText(estimate.total, settings.cutting.currency)}</span>
                {settings.cutting.density > 0 && estimate.partWeight > 0 && (
                  <span>{weightText(estimate.partWeight, units)} of parts</span>
                )}
              </p>
              {best && offcut && (
                <p className="muted">
                  {best.sheets > 1 ? `Offcut on sheet ${best.sheets}: ` : 'Offcut '}
                  {offcut}
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
                        ? `Checked: parts at least ${gapText(verification.closest, units)} apart, inside the margin.`
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
              <>
                <p className="nesting-empty">
                  {!formats.length
                    ? 'Choose a sheet format to nest on.'
                    : 'Give at least one part a quantity.'}
                </p>
                {drawings.length > 0 && (
                  <div className="nesting-status">
                    <button type="button" className="primary" disabled>
                      Save nesting
                    </button>
                  </div>
                )}
              </>
            )
          )}
        </section>
        {pickedRow && (
          <section className="nesting-selection" aria-label="Selected part" aria-live="polite">
            <PartThumbnail part={pickedRow.part} />
            <div>
              <strong>
                {pickedIndex + 1} · {pickedRow.part.name}
              </strong>
              <span className="muted">{pickedRow.file.entry.name}</span>
              <span>
                {sizeText(pickedRow.part.width, pickedRow.part.height, units)}
                {pickedRow.part.holes
                  ? ` · ${countText(pickedRow.part.holes, 'hole')}`
                  : ' · no holes'}
                {` · ${placedCounts[pickedIndex]} of ${countText(choices.get(pickedRow.key)!.quantity, 'piece')} placed`}
              </span>
              <span className="muted">
                {pickedSheets.length
                  ? `On ${sheetsText(pickedSheets).toLowerCase()}`
                  : 'On no sheet yet'}
              </span>
            </div>
            <div className="nesting-selection-actions">
              <button type="button" onClick={() => openDrawing(pickedIndex)}>
                Open drawing
              </button>
              <IconButton icon="close" label="Deselect" onClick={() => select(undefined)} />
            </div>
          </section>
        )}
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
                selected={pickedIndex >= 0 ? pickedIndex : undefined}
                select={(part) => select(part === undefined ? undefined : active[part]?.key)}
                open={openDrawing}
              />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
