import type {
  CuttingProcess,
  CuttingSettings,
  LengthUnit,
  NestDirection,
  SheetSize,
} from '../../../domain/layout/nesting/plan';
import type { Choice } from '../../ui/ChoiceMenu';
import { useState } from 'react';
import { fieldValue, fromUnit, unitSymbol } from '../../../domain/layout/nesting/format';
import {
  cuttingPresets,
  cuttingProcesses,
  directionLabels,
  inchSheetPresets,
  lengthUnits,
  nestDirections,
  nestingLimits,
  presetFor,
  presetName,
  processLabels,
  sheetAllowance,
  sheetName,
  sheetPresetsIn,
} from '../../../domain/layout/nesting/plan';
import { ChoiceButton } from '../../ui/ChoiceMenu';
import { IconButton } from '../../ui/primitives';

export interface FormatChoice {
  width: number;
  height: number;
  /** Chosen to nest on: listed under Sheets. Presets stay here when removed, keeping their stock
   * and price for when they are added again. */
  enabled: boolean;
  /** Sheets in stock; empty for unlimited. */
  stock?: number;
  price: number;
  custom?: boolean;
}
export interface NestingChoices {
  formats: FormatChoice[];
  margin: number;
  spacing: number;
  /** Margin and spacing the person typed: a new material no longer changes them. */
  typed?: { margin?: boolean; spacing?: boolean };
  direction: NestDirection;
  /** The preset the cutting values came from, or -1 once edited. */
  preset: number;
  cutting: CuttingSettings;
  /** Seconds of true-shape search. */
  budget: number;
  labels: boolean;
}
/** The cutting values of a preset, with the spacing and margin it needs where none was typed. */
export function withPreset(choices: NestingChoices, index: number): Partial<NestingChoices> {
  const preset = cuttingPresets[index];
  if (!preset) return {};
  const allowance = sheetAllowance(preset.process, preset.thickness);
  return {
    preset: index,
    cutting: { ...choices.cutting, ...preset },
    ...(choices.typed?.margin ? {} : { margin: allowance.margin }),
    ...(choices.typed?.spacing ? {} : { spacing: allowance.spacing }),
  };
}
const budgetChoices: Choice[] = [5, 15, 30, 60].map((seconds) => ({
  value: String(seconds),
  label: `${seconds} s`,
}));
const presetChoices: Choice[] = cuttingPresets.map((preset, index) => ({
  value: String(index),
  label: presetName(preset),
  aliases: [preset.material, processLabels[preset.process]],
}));
const processChoices: Choice[] = cuttingProcesses.map((process) => ({
  value: process,
  label: processLabels[process],
  ...(process === 'waterjet' ? { detail: 'Abrasive', aliases: ['waterjet', 'abrasive'] } : {}),
}));
const directionChoices: Choice[] = nestDirections.map((direction) => ({
  value: direction,
  label: directionLabels[direction],
  detail: {
    compact: 'A block in one corner; keeps the largest offcut',
    length: "Rows down the sheet's long side",
    width: 'Across the sheet first; a strip at the far end',
  }[direction],
}));
const feet = (size: SheetSize) =>
  `${Math.round(size.width / 304.8)}' × ${Math.round(size.height / 304.8)}'`;
const amount = (value: string, low = 0, high = 1e9) =>
  Math.max(low, Math.min(high, Number(value) || 0));

