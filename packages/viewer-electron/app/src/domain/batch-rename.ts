import type { ActionRequest } from './services';
export interface RenameInput {
  names: { name: string; extension: string; metadata?: Record<string, string> }[];
  options: NonNullable<ActionRequest['options']>;
  template: string;
}
/** Pure naming policy, executed in an owned worker when regular expressions are enabled. */
export function renameNames(input: RenameInput): string[] {
  if (input.names.length > 2000 || JSON.stringify(input).length > 16 * 1024 * 1024)
    throw new Error('Select a smaller rename batch.');
  const options = input.options;
  const pattern =
    options.regex && options.find
      ? new RegExp(options.find, options.ignoreCase ? 'gi' : 'g')
      : undefined;
  return input.names.map((file, index) => {
    let name = file.name.slice(0, file.name.length - file.extension.length);
    if (options.find)
      name = pattern
        ? name.replace(pattern, options.replace || '')
        : name.split(options.find).join(options.replace || '');
    if (options.case === 'lower') name = name.toLocaleLowerCase();
    if (options.case === 'upper') name = name.toLocaleUpperCase();
    if (options.case === 'title')
      name = name
        .toLocaleLowerCase()
        .replace(
          /(^|[\s_-])(\p{L})/gu,
          (_match, before, letter) => before + letter.toLocaleUpperCase(),
        );
    name = (options.prefix || '') + name + (options.suffix || '');
    const fields: Record<string, string> = {
      ...file.metadata,
      name,
      extension: file.extension,
      number: String((options.start ?? 1) + index).padStart(options.padding ?? 0, '0'),
    };
    return (options.template || input.template).replace(
      /\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g,
      (_match, key: string) => {
        const value = Object.hasOwn(fields, key) ? fields[key] : undefined;
        if (value === undefined) throw new Error('Missing filename template field: ' + key);
        return value;
      },
    );
  });
}
