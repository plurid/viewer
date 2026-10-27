import { XMLStream, type XMLEvents, type XMLNode } from '../../domain/previews/data/xml';
export type { XMLNode } from '../../domain/previews/data/xml';
const fail = () => new Error('Malformed or unsupported Office XML.');
const officeError = (error: unknown) =>
  new Error(
    (error instanceof Error ? error.message : String(error)).replace(/\bXML\b/g, 'Office XML'),
  );
/** Keep Office's existing error vocabulary over the shared bounded XML scanner. */
export class OfficeXMLStream extends XMLStream {
  constructor(events: XMLEvents, maximumNodes = 200000) {
    super(events, maximumNodes);
  }
  override write(bytes: Uint8Array): void {
    try {
      super.write(bytes);
    } catch (error) {
      throw officeError(error);
    }
  }
  override end(): void {
    try {
      super.end();
    } catch (error) {
      throw officeError(error);
    }
  }
}
export function officeXML(bytes: Uint8Array): XMLNode {
  if (bytes.length > 4000000) throw new Error('Office XML part exceeds 4 MB.');
  let root: XMLNode | undefined;
  const stack: XMLNode[] = [];
  const reader = new OfficeXMLStream({
    open(node) {
      if (stack.length) stack.at(-1)!.children.push(node);
      else root = node;
      stack.push(node);
    },
    close() {
      stack.pop();
    },
    text(value) {
      stack.at(-1)!.children.push(value);
    },
  });
  reader.write(bytes);
  reader.end();
  if (!root) throw fail();
  return root;
}
export const localName = (node: XMLNode) => node.name.split(':').at(-1)!;
export const children = (node: XMLNode, name?: string): XMLNode[] =>
  node.children.filter(
    (item): item is XMLNode => typeof item !== 'string' && (!name || localName(item) === name),
  );
export const child = (node: XMLNode, name: string) => children(node, name)[0];
export function attribute(node: XMLNode, name: string): string | undefined {
  const matches = Object.entries(node.attributes).filter(([key]) => key.split(':').at(-1) === name);
  if (matches.length > 1) throw fail();
  return matches[0]?.[1];
}
export function xmlText(node: XMLNode): string {
  return node.children.map((item) => (typeof item === 'string' ? item : xmlText(item))).join('');
}
export function descendants(node: XMLNode, name: string): XMLNode[] {
  const found: XMLNode[] = [];
  const visit = (item: XMLNode) => {
    for (const nested of children(item)) {
      if (localName(nested) === name) found.push(nested);
      else visit(nested);
    }
  };
  visit(node);
  return found;
}
