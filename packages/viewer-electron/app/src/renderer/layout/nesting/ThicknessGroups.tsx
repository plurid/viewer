import type { GroupFigures } from '../../../domain/fabrication/jobs';
import { combinedFigures } from '../../../domain/fabrication/jobs';
import { countText, durationText, moneyText } from '../../../domain/layout/nesting/format';

export interface ThicknessTab {
  key: string;
  label: string;
  files: number;
  /** Absent while its drawings are read, or when none has a quantity. */
  figures?: GroupFigures;
  reading: boolean;
  currency: string;
}

const sheetsText = (figures: GroupFigures) =>
  `${figures.estimated ? 'About ' : ''}${countText(figures.sheets, 'sheet')}`;

/** One nesting per thickness: a tab for each, and their sheets, time and cost together. */
export function ThicknessGroups({
  groups,
  selected,
  choose,
}: {
  groups: readonly ThicknessTab[];
  selected: string;
  choose(key: string): void;
}) {
  const known = groups.flatMap((group) => (group.figures ? [group.figures] : []));
  const total = combinedFigures(known);
  const currencies = new Set(groups.map((group) => group.currency));
  const [currency] = currencies;
  return (
    <section className="nesting-thickness" aria-label="By thickness">
      <div className="nesting-thickness-tabs" role="group" aria-label="Thickness">
        {groups.map((group) => (
          <button
            type="button"
            key={group.key}
            aria-pressed={group.key === selected}
            aria-label={`${group.label}, ${countText(group.files, 'file')}`}
            onClick={() => choose(group.key)}
          >
            {group.label}
            <span className="muted"> · {countText(group.files, 'file')}</span>
          </button>
        ))}
      </div>
      <table className="nesting-thickness-table">
        <thead>
          <tr>
            <th scope="col">Thickness</th>
            <th scope="col">Sheets</th>
            <th scope="col">Pieces</th>
            <th scope="col">Time</th>
            <th scope="col">Cost</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key} aria-current={group.key === selected ? 'true' : undefined}>
              <th scope="row">{group.label}</th>
              {group.figures ? (
                <>
                  <td>{sheetsText(group.figures)}</td>
                  <td>
                    {group.figures.placed < group.figures.pieces
                      ? `${group.figures.placed} of ${group.figures.pieces}`
                      : group.figures.pieces}
                  </td>
                  <td>{durationText(group.figures.minutes)}</td>
                  <td>{moneyText(group.figures.total, group.currency)}</td>
                </>
              ) : (
                <td colSpan={4} className="muted">
                  {group.reading ? 'Reading…' : 'Nothing to nest'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">All</th>
            <td>{sheetsText(total)}</td>
            <td>{total.pieces}</td>
            <td>{durationText(total.minutes)}</td>
            <td>
              {currencies.size === 1 ? moneyText(total.total, currency ?? '') : 'Mixed currencies'}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
