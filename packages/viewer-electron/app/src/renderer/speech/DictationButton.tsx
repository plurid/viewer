import { useState } from 'react';
import { DictationDialog } from './DictationDialog';
import { IconButton } from '../ui/primitives';

/** A changed target unmounts capture; a transcript can never land in a different document. */
export function DictationButton({
  target,
  destination,
  disabled = false,
  onUse,
  maxLength,
  compact = false,
}: {
  target: string;
  destination: string;
  disabled?: boolean;
  maxLength?: number;
  onUse(text: string): void;
  /** A microphone icon for a crowded header, named Dictate as its tooltip. */
  compact?: boolean;
}) {
  const [opened, setOpened] = useState<string>();
  return (
    <>
      {compact ? (
        <IconButton
          icon="microphone"
          label="Dictate"
          disabled={disabled}
          onClick={() => setOpened(target)}
        />
      ) : (
        <button type="button" disabled={disabled} onClick={() => setOpened(target)}>
          Dictate
        </button>
      )}
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
