import { unzipSync } from 'fflate';
import type { Unzipped } from 'fflate';

/** Expand the selected entries of a ZIP model package. The entry count and declared sizes
 * are checked before anything expands, and expansion stops at the declared size. */
export function unzipModelPackage(
  bytes: Uint8Array,
  format: string,
  select: (name: string) => boolean,
): Unzipped {
  let total = 0,
    count = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      total += file.originalSize;
      if (++count > 4096 || total > 128_000_000 || file.originalSize > 64_000_000)
        throw new Error(`This ${format} archive exceeds the preview limit.`);
      return select(file.name);
    },
  });
}
