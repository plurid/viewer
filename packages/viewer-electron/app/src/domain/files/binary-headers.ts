import { formatBytes } from './entries';

/**
 * BINARY HEADERS: what a program's first bytes say beyond its kind. Mach-O CPU types and universal
 * slices, PE machine and subsystem, ELF class and machine, the WebAssembly and Java class file
 * versions. Each reads only the head `identifyBytes` was given; a field past it is left out.
 */
export interface HeaderDetail {
  label: string;
  value: string;
}

const unsigned = (head: Uint8Array, at: number, size: 2 | 4, little: boolean) => {
  if (at + size > head.length) return undefined;
  let value = 0;
  for (let index = 0; index < size; index++)
    value = value * 256 + head[at + (little ? size - 1 - index : index)]!;
  return value;
};
const unsigned64 = (head: Uint8Array, at: number) => {
  const high = unsigned(head, at, 4, false);
  const low = unsigned(head, at + 4, 4, false);
  return high === undefined || low === undefined ? undefined : high * 2 ** 32 + low;
};
const hex = (value: number) => '0x' + value.toString(16).toUpperCase();

const abi64 = 0x01000000;
const cpuTypes: Readonly<Record<number, string>> = {
  7: 'i386',
  [7 | abi64]: 'x86_64',
  12: 'arm',
  [12 | abi64]: 'arm64',
  [12 | 0x02000000]: 'arm64_32',
  18: 'ppc',
  [18 | abi64]: 'ppc64',
};
/** A CPU type with the subtypes Apple names: arm64e, x86_64h. */
function cpuName(type: number, subtype: number): string {
  const name = cpuTypes[type] ?? `CPU ${hex(type)}`;
  const variant = subtype & 0x00ffffff;
  if (name === 'arm64' && variant === 2) return 'arm64e';
  if (name === 'x86_64' && variant === 8) return 'x86_64h';
  return name;
}
const machMagic: Readonly<Record<string, boolean>> = {
  feedface: false,
  feedfacf: false,
  cefaedfe: true,
  cffaedfe: true,
};
function machO(head: Uint8Array, little: boolean): HeaderDetail[] {
  const type = unsigned(head, 4, 4, little);
  const subtype = unsigned(head, 8, 4, little);
  const commands = unsigned(head, 16, 4, little);
  const details: HeaderDetail[] = [];
  if (type !== undefined && subtype !== undefined)
    details.push({ label: 'Architecture', value: cpuName(type, subtype) });
  if (commands !== undefined) details.push({ label: 'Load commands', value: String(commands) });
  return details;
}
/** A universal binary's slices; `wide` is the 64-bit header of CAFEBABF. */
function universal(head: Uint8Array, wide: boolean): HeaderDetail[] {
  const count = unsigned(head, 4, 4, false) ?? 0;
  const slices: string[] = [];
  const size = wide ? 32 : 20;
  for (let index = 0; index < Math.min(count, 64); index++) {
    const at = 8 + index * size;
    const type = unsigned(head, at, 4, false);
    const subtype = unsigned(head, at + 4, 4, false);
    const offset = wide ? unsigned64(head, at + 8) : unsigned(head, at + 8, 4, false);
    const length = wide ? unsigned64(head, at + 16) : unsigned(head, at + 12, 4, false);
    if (type === undefined || subtype === undefined || offset === undefined || length === undefined)
      break;
    slices.push(`${cpuName(type, subtype)}, ${formatBytes(length)} at ${hex(offset)}`);
  }
  return [
    { label: 'Architectures', value: String(count) },
    ...slices.map((value, index) => ({ label: `Slice ${index + 1}`, value })),
  ];
}
/** Class file major versions name the Java release: 49 is Java 5, 45 to 48 are 1.1 to 1.4. */
function javaClass(head: Uint8Array): HeaderDetail[] {
  const minor = unsigned(head, 4, 2, false) ?? 0;
  const major = unsigned(head, 6, 2, false) ?? 0;
  const release = major >= 49 ? String(major - 44) : major >= 45 ? `1.${major - 44}` : undefined;
  return [
    { label: 'Class file version', value: `${major}.${minor}` },
    ...(release
      ? [{ label: 'Java', value: minor === 0xffff ? `${release} with preview features` : release }]
      : []),
  ];
}

