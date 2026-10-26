import path from 'node:path';
import { attribute, children, localName, type XMLNode } from './office-xml';
const relationshipTypes = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/',
];
export const typeIs = (type: string, name: string) =>
  relationshipTypes.some((prefix) => type === prefix + name);
export interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}
/** OPC targets are package paths, never filesystem paths or fetchable URLs. */
export function partTarget(source: string, target: string): string {
  const decoded = decodeURIComponent(target);
  if (
    !decoded ||
    decoded.length > 1000 ||
    /[\\\u0000-\u001f?#]/.test(decoded) ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(decoded)
  )
    throw new Error('Invalid Office package relationship target.');
  const stack = decoded.startsWith('/')
    ? []
    : path.posix
        .dirname(source)
        .split('/')
        .filter((part) => part !== '.');
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!stack.length) throw new Error('Office relationship escapes its package.');
      stack.pop();
    } else stack.push(part);
  }
  return stack.join('/');
}
export function relationships(root: XMLNode): Relationship[] {
  if (localName(root) !== 'Relationships') throw new Error('Malformed Office relationships.');
  const ids = new Set<string>();
  return children(root, 'Relationship').map((node) => {
    const id = attribute(node, 'Id') || '',
      type = attribute(node, 'Type') || '',
      target = attribute(node, 'Target') || '';
    if (!id || ids.has(id) || !type || !target)
      throw new Error('Malformed or duplicate Office relationship.');
    ids.add(id);
    return { id, type, target, external: attribute(node, 'TargetMode') === 'External' };
  });
}
