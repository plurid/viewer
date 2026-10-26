import { useId } from 'react';
import { ChoiceButton } from '../ui/ChoiceMenu';

interface Sheet {
  name: string;
  hidden: boolean;
}
export function WorksheetTabs({
  sheets,
  value,
  choose,
}: {
  sheets: readonly Sheet[];
  value: string;
  choose(name: string): void;
}) {
  const id = useId();
  return (
    <div className="worksheet-tabs">
      <div role="tablist" aria-label="Worksheets" className="worksheet-tab-list">
        {sheets.map((sheet, index) => (
          <button
            key={sheet.name}
            role="tab"
            id={`${id}-${index}`}
            aria-selected={sheet.name === value}
            tabIndex={sheet.name === value ? 0 : -1}
            onClick={() => choose(sheet.name)}
            onKeyDown={(event) => {
              const target =
                event.key === 'ArrowRight'
                  ? (index + 1) % sheets.length
                  : event.key === 'ArrowLeft'
                    ? (index + sheets.length - 1) % sheets.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? sheets.length - 1
                        : -1;
              if (target < 0) return;
              event.preventDefault();
              choose(sheets[target]!.name);
              document.getElementById(`${id}-${target}`)?.focus();
            }}
          >
            {sheet.name}
            {sheet.hidden ? ' (hidden)' : ''}
          </button>
        ))}
      </div>
      <div className="workbook-sheet-picker">
        <ChoiceButton
          label="Worksheet"
          value={value}
          choices={sheets.map((sheet) => ({
            value: sheet.name,
            label: sheet.name + (sheet.hidden ? ' (hidden)' : ''),
          }))}
          onChoose={choose}
        />
      </div>
    </div>
  );
}
