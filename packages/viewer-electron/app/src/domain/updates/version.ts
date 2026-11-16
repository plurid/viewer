import { z } from 'zod';

export const alphaVersionSchema = z
  .string()
  .regex(/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)-(0|[1-9]\d*)$/)
  .refine(
    (version) => version.split(/[.-]/).every((part) => Number.isSafeInteger(Number(part))),
    'Alpha version numbers must be safe integers.',
  );

function parts(version: string): number[] {
  return alphaVersionSchema.parse(version).split(/[.-]/).map(Number);
}

export function compareAlphaVersions(left: string, right: string): number {
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < a.length; index++) {
    const difference = a[index]! - b[index]!;
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function nextAlphaVersion(version: string): string {
  const [, launcher, revision, release] = parts(version);
  if (release === Number.MAX_SAFE_INTEGER)
    throw new Error('The release number cannot be increased safely.');
  return `0.${launcher}.${revision}-${release! + 1}`;
}

/** Apple's Store version omits the alpha ender; the embedded app keeps its alpha version. */
export function storeVersion(version: string): string {
  return parts(version).slice(1).join('.');
}
