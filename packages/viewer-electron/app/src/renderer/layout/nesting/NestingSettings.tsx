import { useState } from 'react';
import {
  cuttingPresets,
  cuttingProcesses,
  presetName,
  processLabels,
  sheetName,
  type CuttingProcess,
  type CuttingSettings,
} from '../../../domain/layout/nesting/plan';
import { ChoiceButton, type Choice } from '../../ui/ChoiceMenu';
import { IconButton } from '../../ui/primitives';

export interface FormatChoice {
  width: number;
  height: number;
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
  /** The preset the cutting values came from, or -1 once edited. */
  preset: number;
  cutting: CuttingSettings;
  /** Seconds of true-shape search. */
  budget: number;
  labels: boolean;
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
}));
const amount = (value: string, low = 0, high = 1e9) =>
  Math.max(low, Math.min(high, Number(value) || 0));

export function NestingSettings({
  choices,
  change,
}: {
  choices: NestingChoices;
  change(patch: Partial<NestingChoices>): void;
}) {
  const [custom, setCustom] = useState({ width: '', height: '' });
  const setFormat = (index: number, patch: Partial<FormatChoice>) =>
    change({
      formats: choices.formats.map((format, at) =>
        at === index ? { ...format, ...patch } : format,
      ),
    });
  const setCutting = (patch: Partial<CuttingSettings>) =>
    change({ cutting: { ...choices.cutting, ...patch }, preset: -1 });
  const width = Number(custom.width),
    height = Number(custom.height);
  const addable = width >= 10 && height >= 10 && width <= 100_000 && height <= 100_000;
  return (
    <>
      <section className="nesting-settings" aria-label="Sheets">
        <h3>Sheets</h3>
        <div className="nesting-formats" role="table" aria-label="Sheet formats">
          <div role="row" className="nesting-format nesting-format-head">
            <span role="columnheader">Format (mm)</span>
            <span role="columnheader">In stock</span>
            <span role="columnheader">Price each</span>
          </div>
          {choices.formats.map((format, index) => (
            <div
              role="row"
              key={`${format.width}x${format.height}:${index}`}
              className="nesting-format"
            >
              <label role="cell" className="nesting-check">
                <input
                  type="checkbox"
                  checked={format.enabled}
                  onChange={(event) => setFormat(index, { enabled: event.target.checked })}
                />
                {sheetName(format)}
                {format.custom && (
                  <IconButton
                    icon="close"
                    label={`Remove ${sheetName(format)}`}
                    onClick={() =>
                      change({ formats: choices.formats.filter((_, at) => at !== index) })
                    }
                  />
                )}
              </label>
              <input
                role="cell"
                type="number"
                min={0}
                placeholder="Any"
                aria-label={`Sheets of ${sheetName(format)} in stock`}
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
                aria-label={`Price of a ${sheetName(format)} sheet`}
                value={format.price}
                onChange={(event) => setFormat(index, { price: amount(event.target.value) })}
              />
            </div>
          ))}
        </div>
        <div className="nesting-custom">
          <input
            type="number"
            min={10}
            placeholder="Width"
            aria-label="Custom sheet width"
            value={custom.width}
            onChange={(event) => setCustom({ ...custom, width: event.target.value })}
          />
          ×
          <input
            type="number"
            min={10}
            placeholder="Length"
            aria-label="Custom sheet length"
            value={custom.height}
            onChange={(event) => setCustom({ ...custom, height: event.target.value })}
          />
          <button
            type="button"
            disabled={!addable || choices.formats.length >= 12}
            onClick={() => {
              change({
                formats: [
                  ...choices.formats,
                  {
                    width: Math.min(width, height),
                    height: Math.max(width, height),
                    enabled: true,
                    price: 0,
                    custom: true,
                  },
                ],
              });
              setCustom({ width: '', height: '' });
            }}
          >
            Add size
          </button>
        </div>
        <div className="nesting-fields">
          <label>
            Edge margin
            <span className="nesting-unit">
              <input
                type="number"
                min={0}
                step="any"
                aria-label="Edge margin"
                value={choices.margin}
                onChange={(event) => change({ margin: amount(event.target.value, 0, 1000) })}
              />
              mm
            </span>
          </label>
          <label>
            Spacing
            <span className="nesting-unit">
              <input
                type="number"
                min={0}
                step="any"
                aria-label="Spacing between parts"
                value={choices.spacing}
                onChange={(event) => change({ spacing: amount(event.target.value, 0, 1000) })}
              />
              mm
            </span>
          </label>
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
            onChoose={(value) => {
              const preset = cuttingPresets[Number(value)];
              if (preset)
                change({ preset: Number(value), cutting: { ...choices.cutting, ...preset } });
            }}
          />
        </div>
        <div className="nesting-fields">
          <span className="nesting-choice">
            Process
            <ChoiceButton
              label="Cutting process"
              value={choices.cutting.process}
              choices={processChoices}
              onChoose={(value) => setCutting({ process: value as CuttingProcess })}
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
            unit="mm/min"
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
        <p className="muted nesting-hint">Typical values. Check them against your machine.</p>
      </section>
    </>
  );
}
function NumberField({
  label,
  unit,
  value,
  set,
}: {
  label: string;
  unit: string;
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
          aria-label={label}
          value={value}
          onChange={(event) => set(amount(event.target.value, 0, 1_000_000))}
        />
        {unit}
      </span>
    </label>
  );
}
