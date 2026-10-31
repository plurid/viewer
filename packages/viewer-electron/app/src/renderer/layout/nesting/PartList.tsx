import { areaText, sizeText } from '../../../domain/layout/nesting/format';
import type { LengthUnit, RotationMode } from '../../../domain/layout/nesting/plan';
import { rotationLabels, rotationModes } from '../../../domain/layout/nesting/plan';
import type { PartChoice } from '../../../domain/layout/nesting/problem';
import { units, unitInfo } from '../../../domain/previews/drawings/dxf/units';
import { ChoiceButton, type Choice } from '../../ui/ChoiceMenu';
import { PanelSection } from '../../ui/Panel';
import { Loading } from '../../ui/primitives';
import { Disclosure } from '../../ui/Disclosure';
import { PartThumbnail } from './SheetView';
import type { FileOptions, NestingFile } from './useNestingFiles';

/** Units a cutting drawing is likely to be in, offered first when it does not say. */
const likely = new Set([4, 5, 6, 1, 2]);
const turnChoices: Choice[] = rotationModes.map((mode) => ({
  value: mode,
  label: rotationLabels[mode],
}));
const groupingChoices: Choice[] = [
  { value: 'apart', label: 'Separate parts' },
  { value: 'together', label: 'One part' },
];
export const partKey = (file: NestingFile, index: number) => `${file.key}#${index}`;

export function PartList({
  files,
  choices,
  choose,
  configure,
  placed,
  origins,
  units = 'mm',
  selected,
}: {
  files: readonly NestingFile[];
  choices: ReadonlyMap<string, PartChoice>;
  choose(key: string, patch: Partial<PartChoice>): void;
  configure(file: string, patch: Partial<FileOptions>): void;
  /** Copies placed so far, by part key. */
  placed: ReadonlyMap<string, number>;
  /** Where an untouched quantity came from, by part key: "From “4buc”". */
  origins?: ReadonlyMap<string, string>;
  units?: LengthUnit;
  /** The part picked on a sheet, by key. */
  selected?: string;
}) {
  return (
    <PanelSection className="nesting-parts" title="Parts">
      {files.map((file) => (
        <div key={file.key} className="nesting-file">
          {file.status === 'reading' && <Loading label={`Reading ${file.entry.name}…`} />}
          {file.status === 'failed' && (
            <p className="nesting-problem" role="alert">
              {file.entry.name}: {file.error}
            </p>
          )}
          {file.parts?.problem && <p className="nesting-problem">{file.parts.problem}</p>}
          {file.drawing && <FileOptionsRow file={file} configure={configure} />}
          {file.parts?.parts.map((part) => {
            const key = partKey(file, part.index);
            const choice = choices.get(key);
            if (!choice) return null;
            const done = placed.get(key);
            const origin = origins?.get(key);
            return (
              <div
                key={key}
                className={'nesting-part' + (key === selected ? ' nesting-part-picked' : '')}
                aria-current={key === selected ? 'true' : undefined}
              >
                <PartThumbnail part={part} />
                <div className="nesting-part-body">
                  <div className="nesting-part-title">
                    <strong title={file.entry.path}>{part.name}</strong>
                    <span className="muted">
                      {sizeText(part.width, part.height, units)} · {areaText(part.area, units)}
                      {part.holes ? ` · ${part.holes} ${part.holes === 1 ? 'hole' : 'holes'}` : ''}
                    </span>
                  </div>
                  <div className="nesting-part-controls">
                    <label>
                      Quantity
                      <input
                        type="number"
                        min={0}
                        max={20000}
                        step={1}
                        aria-label={`Quantity of ${part.name}`}
                        value={choice.quantity}
                        onChange={(event) =>
                          choose(key, {
                            quantity: Math.max(
                              0,
                              Math.min(20000, Math.floor(Number(event.target.value) || 0)),
                            ),
                          })
                        }
                      />
                      {origin && <span className="muted">{origin}</span>}
                    </label>
                    <span className="nesting-choice">
                      Turn
                      <ChoiceButton
                        label={`Turns for ${part.name}`}
                        value={choice.rotation}
                        choices={turnChoices}
                        onChoose={(value) => choose(key, { rotation: value as RotationMode })}
                      />
                    </span>
                    <label className="nesting-check">
                      <input
                        type="checkbox"
                        checked={choice.mirror}
                        onChange={(event) => choose(key, { mirror: event.target.checked })}
                      />
                      Mirror
                    </label>
                    <label
                      className="nesting-check"
                      title="Keep the part's x axis along the sheet's length"
                    >
                      <input
                        type="checkbox"
                        checked={choice.grain}
                        onChange={(event) => choose(key, { grain: event.target.checked })}
                      />
                      Grain
                    </label>
                  </div>
                  {done !== undefined && done < choice.quantity && (
                    <p className="nesting-problem">
                      {done} of {choice.quantity} placed
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {file.parts && file.parts.notes.length > 0 && (
            <ul className="nesting-notes">
              {file.parts.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </PanelSection>
  );
}

/** Units when the drawing does not say them, grouping of separate outlines, and marked layers. */
function FileOptionsRow({
  file,
  configure,
}: {
  file: NestingFile;
  configure(file: string, patch: Partial<FileOptions>): void;
}) {
  const drawing = file.drawing!;
  const declared = !!drawing.units && !!unitInfo(drawing.units).mm;
  const outlines = file.parts?.outlines ?? 0;
  const layers = drawing.layers.filter((layer) => !layer.hidden);
  if (declared && outlines < 2 && layers.length < 2) return null;
  return (
    <div className="nesting-file-options">
      <span className="nesting-file-name">{file.entry.name}</span>
      {declared ? (
        <span className="muted">{unitInfo(drawing.units).label}</span>
      ) : (
        <span className="nesting-choice">
          Units not given
          <ChoiceButton
            label={`Units of ${file.entry.name}`}
            value={String(file.units)}
            choices={units
              .filter((unit) => unit.mm)
              .sort((a, b) => Number(!likely.has(a.id)) - Number(!likely.has(b.id)))
              .map((unit) => ({
                value: String(unit.id),
                label: unit.label,
                aliases: [unit.symbol],
              }))}
            onChoose={(value) => configure(file.key, { units: Number(value) })}
          />
        </span>
      )}
      {outlines > 1 && (
        <span className="nesting-choice">
          {outlines} outlines
          <ChoiceButton
            label={`Outlines in ${file.entry.name}`}
            value={file.together ? 'together' : 'apart'}
            choices={groupingChoices}
            onChoose={(value) => configure(file.key, { together: value === 'together' })}
          />
        </span>
      )}
      {layers.length > 1 && (
        <Disclosure
          variant="compact"
          className="nesting-layers"
          summary="Layers"
          meta={file.marks.length > 0 && `${file.marks.length} marked, not cut`}
        >
          {layers.map((layer) => (
            <label key={layer.name} className="nesting-check">
              <input
                type="checkbox"
                checked={file.marks.includes(layer.name)}
                onChange={(event) =>
                  configure(file.key, {
                    marks: event.target.checked
                      ? [...file.marks, layer.name]
                      : file.marks.filter((name) => name !== layer.name),
                  })
                }
              />
              {layer.name} <span className="muted">· mark only</span>
            </label>
          ))}
        </Disclosure>
      )}
    </div>
  );
}
