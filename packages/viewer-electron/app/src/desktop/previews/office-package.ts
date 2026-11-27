import { ReaderRefusal } from '../../domain/previews/reader-problem';
import path from 'node:path';
import { attribute, children, localName, type XMLNode } from './office-xml';
const damagedRelationships = (detail: string) =>
  new ReaderRefusal('This Office document has damaged package relationships.', detail);
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
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    throw damagedRelationships('Invalid encoding in Office relationship target.');
  }
  if (
    !decoded ||
    decoded.length > 1000 ||
    /[\\\u0000-\u001f?#]/.test(decoded) ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(decoded)
  )
    throw damagedRelationships('Invalid Office package relationship target.');
  const stack = decoded.startsWith('/')
    ? []
    : path.posix
        .dirname(source)
        .split('/')
        .filter((part) => part !== '.');
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!stack.length) throw damagedRelationships('Office relationship escapes its package.');
      stack.pop();
    } else stack.push(part);
  }
  return stack.join('/');
}
export function relationships(root: XMLNode): Relationship[] {
  if (localName(root) !== 'Relationships')
    throw damagedRelationships('Malformed Office relationships.');
  const ids = new Set<string>();
  return children(root, 'Relationship').map((node) => {
    const id = attribute(node, 'Id') || '',
      type = attribute(node, 'Type') || '',
      target = attribute(node, 'Target') || '';
    if (!id || ids.has(id) || !type || !target)
      throw damagedRelationships('Malformed or duplicate Office relationship.');
    ids.add(id);
    return { id, type, target, external: attribute(node, 'TargetMode') === 'External' };
  });
}