const peMachines: Readonly<Record<number, string>> = {
  0x0: 'Any',
  0x14c: 'x86',
  0x8664: 'x86-64',
  0xaa64: 'ARM64',
  0xa641: 'ARM64EC',
  0x1c0: 'ARM',
  0x1c4: 'ARM Thumb-2',
  0x200: 'Itanium',
  0xebc: 'EFI byte code',
  0x5064: 'RISC-V 64-bit',
};
const peSubsystems: Readonly<Record<number, string>> = {
  1: 'Native',
  2: 'Windows GUI',
  3: 'Windows console',
  9: 'Windows CE',
  10: 'EFI application',
  11: 'EFI boot service driver',
  12: 'EFI runtime driver',
  14: 'Xbox',
  16: 'Windows boot application',
};
function portable(head: Uint8Array): HeaderDetail[] {
  const header = unsigned(head, 0x3c, 4, true);
  if (header === undefined || unsigned(head, header, 4, false) !== 0x50450000) return [];
  const machine = unsigned(head, header + 4, 2, true);
  const sections = unsigned(head, header + 6, 2, true);
  const optional = header + 24;
  const magic = unsigned(head, optional, 2, true);
  const subsystem = unsigned(head, optional + 68, 2, true);
  // the CLR runtime header is data directory 14; a .NET assembly has one
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const runtime = unsigned(head, directories + 14 * 8, 4, true);
  const details: HeaderDetail[] = [];
  if (machine !== undefined)
    details.push({ label: 'Machine', value: peMachines[machine] ?? hex(machine) });
  if (magic === 0x10b || magic === 0x20b)
    details.push({ label: 'Format', value: magic === 0x20b ? 'PE32+ (64-bit)' : 'PE32' });
  if (subsystem !== undefined && peSubsystems[subsystem])
    details.push({ label: 'Subsystem', value: peSubsystems[subsystem] });
  if (runtime) details.push({ label: 'Runtime', value: '.NET' });
  if (sections !== undefined) details.push({ label: 'Sections', value: String(sections) });
  return details;
}

const elfMachines: Readonly<Record<number, string>> = {
  2: 'SPARC',
  3: 'x86',
  8: 'MIPS',
  20: 'PowerPC',
  21: 'PowerPC 64-bit',
  22: 'IBM S/390',
  40: 'ARM',
  43: 'SPARC V9',
  62: 'x86-64',
  183: 'AArch64',
  243: 'RISC-V',
  247: 'BPF',
  258: 'LoongArch',
};
const elfSystems: Readonly<Record<number, string>> = {
  0: 'System V',
  3: 'Linux',
  6: 'Solaris',
  9: 'FreeBSD',
  12: 'OpenBSD',
};
function elf(head: Uint8Array): HeaderDetail[] {
  const little = head[5] !== 2;
  const machine = unsigned(head, 18, 2, little);
  const system = head[7];
  return [
    { label: 'Class', value: head[4] === 2 ? '64-bit' : '32-bit' },
    { label: 'Byte order', value: little ? 'Little-endian' : 'Big-endian' },
    ...(machine === undefined
      ? []
      : [{ label: 'Machine', value: elfMachines[machine] ?? `Machine ${machine}` }]),
    ...(system !== undefined && elfSystems[system]
      ? [{ label: 'System', value: elfSystems[system] }]
      : []),
  ];
}

const starts = (head: Uint8Array, magic: readonly number[]) =>
  magic.every((byte, index) => head[index] === byte);

/** Further facts the header of a program, library or class file holds; empty for other bytes. */
export function headerDetails(head: Uint8Array): HeaderDetail[] {
  const magic = Array.from(head.subarray(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  if (Object.hasOwn(machMagic, magic)) return machO(head, machMagic[magic]!);
  if (magic === 'cafebabe') {
    const count = unsigned(head, 4, 4, false) ?? 0;
    return count > 0 && count < 45 ? universal(head, false) : javaClass(head);
  }
  if (magic === 'cafebabf') return universal(head, true);
  if (starts(head, [0x7f, 0x45, 0x4c, 0x46])) return elf(head);
  if (starts(head, [0x4d, 0x5a])) return portable(head);
  if (starts(head, [0, 0x61, 0x73, 0x6d])) {
    const version = unsigned(head, 4, 4, true);
    return version === undefined ? [] : [{ label: 'Version', value: String(version) }];
  }
  if (starts(head, [0x64, 0x65, 0x78, 0x0a]) && head.length >= 8)
    return [{ label: 'Version', value: String.fromCharCode(...head.subarray(4, 7)) }];
  return [];
}
