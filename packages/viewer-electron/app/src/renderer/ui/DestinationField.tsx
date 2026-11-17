import { useState } from 'react';
import { errorMessage } from '../../domain/errors';
import { baseName } from '../../domain/workspaces/planes';
import { Button, CopyButton } from './primitives';
import { Icon } from './Icon';
import { FormField } from './FormField';
import { PathLabel, useHomeText, usePathCopy, usePathText } from './PathLabel';

/**
 * A FOLDER CHOICE (DESIGN.md, the Output Form Rule): the folder's own name, its path as a path
 * label under it, and Choose… beside them. Choosing never accepts typed text: the chooser owns
 * that, with its editable path and new-folder entry.
 */
export function DestinationField({
  path,
  onChange,
  label = 'Save in',
  empty = 'Choose a folder',
  disabled,
}: {
  path: string;
  onChange(path: string): void | Promise<void>;
  label?: string;
  /** What the field says before a folder is chosen. */
  empty?: string;
  disabled?: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');
  const shownError = useHomeText(error);
  const copy = usePathCopy(path);
  const whole = 'text' in copy ? copy.text : path;
  const name = path ? baseName(path) : empty;
  // A root is its own name: its path line would repeat it.
  const pathLine = usePathText(path) !== name;

  const choose = async () => {
    setChoosing(true);
    setError('');
    try {
      const next = await window.viewer.chooseFolder(path || undefined);
      if (next) await onChange(next);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setChoosing(false);
    }
  };

  return (
    <FormField label={label} as="div">
      <div className="destination-field">
        <div
          className="destination-location"
          role="group"
          title={path ? whole : undefined}
          aria-label={`${label}: ${path ? whole : empty}`}
        >
          <Icon name="folder" size={16} />
          <span className="destination-identity">
            <span className="destination-name">{name}</span>
            {path && pathLine && (
              <PathLabel className="destination-path" path={path} tooltip={false} />
            )}
          </span>
          {path && <CopyButton copy={copy} label="Copy folder path" />}
        </div>
        <Button variant="secondary" disabled={disabled || choosing} onClick={() => void choose()}>
          {choosing ? 'Choosing…' : 'Choose…'}
        </Button>
      </div>
      {error && (
        <p className="dialog-field-error" role="alert">
          {shownError}
        </p>
      )}
    </FormField>
  );
}
