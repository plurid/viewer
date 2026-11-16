export type IdentityComponent = number | bigint;
declare const identityLifetime: unique symbol;
export type MomentIdentity = string & { readonly [identityLifetime]: 'moment' };
export type SerializedIdentity = string & { readonly [identityLifetime]?: 'serialized' };
export type ObservedIdentity = MomentIdentity | SerializedIdentity;
/** Serialized strings become temporal identities only through the explicit boundary parser. */
export type TemporalIdentity = string & { readonly [identityLifetime]: 'temporal' };
export type IdentityKind = 'file' | 'directory' | 'symlink' | 'other';
export interface VersionStat extends StatIdentity {
  mode: number;
  birthtimeMs: number;
}

export interface StatIdentity {
  dev: IdentityComponent;
  ino: IdentityComponent;
}

const maximum = (1n << 64n) - 1n;
const safeMaximum = BigInt(Number.MAX_SAFE_INTEGER);
export const olderIdentityMessage =
  'Cannot undo because this older record does not have an exact file identity.';
export const olderCreationMessage =
  'Cannot undo because this older record does not include the file creation time.';

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

/** FSKit counts down from UINT64_MAX. Reserve only its top 2^32 values for regular files,
 * without another filesystem lookup per entry. This excludes real upper-half IDs such as NFS
 * IDs near 2^63. APFS object IDs are 60-bit and HFS+ CNIDs are 32-bit. A different filesystem
 * using this narrow range still receives the conservative synthetic-file checks. */
export function syntheticInode(info: StatIdentity): boolean {
  return unsigned(info.ino) >= (1n << 64n) - (1n << 32n);
}

export function identityKind(mode: number): IdentityKind {
  switch (mode & 0o170000) {
    case 0o100000:
      return 'file';
    case 0o040000:
      return 'directory';
    case 0o120000:
      return 'symlink';
    default:
      return 'other';
  }
}

/** Type is observed by the caller, never guessed while decoding an older record. Synthetic
 * evidence carries creation time on the wire; safe identities retain their earlier layout. */
export function temporalIdentity(
  value: string,
  kind?: IdentityKind,
  created?: number,
): TemporalIdentity {
  if (kind && value.endsWith(':u64')) {
    const exact = readItemIdentity(value);
    if (exact) {
      const [dev, ino] = exact.split(':');
      if (kind === 'file' && syntheticInode({ dev: BigInt(dev!), ino: BigInt(ino!) }))
        return `${dev}:synthetic:file${Number.isFinite(created) ? ':' + created : ''}` as TemporalIdentity;
      return `${exact}:${kind}` as TemporalIdentity;
    }
  }
  return value as TemporalIdentity;
}

export function versionIdentity(info: VersionStat): TemporalIdentity {
  return temporalIdentity(itemIdentity(info), identityKind(info.mode), info.birthtimeMs);
}

export function missingTemporalEvidence(value: string): boolean {
  if (/^\d+:synthetic:file$/.test(value)) return true;
  const exact = value.endsWith(':u64') ? readItemIdentity(value) : undefined;
  if (!exact) return false;
  const [dev, ino] = exact.split(':');
  return syntheticInode({ dev: BigInt(dev!), ino: BigInt(ino!) });
}

export function matchesVersionIdentity(current: VersionStat, expected: TemporalIdentity): boolean {
  const previous = readTemporalIdentity(expected);
  return (
    previous !== undefined &&
    !missingTemporalEvidence(previous) &&
    versionIdentity(current) === previous
  );
}

export function readTemporalIdentity(value: string): TemporalIdentity | undefined {
  const synthetic = /^(0|[1-9]\d*):synthetic:file(?::(.+))?$/.exec(value);
  if (synthetic) {
    if (BigInt(synthetic[1]!) > maximum) return;
    const created = synthetic[2];
    if (
      created === undefined ||
      (Number.isFinite(Number(created)) && String(Number(created)) === created)
    )
      return value as TemporalIdentity;
    return;
  }
  const typed = /^(.*:u64):(file|directory|symlink|other)$/.exec(value);
  if (typed) return readItemIdentity(typed[1]!) ? (value as TemporalIdentity) : undefined;
  const exact = readItemIdentity(value);
  return exact ? (exact as unknown as TemporalIdentity) : undefined;
}

export function sameTemporalIdentity(a: TemporalIdentity, b: TemporalIdentity): boolean {
  if (!/^-?\d+:/.test(a) && !/^-?\d+:/.test(b)) return a !== '' && a === b;
  if (a !== b || missingTemporalEvidence(a)) return false;
  return readTemporalIdentity(a) !== undefined;
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
  if (a !== b) return false;
  // The common APFS form fits well below MAX_SAFE_INTEGER; avoid BigInt parsing per selection.
  if (/^(?:0|[1-9]\d{0,14}):(?:0|[1-9]\d{0,14})$/.test(a)) return true;
  return readItemIdentity(a) !== undefined;
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
