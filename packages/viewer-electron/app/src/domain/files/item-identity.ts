export type IdentityComponent = number | bigint;
declare const identityLifetime: unique symbol;
export type MomentIdentity = string & { readonly [identityLifetime]: 'moment' };
/** Unbranded serialized input remains readable, but a moment identity is not assignable here. */
export type TemporalIdentity = string & { readonly [identityLifetime]?: 'temporal' };
export type IdentityKind = 'file' | 'directory' | 'symlink' | 'other';
export interface VersionStat extends StatIdentity {
  mode: number;
}

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
export function itemIdentity(info: StatIdentity): MomentIdentity {
  const { dev: device, ino: inode } = exactIdentityParts(info);
  const suffix = device > safeMaximum || inode > safeMaximum ? ':u64' : '';
  return `${device}:${inode}${suffix}` as MomentIdentity;
}

/** FSKit allocates descending regular-file IDs in the unsigned upper half. They can change
 * without a content change. HFS+ CNIDs are 32-bit and APFS inode object IDs occupy 60 bits, so
 * neither filesystem's real inode IDs enter this range. Immediate comparisons still use them. */
export function syntheticInode(info: StatIdentity): boolean {
  return unsigned(info.ino) >= 1n << 63n;
}

export function identityKind(mode: number): IdentityKind {
  switch (mode & 0o170000) {
    case 0o100000: return 'file';
    case 0o040000: return 'directory';
    case 0o120000: return 'symlink';
    default: return 'other';
  }
}

export function temporalIdentity(value: string, kind: IdentityKind = 'file'): TemporalIdentity {
  if (kind === 'file' && value.endsWith(':u64')) {
    const exact = readItemIdentity(value);
    if (exact) {
      const [dev, ino] = exact.split(':');
      if (syntheticInode({ dev: BigInt(dev!), ino: BigInt(ino!) }))
        return `${dev}:synthetic:file` as TemporalIdentity;
    }
  }
  return value as TemporalIdentity;
}

export function versionIdentity(info: VersionStat): TemporalIdentity {
  return temporalIdentity(itemIdentity(info), identityKind(info.mode));
}

export function syntheticVersionIdentity(info: VersionStat): TemporalIdentity {
  return `${unsigned(info.dev)}:synthetic:${identityKind(info.mode)}` as TemporalIdentity;
}

export function matchesVersionIdentity(current: VersionStat, expected: TemporalIdentity): boolean {
  const previous = readTemporalIdentity(expected);
  if (previous?.endsWith(':synthetic:file'))
    return syntheticVersionIdentity(current) === previous;
  return previous !== undefined && versionIdentity(current) === previous;
}

export function readTemporalIdentity(value: string): TemporalIdentity | undefined {
  const synthetic = /^(0|[1-9]\d*):synthetic:file$/.exec(value);
  if (synthetic) {
    if (BigInt(synthetic[1]!) <= maximum) return value as TemporalIdentity;
    return;
  }
  const exact = readItemIdentity(value);
  return exact ? temporalIdentity(exact) : undefined;
}

export function sameTemporalIdentity(
  a: TemporalIdentity,
  b: TemporalIdentity,
  kindA?: IdentityKind,
  kindB?: IdentityKind,
): boolean {
  if (!/^-?\d+:/.test(a) && !/^-?\d+:/.test(b)) return a !== '' && a === b;
  const left = readTemporalIdentity(a);
  const right = readTemporalIdentity(b);
  if (left === undefined || right === undefined) return false;
  if (left === right) return true;
  if (left.endsWith(':synthetic:file') && kindB === 'file')
    return left.slice(0, left.indexOf(':')) === right.slice(0, right.indexOf(':'));
  if (right.endsWith(':synthetic:file') && kindA === 'file')
    return left.slice(0, left.indexOf(':')) === right.slice(0, right.indexOf(':'));
  return false;
}

export function exactIdentityParts(info: StatIdentity): { dev: bigint; ino: bigint } {
  return { dev: unsigned(info.dev), ino: unsigned(info.ino) };
}

/** Native identities are unsigned decimal strings, never JavaScript numbers. */
export function nativeItemIdentity(value: string): MomentIdentity | undefined {
  const parts = /^(0|[1-9]\d*):(0|[1-9]\d*)(:u64)?$/.exec(value);
  if (!parts) return;
  const dev = BigInt(parts[1]!);
  const ino = BigInt(parts[2]!);
  if (dev > maximum || ino > maximum) return;
  return itemIdentity({ dev, ino });
}

export function readItemIdentity(value: string): MomentIdentity | undefined {
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
