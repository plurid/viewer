/**
 * A count with its noun, as people read it: `plural(1, 'file')` is "1 file", `plural(1200,
 * 'file')` is "1,200 files". Pass `many` where adding an s is wrong: `plural(2, 'copy', 'copies')`.
 * The interface is US English, so the grouping is too, whatever the machine's locale.
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${pluralWord(count, one, many)}`;
}

/** The noun alone, for a count shown apart from it: "3 / 12 pages" puts the count elsewhere. */
export function pluralWord(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}
