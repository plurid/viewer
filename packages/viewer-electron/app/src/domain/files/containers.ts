/** ZIP files under other names: Java, Android, iOS, Python, NuGet, VS Code and Firefox packages,
 * Google Earth places and comic books. The reader knows a ZIP by its bytes. */
export const zipContainers = [
  'jar',
  'war',
  'ear',
  'apk',
  'aab',
  'ipa',
  'whl',
  'nupkg',
  'vsix',
  'xpi',
  'kmz',
  'cbz',
];

/** A gzip file that is not a TAR archive holds one file, named by its own name without `.gz`. */
export function gzipMember(name: string): string | undefined {
  const member = /^(.+)\.gz$/i.exec(name)?.[1];
  return member && !/\.tar$/i.test(member) ? member : undefined;
}

export interface GzipLimits {
  compressed: number;
  expanded: number;
}
/** A preview expands at most 8 MB; a larger compressed file cannot fit, whatever it records. */
export const gzipLimits: GzipLimits = {
  compressed: 16 * 1024 * 1024,
  expanded: 8_000_000,
};
