import { parseXML, type XMLNode } from './xml';

/** Apple's binary property list, read for inspection; its objects are bounded by count and depth. */
const header = 'bplist00';
const maximumObjects = 200_000;
const maximumDepth = 64;
/** Seconds between 1970 and 2001, the binary plist epoch. */
const epoch = 978_307_200;

export function isBinaryPlist(bytes: Uint8Array): boolean {
  return bytes.length >= 40 && new TextDecoder().decode(bytes.subarray(0, 8)) === header;
}

/**
 * The property list as plain values: dictionaries become objects, dates ISO strings, data a
 * short description of its size. Malformed offsets, cycles and oversized lists are refused.
 */
export function decodeBinaryPlist(bytes: Uint8Array): unknown {
  if (!isBinaryPlist(bytes)) throw new Error('This is not a binary property list.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trailer = bytes.length - 32;
  const offsetSize = view.getUint8(trailer + 6);
  const referenceSize = view.getUint8(trailer + 7);
  const count = Number(view.getBigUint64(trailer + 8));
  const top = Number(view.getBigUint64(trailer + 16));
  const table = Number(view.getBigUint64(trailer + 24));
  if (
    ![1, 2, 4, 8].includes(offsetSize) ||
    ![1, 2, 4, 8].includes(referenceSize) ||
    count < 1 ||
    count > maximumObjects ||
    top >= count ||
    table + count * offsetSize > trailer
  )
    throw new Error('The property list has an invalid trailer.');
  const unsigned = (at: number, size: number) => {
    if (at < 0 || at + size > trailer) throw new Error('A property list offset is out of range.');
    let value = 0;
    for (let index = 0; index < size; index++) value = value * 256 + view.getUint8(at + index);
    return value;
  };
  const offsets = Array.from({ length: count }, (_, index) =>
    unsigned(table + index * offsetSize, offsetSize),
  );
  /** A collection's length: in the marker's low bits, or an integer object after it. */
  const length = (at: number, info: number): [number, number] => {
    if (info !== 0xf) return [info, at + 1];
    const marker = view.getUint8(at + 1);
    if (marker >> 4 !== 0x1) throw new Error('A property list length is malformed.');
    const size = 1 << (marker & 0xf);
    return [unsigned(at + 2, size), at + 2 + size];
  };
  const read = (reference: number, depth: number, open: Set<number>): unknown => {
    if (reference >= count) throw new Error('A property list reference is out of range.');
    if (depth > maximumDepth) throw new Error('The property list nests too deeply.');
    if (open.has(reference)) throw new Error('The property list refers to itself.');
    const at = offsets[reference]!;
    const marker = view.getUint8(at);
    const type = marker >> 4,
      info = marker & 0xf;
    switch (type) {
      case 0x0:
        return info === 0x8 ? false : info === 0x9 ? true : null;
      case 0x1: {
        const size = 1 << info;
        if (size === 8) return Number(view.getBigInt64(at + 1));
        return unsigned(at + 1, size);
      }
      case 0x2:
        return info === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1);
      case 0x3:
        return new Date((view.getFloat64(at + 1) + epoch) * 1000).toISOString();
      case 0x4: {
        const [size] = length(at, info);
        return `<data, ${size.toLocaleString()} bytes>`;
      }
      case 0x5: {
        const [size, start] = length(at, info);
        if (start + size > trailer) throw new Error('A property list string is out of range.');
        return new TextDecoder('latin1').decode(bytes.subarray(start, start + size));
      }
      case 0x6: {
        const [size, start] = length(at, info);
        if (start + size * 2 > trailer) throw new Error('A property list string is out of range.');
        return new TextDecoder('utf-16be').decode(bytes.subarray(start, start + size * 2));
      }
      case 0x8:
        return { UID: unsigned(at + 1, info + 1) };
      case 0xa:
      case 0xc:
      case 0xd: {
        const [size, start] = length(at, info);
        const references = (index: number) =>
          unsigned(start + index * referenceSize, referenceSize);
        const inside = new Set(open).add(reference);
        if (type !== 0xd)
          return Array.from({ length: size }, (_, index) =>
            read(references(index), depth + 1, inside),
          );
        const entries: [string, unknown][] = [];
        for (let index = 0; index < size; index++) {
          const key = read(references(index), depth + 1, inside);
          entries.push([String(key), read(references(size + index), depth + 1, inside)]);
        }
        return Object.fromEntries(entries);
      }
      default:
        throw new Error('The property list holds an object type Viewer does not read.');
    }
  };
  return read(top, 0, new Set());
}

const elements = (node: XMLNode) =>
  node.children.filter((child): child is XMLNode => typeof child !== 'string');
const content = (node: XMLNode) =>
  node.children.filter((child) => typeof child === 'string').join('');

/** An XML property list as the same plain values the binary form gives. */
export function xmlPlistValue(text: string): unknown {
  // Apple's declaration only names its public DTD. One with an internal subset, where entities
  // live, is left in place, and the XML reader refuses it.
  const body = text.replace(/<!DOCTYPE plist\s[^[>]*>/, '');
  const root = parseXML(new TextEncoder().encode(body));
  if (root.name !== 'plist') throw new Error('This XML is not a property list.');
  const value = (node: XMLNode, depth: number): unknown => {
    if (depth > maximumDepth) throw new Error('The property list nests too deeply.');
    switch (node.name) {
      case 'dict': {
        const children = elements(node);
        const entries: [string, unknown][] = [];
        for (let index = 0; index + 1 < children.length; index += 2) {
          if (children[index]!.name !== 'key') throw new Error('A property list key is missing.');
          entries.push([content(children[index]!), value(children[index + 1]!, depth + 1)]);
        }
        return Object.fromEntries(entries);
      }
      case 'array':
        return elements(node).map((child) => value(child, depth + 1));
      case 'string':
        return content(node);
      case 'integer':
      case 'real':
        return Number(content(node));
      case 'true':
        return true;
      case 'false':
        return false;
      case 'date':
        return content(node).trim();
      case 'data': {
        const base64 = content(node).replace(/\s/g, '');
        const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
        return `<data, ${((base64.length / 4) * 3 - padding).toLocaleString()} bytes>`;
      }
      default:
        throw new Error(`The property list holds an unknown element, <${node.name}>.`);
    }
  };
  const top = elements(root)[0];
  return top ? value(top, 0) : null;
}
