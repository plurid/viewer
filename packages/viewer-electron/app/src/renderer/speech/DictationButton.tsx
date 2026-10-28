import { useState } from 'react';
import { DictationDialog } from './DictationDialog';

/** A changed target unmounts capture; a transcript can never land in a different document. */
export function DictationButton({
  target,
  destination,
  disabled = false,
  onUse,
  maxLength,
}: {
  target: string;
  destination: string;
  disabled?: boolean;
  maxLength?: number;
  onUse(text: string): void;
}) {
  const [opened, setOpened] = useState<string>();
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setOpened(target)}>
        Dictate
      </button>
      {opened === target && !disabled && (
        <DictationDialog
          destination={destination}
          maxLength={maxLength}
          onClose={() => setOpened(undefined)}
          onUse={onUse}
        />
      )}
    </>
  );
}