export function NestingSettings({
  choices,
  change,
  units,
  setUnits,
}: {
  choices: NestingChoices;
  change(patch: Partial<NestingChoices>): void;
  units: LengthUnit;
  setUnits(units: LengthUnit): void;
}) {
  const [custom, setCustom] = useState<{ width: string; height: string }>();
  const unit = unitSymbol(units);
  const setFormat = (index: number, patch: Partial<FormatChoice>) =>
    change({
      formats: choices.formats.map((format, at) =>
        at === index ? { ...format, ...patch } : format,
      ),
    });
  const remove = (index: number) =>
    change({
      formats: choices.formats[index]!.custom
        ? choices.formats.filter((_, at) => at !== index)
        : choices.formats.map((format, at) =>
            at === index ? { ...format, enabled: false } : format,
          ),
    });
  const setCutting = (patch: Partial<CuttingSettings>) =>
    change({ cutting: { ...choices.cutting, ...patch }, preset: -1 });
  const chosen = choices.formats.flatMap((format, index) =>
    format.enabled ? [{ format, index }] : [],
  );
  const full = chosen.length >= nestingLimits.formats;
  const offered = sheetPresetsIn(units);
  const addChoices: Choice[] = [
    ...choices.formats.flatMap((format, index) =>
      !format.enabled && offered.some((size) => same(size, format))
        ? [
            {
              value: String(index),
              label: `${sheetName(format, units)} ${unit}`,
              ...(inchSheetPresets.some((size) => same(size, format))
                ? { detail: feet(format), aliases: [feet(format)] }
                : {}),
            },
          ]
        : [],
    ),
    { value: 'custom', label: 'Custom size…' },
  ];
  const width = fromUnit(Number(custom?.width), units),
    height = fromUnit(Number(custom?.height), units);
  const addable = width >= 10 && height >= 10 && width <= 100_000 && height <= 100_000;
  const add = () => {
    const size = { width: Math.min(width, height), height: Math.max(width, height) };
    const known = choices.formats.findIndex((format) => same(format, size));
    change({
      formats:
        known >= 0
          ? choices.formats.map((format, at) =>
              at === known ? { ...format, enabled: true } : format,
            )
          : [...choices.formats, { ...size, enabled: true, price: 0, custom: true }],
    });
    setCustom(undefined);
  };
  return (
    <>
      <section className="nesting-settings" aria-label="Sheets">
        <div className="nesting-heading">
          <h3>Sheets</h3>
          <div className="nesting-segmented" role="group" aria-label="Units">
            {lengthUnits.map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={units === value}
                title={value === 'mm' ? 'Millimetres' : 'Inches'}
                onClick={() => setUnits(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        {chosen.length > 0 ? (
          <div className="nesting-formats" role="table" aria-label="Sheet formats">
            <div role="row" className="nesting-format nesting-format-head">
              <span role="columnheader">Format ({unit})</span>
              <span role="columnheader">In stock</span>
              <span role="columnheader">Price each</span>
              <span role="columnheader" />
            </div>
            {chosen.map(({ format, index }) => {
              const name = `${sheetName(format, units)} ${unit}`;
              return (
                <div
                  role="row"
                  key={`${format.width}x${format.height}:${index}`}
                  className="nesting-format"
                >
                  <span role="cell">{sheetName(format, units)}</span>
                  <input
                    role="cell"
                    type="number"
                    min={0}
                    placeholder="Any"
                    aria-label={`Sheets of ${name} in stock`}
                    value={format.stock ?? ''}
                    onChange={(event) =>
                      setFormat(index, {
                        stock:
                          event.target.value === ''
                            ? undefined
                            : Math.floor(amount(event.target.value, 0, 500)),
                      })
                    }
                  />
                  <input
                    role="cell"
                    type="number"
                    min={0}
                    step="any"
                    aria-label={`Price of a ${name} sheet`}
                    value={format.price}
                    onChange={(event) => setFormat(index, { price: amount(event.target.value) })}
                  />
                  <span role="cell">
                    <IconButton
                      icon="close"
                      label={`Remove ${name}`}
                      onClick={() => remove(index)}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="nesting-problem">No format chosen.</p>
        )}
        <div className="nesting-custom">
          <ChoiceButton
            label="Add format"
            value=""
            placeholder="Add format"
            choices={addChoices}
            disabled={full}
            onChoose={(value) => {
              if (value === 'custom') setCustom({ width: '', height: '' });
              else setFormat(Number(value), { enabled: true });
            }}
          />
          {custom && (
            <>
              <input
                type="number"
                min={0}
                step="any"
                placeholder="Width"
                aria-label={`Custom sheet width in ${unit}`}
                autoFocus
                value={custom.width}
                onChange={(event) => setCustom({ ...custom, width: event.target.value })}
              />
              ×
              <input
                type="number"
                min={0}
                step="any"
                placeholder="Length"
                aria-label={`Custom sheet length in ${unit}`}
                value={custom.height}
                onChange={(event) => setCustom({ ...custom, height: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && addable && !full) add();
                }}
              />
              <span className="nesting-unit">{unit}</span>
              <button type="button" disabled={!addable || full} onClick={add}>
                Add
              </button>
              <IconButton
                icon="close"
                label="Cancel custom size"
                onClick={() => setCustom(undefined)}
              />
            </>
          )}
        </div>
        <div className="nesting-fields">
          <NumberField
            label="Edge margin"
            units={units}
            value={choices.margin}
            set={(margin) =>
              change({
                margin: Math.min(1000, margin),
                typed: { ...choices.typed, margin: true },
              })
            }
          />
          <NumberField
            label="Spacing"
            name="Spacing between parts"
            units={units}
            value={choices.spacing}
            set={(spacing) =>
              change({
                spacing: Math.min(1000, spacing),
                typed: { ...choices.typed, spacing: true },
              })
            }
          />
          <span className="nesting-choice">
            Direction
            <ChoiceButton
              label="Nesting direction"
              value={choices.direction}
              choices={directionChoices}
              onChoose={(value) => change({ direction: value as NestDirection })}
            />
          </span>
          <span className="nesting-choice">
            Search
            <ChoiceButton
              label="Search time"
              value={String(choices.budget)}
              choices={budgetChoices}
              onChoose={(value) => change({ budget: Number(value) })}
            />
          </span>
          <label className="nesting-check">
            <input
              type="checkbox"
              checked={choices.labels}
              onChange={(event) => change({ labels: event.target.checked })}
            />
            Part numbers in the DXF
          </label>
        </div>
      </section>
      <section className="nesting-settings" aria-label="Cutting">
        <h3>Cutting</h3>
        <div className="nesting-wide">
          Material
          <ChoiceButton
            label="Material and thickness"
            value={String(choices.preset)}
            placeholder="Custom values"
            choices={presetChoices}
            onChoose={(value) => change(withPreset(choices, Number(value)))}
          />
        </div>
        <div className="nesting-fields">
          <span className="nesting-choice">
            Process
            <ChoiceButton
              label="Cutting process"
              value={choices.cutting.process}
              choices={processChoices}
              onChoose={(value) => {
                const process = value as CuttingProcess;
                const index = presetFor(
                  process,
                  choices.cutting.material,
                  choices.cutting.thickness,
                );
                change(
                  index < 0
                    ? { cutting: { ...choices.cutting, process }, preset: -1 }
                    : withPreset(choices, index),
                );
              }}
            />
          </span>
          <NumberField
            label="Thickness"
            unit="mm"
            value={choices.cutting.thickness}
            set={(thickness) => setCutting({ thickness })}
          />
          <NumberField
            label="Speed"
            unit={`${unit}/min`}
            units={units}
            value={choices.cutting.speed}
            set={(speed) => setCutting({ speed: Math.max(1, speed) })}
          />
          <NumberField
            label="Pierce"
            unit="s"
            value={choices.cutting.pierce}
            set={(pierce) => setCutting({ pierce: Math.min(600, pierce) })}
          />
          <NumberField
            label="Kerf"
            units={units}
            value={choices.cutting.kerf ?? 0}
            set={(kerf) => setCutting({ kerf: Math.min(50, kerf) })}
          />
          <NumberField
            label="Machine rate"
            unit="an hour"
            value={choices.cutting.rate}
            set={(rate) => setCutting({ rate })}
          />
          <label>
            Currency
            <input
              aria-label="Currency"
              maxLength={8}
              value={choices.cutting.currency}
              onChange={(event) => setCutting({ currency: event.target.value.slice(0, 8) })}
            />
          </label>
        </div>
        <p className="muted nesting-hint">
          {choices.cutting.process === 'waterjet'
            ? 'Typical abrasive values at 4,100 bar, a 0.30 mm orifice and a 1.0 mm focusing tube, medium edge quality. Check them against your machine.'
            : 'Typical values. Check them against your machine.'}
        </p>
      </section>
    </>
  );
}
const same = (a: SheetSize, b: SheetSize) =>
  Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01;
/** A number typed in the panel's units, or as is when `units` is absent. */
function NumberField({
  label,
  name = label,
  unit,
  units,
  value,
  set,
}: {
  label: string;
  /** What the field is called aloud, when its label is short. */
  name?: string;
  unit?: string;
  /** A length: shown and typed in these units, kept in millimetres. */
  units?: LengthUnit;
  value: number;
  set(value: number): void;
}) {
  return (
    <label>
      {label}
      <span className="nesting-unit">
        <input
          type="number"
          min={0}
          step="any"
          aria-label={name}
          value={units ? fieldValue(value, units) : value}
          onChange={(event) => {
            const typed = amount(event.target.value, 0, 1_000_000);
            set(units ? fromUnit(typed, units) : typed);
          }}
        />
        {unit ?? (units && unitSymbol(units))}
      </span>
    </label>
  );
}
