export type IdentityComponent = number | bigint;

export interface StatIdentity {
  dev: IdentityComponent;
  ino: IdentityComponent;
}

const maximum = (1n << 64n) - 1n;
const safeMaximum = BigInt(Number.MAX_SAFE_INTEGER);
export const olderIdentityMessage =
  'Cannot undo because this older record does not have an exact file identity.';

function unsigned(value: IdentityComponent): bigint {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))
    throw new Error('The file identity cannot be verified from rounded numbers.');
  const exact = BigInt(value);
  if (exact < -(1n << 63n) || exact > maximum)
    throw new Error('The file identity is outside the unsigned 64-bit range.');
  return BigInt.asUintN(64, exact);
}

/** Safe older numbers already encode an exact identity. The suffix distinguishes exact large
 * values from untrustworthy decimal strings produced by older builds from rounded numbers. */
export function itemIdentity(info: StatIdentity): string {
  const { dev: device, ino: inode } = exactIdentityParts(info);
  const suffix = device > safeMaximum || inode > safeMaximum ? ':u64' : '';
  return `${device}:${inode}${suffix}`;
}

export function exactIdentityParts(info: StatIdentity): { dev: bigint; ino: bigint } {
  return { dev: unsigned(info.dev), ino: unsigned(info.ino) };
}

/** Native identities are unsigned decimal strings, never JavaScript numbers. */
export function nativeItemIdentity(value: string): string | undefined {
  const parts = /^(0|[1-9]\d*):(0|[1-9]\d*)(:u64)?$/.exec(value);
  if (!parts) return;
  const dev = BigInt(parts[1]!);
  const ino = BigInt(parts[2]!);
  if (dev > maximum || ino > maximum) return;
  return itemIdentity({ dev, ino });
}

export function readItemIdentity(value: string): string | undefined {
  const exact = nativeItemIdentity(value);
  if (!exact || (exact.endsWith(':u64') && !value.endsWith(':u64'))) return;
  return exact;
}

export function sameIdentity(a: string, b: string): boolean {
  // Virtual resources use opaque capability identities rather than filesystem identities.
  if (!/^-?\d+:/.test(a) && !/^-?\d+:/.test(b)) return a !== '' && a === b;
  const identity = readItemIdentity(a);
  return identity !== undefined && identity === readItemIdentity(b);
}

export function sameDevice(a: StatIdentity, b: StatIdentity): boolean {
  return unsigned(a.dev) === unsigned(b.dev);
}

/** The native protocol predates the exact-large suffix but has always used exact strings. */
export function nativeIdentityArgument(value: string): string {
  const identity = readItemIdentity(value);
  if (!identity) throw new Error('The file identity cannot be verified; inspect the item again.');
  return identity.replace(/:u64$/, '');
}

/** Old output proofs contain numeric identity components. Only safe components can reproduce
 * those hashes without accepting rounded numbers as evidence for removal. */
export function legacyIdentityParts(info: StatIdentity): [number, number] | undefined {
  const dev = unsigned(info.dev);
  const ino = unsigned(info.ino);
  if (dev > safeMaximum || ino > safeMaximum) return;
  return [Number(dev), Number(ino)];
}
