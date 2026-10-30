import type { ReactNode } from 'react';
import { ChoiceButton } from '../ui/ChoiceMenu';
import type { Choice } from '../ui/ChoiceMenu';
import { toMillimetres, millimetres } from '../../domain/layout/plan';
import { collageStyleAvailable, collageStyles } from '../../domain/layout/collage';
import { collageStyleLabel, itemLabel } from '../../domain/layout/candidates';
import { cropAnchors } from '../../domain/layout/geometry';
import { nUpCounts } from '../../domain/layout/n-up';
import { isScreenSize, itemPresets, pageLabel, pagePresets } from '../../domain/layout/pages';
import type { ItemSizeID, PageOrientation, PageSizeID } from '../../domain/layout/pages';
import { sourcePieces } from '../../domain/layout/sources';
import type { LayoutSource } from '../../domain/layout/sources';
import { changeMode, changePage } from '../../domain/layout/settings';
import type { LayoutSettings, PageSetup, PlannedMode } from '../../domain/layout/settings';

interface Segment<Value extends string> {
  value: Value;
  label: string;
}
function Segmented<Value extends string>({
  label,
  value,
  choices,
  onChoose,
}: {
  label: string;
  value: Value;
  choices: readonly Segment<Value>[];
  onChoose(value: Value): void;
}) {
  return (
    <div className="layout-field">
      <span>{label}</span>
      <div className="layout-segmented" role="group" aria-label={label}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            aria-pressed={choice.value === value}
            onClick={() => onChoose(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="layout-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="layout-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
/** A length kept in points, shown in millimetres, or in pixels on a screen-sized page. */
function LengthField({
  label,
  value,
  pixels = false,
  max,
  step = 0.5,
  onChange,
}: {
  label: string;
  value: number;
  pixels?: boolean;
  max: number;
  step?: number;
  onChange(points: number): void;
}) {
  const shown = pixels ? Math.round(value) : Math.round(toMillimetres(value) * 100) / 100;
  return (
    <Field label={`${label} (${pixels ? 'px' : 'mm'})`}>
      <input
        type="number"
        min={0}
        max={max}
        step={pixels ? 1 : step}
        value={shown}
        onChange={(event) => {
          const number = Math.min(max, Math.max(0, Number(event.target.value) || 0));
          onChange(pixels ? number : millimetres(number));
        }}
      />
    </Field>
  );
}

const orientations: readonly Segment<PageOrientation>[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];
const anchorLabels = {
  center: 'Centre',
  top: 'Top',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right',
} as const;
const backgrounds = [
  { color: '#ffffff', label: 'White' },
  { color: '#f3efe6', label: 'Cream' },
  { color: '#d9d9d9', label: 'Grey' },
  { color: '#000000', label: 'Black' },
];
const pageGroups = { paper: 'Paper', photo: 'Photo print', screen: 'Screen' } as const;

/** The choices of the current mode, then of its page. */
export function LayoutOptions({
  settings,
  mode,
  sources,
  onChange,
}: {
  settings: LayoutSettings;
  mode: PlannedMode;
  sources: readonly LayoutSource[];
  onChange(settings: LayoutSettings): void;
}) {
  return (
    <>
      <section className="layout-section" aria-label="Layout choices">
        <ModeOptions settings={settings} mode={mode} sources={sources} onChange={onChange} />
      </section>
      <section className="layout-section" aria-label="Page">
        <PageOptions settings={settings} mode={mode} onChange={onChange} />
      </section>
    </>
  );
}

function ModeOptions({
  settings,
  mode,
  sources,
  onChange,
}: {
  settings: LayoutSettings;
  mode: PlannedMode;
  sources: readonly LayoutSource[];
  onChange(settings: LayoutSettings): void;
}) {
  const photos = sources.filter((source) => source.kind === 'image');
  const pieces = sourcePieces(sources);
  const pieceName = (index: number) => {
    const piece = pieces[index]!;
    const name = sources[piece.source]!.name;
    return piece.page ? `${name}, page ${piece.page}` : name;
  };
  switch (mode) {
    case 'collage': {
      const options = settings.collage;
      const set = (change: Partial<LayoutSettings['collage']>) =>
        onChange(changeMode(settings, 'collage', change));
      const featured =
        options.style === 'featured' || (options.style === 'split' && photos.length === 3);
      return (
        <>
          <Field label="Style">
            <ChoiceButton
              label="Collage style"
              value={options.style}
              choices={collageStyles
                .filter((style) => collageStyleAvailable(style, photos.length))
                .map((style) => ({ value: style, label: collageStyleLabel(style, photos.length) }))}
              onChoose={(style) => set({ style: style as typeof options.style })}
            />
          </Field>
          <Segmented
            label="Photos"
            value={options.fit}
            choices={[
              { value: 'fill', label: 'Fill' },
              { value: 'fit', label: 'Whole' },
            ]}
            onChoose={(fit) => set({ fit })}
          />
          {options.fit === 'fill' && (
            <Field label="Keep">
              <ChoiceButton
                label="Part of each photo to keep"
                value={options.anchor}
                choices={cropAnchors.map((anchor) => ({
                  value: anchor,
                  label: anchorLabels[anchor],
                }))}
                onChoose={(anchor) => set({ anchor: anchor as typeof options.anchor })}
              />
            </Field>
          )}
          {(options.style === 'justified' || options.style === 'strip') && (
            <Segmented
              label="Direction"
              value={options.direction}
              choices={[
                { value: 'auto', label: 'Automatic' },
                { value: 'horizontal', label: 'Rows' },
                { value: 'vertical', label: 'Columns' },
              ]}
              onChoose={(direction) => set({ direction })}
            />
          )}
          {featured && (
            <Field label="Large photo">
              <ChoiceButton
                label="Large photo"
                value={String(options.feature)}
                choices={[
                  { value: 'auto', label: 'Most pixels' },
                  ...photos.map((photo, index) => ({ value: String(index), label: photo.name })),
                ]}
                onChoose={(value) => set({ feature: value === 'auto' ? 'auto' : Number(value) })}
              />
            </Field>
          )}
        </>
      );
    }
    case 'contact-sheet': {
      const options = settings['contact-sheet'];
      const set = (change: Partial<LayoutSettings['contact-sheet']>) =>
        onChange(changeMode(settings, 'contact-sheet', change));
      return (
        <>
          <Field label="Columns">
            <ChoiceButton
              label="Columns"
              value={String(options.columns)}
              choices={[
                { value: 'auto', label: 'Automatic' },
                ...Array.from({ length: 9 }, (_, index) => ({
                  value: String(index + 2),
                  label: String(index + 2),
                })),
              ]}
              onChoose={(value) => set({ columns: value === 'auto' ? 'auto' : Number(value) })}
            />
          </Field>
          <Toggle
            label="Folder name"
            checked={options.title}
            onChange={(title) => set({ title })}
          />
          <Toggle label="Date" checked={options.date} onChange={(date) => set({ date })} />
          <Toggle
            label="Size"
            checked={options.dimensions}
            onChange={(dimensions) => set({ dimensions })}
          />
        </>
      );
    }
    case 'n-up': {
      const options = settings['n-up'];
      const set = (change: Partial<LayoutSettings['n-up']>) =>
        onChange(changeMode(settings, 'n-up', change));
      return (
        <>
          <Field label="Pages per sheet">
            <ChoiceButton
              label="Pages per sheet"
              value={String(options.perSheet)}
              choices={nUpCounts.map((count) => ({ value: String(count), label: String(count) }))}
              onChoose={(value) => set({ perSheet: Number(value) as typeof options.perSheet })}
            />
          </Field>
          <Segmented
            label="Order"
            value={options.order}
            choices={[
              { value: 'rows', label: 'Across' },
              { value: 'columns', label: 'Down' },
            ]}
            onChoose={(order) => set({ order })}
          />
          <Toggle
            label="Crop marks"
            checked={options.cropMarks}
            onChange={(cropMarks) => set({ cropMarks })}
          />
          <Toggle
            label="Frame lines"
            checked={options.frames}
            onChange={(frames) => set({ frames })}
          />
          <LengthField
            label="Bleed in the pages"
            value={options.bleed}
            max={10}
            onChange={(bleed) => set({ bleed })}
          />
        </>
      );
    }
    case 'booklet':
      return (
        <LengthField
          label="Creep per sheet"
          value={settings.booklet.creep}
          max={2}
          step={0.05}
          onChange={(creep) => onChange(changeMode(settings, 'booklet', { creep }))}
        />
      );
    case 'step-repeat': {
      const options = settings['step-repeat'];
      const set = (change: Partial<LayoutSettings['step-repeat']>) =>
        onChange(changeMode(settings, 'step-repeat', change));
      const copies = options.copies[0] ?? 1;
      return (
        <>
          <Field label="Item">
            <ChoiceButton
              label="Item size"
              value={options.item}
              choices={[
                ...itemPresets.map((preset) => ({ value: preset.id, label: preset.label })),
                { value: 'original', label: itemLabel('original') },
                { value: 'custom', label: itemLabel('custom') },
              ]}
              onChoose={(item) => set({ item: item as ItemSizeID })}
            />
          </Field>
          {options.item === 'custom' && (
            <div className="layout-pair">
              <LengthField
                label="Width"
                value={options.width}
                max={1000}
                onChange={(width) => set({ width })}
              />
              <LengthField
                label="Height"
                value={options.height}
                max={1000}
                onChange={(height) => set({ height })}
              />
            </div>
          )}
          <Toggle
            label="Fill the sheet"
            checked={options.fill}
            onChange={(fill) => set({ fill })}
          />
          {!options.fill && (
            <Field label="Copies of each">
              <input
                type="number"
                min={1}
                max={1000}
                value={copies}
                onChange={(event) => {
                  const value = Math.min(
                    1000,
                    Math.max(1, Math.round(Number(event.target.value) || 1)),
                  );
                  set({ copies: pieces.map(() => value) });
                }}
              />
            </Field>
          )}
          <Segmented
            label="Pictures"
            value={options.fit}
            choices={[
              { value: 'fill', label: 'Fill' },
              { value: 'fit', label: 'Whole' },
            ]}
            onChoose={(fit) => set({ fit })}
          />
          <Segmented
            label="Marks"
            value={options.marks}
            choices={[
              { value: 'none', label: 'None' },
              { value: 'crop', label: 'Crop marks' },
              { value: 'lines', label: 'Cut lines' },
            ]}
            onChoose={(marks) => set({ marks })}
          />
          <Toggle
            label="Turn items to fit more"
            checked={options.rotate}
            onChange={(rotate) => set({ rotate })}
          />
        </>
      );
    }
    case 'poster': {
      const options = settings.poster;
      const set = (change: Partial<LayoutSettings['poster']>) =>
        onChange(changeMode(settings, 'poster', change));
      return (
        <>
          {pieces.length > 1 && (
            <Field label="Picture">
              <ChoiceButton
                label="Picture to enlarge"
                value={String(Math.min(options.piece, pieces.length - 1))}
                choices={pieces.slice(0, 500).map((_, index) => ({
                  value: String(index),
                  label: pieceName(index),
                }))}
                onChoose={(value) => set({ piece: Number(value) })}
              />
            </Field>
          )}
          <Field label="Poster size">
            <ChoiceButton
              label="Poster size"
              value={options.target === 'scale' ? 'scale' : options.size}
              choices={[
                { value: 'scale', label: 'Scale' },
                ...(['a3', 'a2', 'a1', 'a0'] as const).map((size) => ({
                  value: size,
                  label: pageLabel(size),
                })),
              ]}
              onChoose={(value) =>
                set(
                  value === 'scale'
                    ? { target: 'scale' }
                    : { target: 'size', size: value as typeof options.size },
                )
              }
            />
          </Field>
          {options.target === 'scale' && (
            <Field label="Scale (%)">
              <input
                type="number"
                min={10}
                max={2000}
                step={10}
                value={options.scale}
                onChange={(event) =>
                  set({ scale: Math.min(2000, Math.max(10, Number(event.target.value) || 100)) })
                }
              />
            </Field>
          )}
          <LengthField
            label="Overlap"
            value={options.overlap}
            max={50}
            onChange={(overlap) => set({ overlap })}
          />
          <Toggle
            label="Sheet labels"
            checked={options.labels}
            onChange={(labels) => set({ labels })}
          />
          <Toggle
            label="Trim and glue marks"
            checked={options.marks}
            onChange={(marks) => set({ marks })}
          />
        </>
      );
    }
  }
}

function PageOptions({
  settings,
  mode,
  onChange,
}: {
  settings: LayoutSettings;
  mode: PlannedMode;
  onChange(settings: LayoutSettings): void;
}) {
  const page = settings[mode].page;
  const set = (change: Partial<PageSetup>) => onChange(changePage(settings, mode, change));
  const label = mode === 'collage' || mode === 'contact-sheet' ? 'Page' : 'Sheet';
  const sheet =
    mode === 'step-repeat'
      ? itemPresets.find((preset) => preset.id === settings['step-repeat'].item)
      : undefined;
  if (sheet && 'sheet' in sheet)
    return (
      <p className="muted">
        Printed on {pageLabel(sheet.sheet.page)}, where the label sheet has its labels.
      </p>
    );
  const choices: Choice[] = [
    ...(mode === 'collage'
      ? [{ value: 'fit', label: pageLabel('fit'), detail: 'Shaped to the photos' }]
      : []),
    ...pagePresets
      .filter(
        (preset) => mode === 'collage' || mode === 'contact-sheet' || preset.group === 'paper',
      )
      .map((preset) => ({
        value: preset.id,
        label: preset.label,
        detail: pageGroups[preset.group],
      })),
  ];
  const pixels = page.size !== 'fit' && isScreenSize(page.size);
  return (
    <>
      <Field label={label}>
        <ChoiceButton
          label={label + ' size'}
          value={page.size}
          choices={choices}
          onChoose={(size) => set({ size: size as PageSizeID })}
        />
      </Field>
      {page.size !== 'fit' && (
        <Segmented
          label="Orientation"
          value={page.orientation}
          choices={orientations}
          onChoose={(orientation) => set({ orientation })}
        />
      )}
      <div className="layout-pair">
        <LengthField
          label="Margin"
          value={page.margin}
          pixels={pixels}
          max={pixels ? 400 : 60}
          onChange={(margin) => set({ margin })}
        />
        {mode !== 'booklet' && mode !== 'poster' && (
          <LengthField
            label="Gap"
            value={page.gap}
            pixels={pixels}
            max={pixels ? 400 : 60}
            onChange={(gap) => set({ gap })}
          />
        )}
      </div>
      {(mode === 'collage' || mode === 'contact-sheet') && (
        <div className="layout-field">
          <span>Background</span>
          <div className="layout-swatches" role="group" aria-label="Background">
            {backgrounds.map((item) => (
              <button
                key={item.color}
                type="button"
                className="layout-swatch"
                aria-label={item.label}
                aria-pressed={page.background.toLowerCase() === item.color}
                style={{ background: item.color }}
                onClick={() => set({ background: item.color })}
              />
            ))}
            <button
              type="button"
              className="layout-swatch is-transparent"
              aria-label="Transparent"
              title="Transparent in a PNG; white on paper"
              aria-pressed={!page.background}
              onClick={() => set({ background: '' })}
            />
            <input
              type="color"
              aria-label="Background colour"
              value={page.background || '#ffffff'}
              onChange={(event) => set({ background: event.target.value.toLowerCase() })}
            />
          </div>
        </div>
      )}
    </>
  );
}
