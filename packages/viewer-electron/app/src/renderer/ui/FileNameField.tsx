import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { getState } from '../state/store';
import { FormField } from './FormField';

/** Control characters, and the direction marks that can make "gnp.exe" read as "exe.png". */
const invisible = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/** Extensions that name one format: a pasted "photo.jpeg" is a JPEG for the `.jpg` suffix. */
const extensionAliases: readonly (readonly string[])[] = [
  ['jpg', 'jpeg', 'jpe'],
  ['tif', 'tiff'],
  ['htm', 'html'],
  ['mpg', 'mpeg'],
];

/**
 * What is wrong with an output name's stem, in words; empty when it can be used. A numbered series
 * adds `numberedSuffix` (" 001") before the extension, and the 255 limit counts it: APFS counts
 * UTF-16 code units, as `length` does.
 */
export function fileNameError(stem: string, extension: string, numberedSuffix = ''): string {
  if (!stem.trim()) return 'Enter a file name.';
  if (stem === '.' || stem === '..') return 'Enter a name other than “.” or “..”.';
  if (stem.includes('/')) return "A file name can't contain “/”.";
  if (invisible.test(stem)) return 'Remove the invisible control character from the name.';
  if (stem.startsWith('.') && getState().bootstrap.platform !== 'win32')
    return 'A name that starts with “.” makes a hidden file. Remove the dot.';
  if (getState().bootstrap.platform === 'win32' && /[<>:"\\|?*]/.test(stem))
    return 'On Windows, a file name can\'t contain < > : " \\ | ? *.';
  if ((stem + numberedSuffix + '.' + extension).length > 255)
    return 'Keep the file name within 255 characters.';
  return '';
}

/**
 * The stem as export writes it: without spaces at either end, which Finder lists out of order,
 * and without the extension already shown beside it, as a pasted full name has.
 */
function cleanStem(value: string, extension: string): string {
  const stem = value.trim();
  const lower = extension.toLowerCase();
  const names = extensionAliases.find((group) => group.includes(lower)) ?? [lower];
  for (const name of names) {
    const suffix = '.' + name;
    if (stem.toLowerCase().endsWith(suffix) && stem.length > suffix.length)
      return stem.slice(0, -suffix.length).trimEnd();
  }
  return stem;
}

/** What is already at the output path, so the message names it. */
interface Existing {
  path: string;
  directory: boolean;
}

/**
 * AN OUTPUT FILE NAME (DESIGN.md, the Output Form Rule): an editable stem filling the row and the
 * format's extension as a fixed suffix. A long stem scrolls in its input, which opens at its end.
 * Problems and an existing file with the name show under it; the export adds "copy" to a name
 * that exists (`keepBothName` in desktop/operations/file-transfer.ts).
 */
export function FileNameField({
  value,
  extension,
  onChange,
  folder,
  label = 'File name',
  disabled,
  numberedSuffix = '',
}: {
  value: string;
  extension: string;
  onChange(value: string): void;
  /** Where the file goes, to say when a file with the name is already there. */
  folder: string;
  label?: string;
  disabled?: boolean;
  /** What a numbered series adds to the first file's stem, such as " 001". */
  numberedSuffix?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [existing, setExisting] = useState<Existing>();
  const fullName = value + '.' + extension;
  const error = fileNameError(value, extension, numberedSuffix);
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  const firstName = value + numberedSuffix + '.' + extension;
  const target = folder ? folder.replace(/[\\/]+$/, '') + separator + firstName : '';

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const showEnd = () => {
      element.setSelectionRange(element.value.length, element.value.length);
      element.scrollLeft = element.scrollWidth;
    };
    showEnd();
    const dialog = element.closest('dialog');
    if (!dialog || dialog.open) return;
    // A closed dialog has no measurable input width until showModal adds its open attribute.
    const observer = new MutationObserver(() => {
      if (!dialog.open) return;
      showEnd();
      observer.disconnect();
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, [extension]);

  useEffect(() => {
    if (!target || error || !window.viewer.stat) return;
    let current = true;
    void window.viewer.stat(target).then(
      (entry) => {
        if (current) setExisting(entry ? { path: target, directory: entry.directory } : undefined);
      },
      () => {
        if (current) setExisting(undefined);
      },
    );
    return () => {
      current = false;
    };
  }, [target, error]);

  // A check still running for a new name must not show the last name's answer.
  const conflict = !!target && existing?.path === target ? existing : undefined;
  return (
    <FormField label={label} htmlFor={id} as="div">
      <div className="file-name-control">
        <input
          id={id}
          ref={input}
          aria-label={`${label}: ${fullName}`}
          aria-invalid={!!error}
          aria-describedby={error || conflict ? id + '-message' : undefined}
          title={fullName}
          value={value}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            const stem = cleanStem(value, extension);
            if (stem !== value) onChange(stem);
          }}
        />
        <span className="file-name-suffix" aria-hidden="true">
          .{extension}
        </span>
      </div>
      {error ? (
        <p id={id + '-message'} className="dialog-field-error" role="alert">
          {error}
        </p>
      ) : conflict ? (
        <p id={id + '-message'} className="dialog-field-help" role="status">
          A {conflict.directory ? 'folder' : 'file'} named “{firstName}” is already here. Export
          adds “copy” to the new name.
        </p>
      ) : null}
    </FormField>
  );
}
