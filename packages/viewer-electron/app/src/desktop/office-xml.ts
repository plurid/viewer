export interface XMLNode {
  name: string;
  attributes: Record<string, string>;
  children: (XMLNode | string)[];
}
const namePattern = /^[A-Za-z_][\w.:-]*/;
const fail = () => new Error('Malformed or unsupported Office XML.');
function decode(text: string): string {
  return text.replace(/&([^;\s<&]{1,32});|&/g, (entity, name: string | undefined) => {
    const predefined: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (name && Object.hasOwn(predefined, name)) return predefined[name] ?? entity;
    if (name && /^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(name)) {
      const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 32 &&
          code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff) &&
          code !== 0xfffe &&
          code !== 0xffff)
      )
        return String.fromCodePoint(code);
    }
    throw fail();
  });
}
/** Linear scanner; no DTD, entity expansion, network resolution, or HTML interpretation. */
export function officeXML(bytes: Uint8Array): XMLNode {
  if (bytes.length > 4000000) throw new Error('Office XML part exceeds 4 MB.');
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  const xml = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) throw fail();
  const root: XMLNode = { name: '', attributes: Object.create(null), children: [] };
  const stack = [root];
  let cursor = 0,
    nodes = 0;
  const append = (value: XMLNode | string) => {
    if (++nodes > 200000) throw new Error('Office XML structure exceeds the reader limit.');
    const parent = stack.at(-1);
    if (!parent) throw fail();
    parent.children.push(value);
  };
  while (cursor < xml.length) {
    const next = xml.indexOf('<', cursor);
    if (next !== cursor) {
      const end = next < 0 ? xml.length : next;
      append(decode(xml.slice(cursor, end)));
      cursor = end;
      continue;
    }
    if (xml.startsWith('<!--', cursor)) {
      const end = xml.indexOf('-->', cursor + 4);
      if (end < 0) throw fail();
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', cursor)) {
      const end = xml.indexOf(']]>', cursor + 9);
      if (end < 0) throw fail();
      append(xml.slice(cursor + 9, end));
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<?', cursor)) {
      const end = xml.indexOf('?>', cursor + 2);
      if (end < 0) throw fail();
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith('<!', cursor))
      throw new Error('Office XML declarations and external entities are not supported.');
    cursor++;
    const closing = xml[cursor] === '/';
    if (closing) cursor++;
    const match = xml.slice(cursor).match(namePattern);
    if (!match) throw fail();
    const name = match[0];
    cursor += name.length;
    const node: XMLNode = { name, attributes: Object.create(null), children: [] };
    while (true) {
      while (/\s/.test(xml[cursor] || '') && cursor < xml.length) cursor++;
      if (xml[cursor] === '>' || xml.startsWith('/>', cursor)) break;
      if (closing) throw fail();
      const attr = xml.slice(cursor).match(namePattern)?.[0];
      if (!attr || Object.hasOwn(node.attributes, attr)) throw fail();
      cursor += attr.length;
      while (/\s/.test(xml[cursor] || '') && cursor < xml.length) cursor++;
      if (xml[cursor++] !== '=') throw fail();
      while (/\s/.test(xml[cursor] || '') && cursor < xml.length) cursor++;
      const quote = xml[cursor++];
      if (quote !== '"' && quote !== "'") throw fail();
      const end = xml.indexOf(quote, cursor);
      if (end < 0 || xml.slice(cursor, end).includes('<')) throw fail();
      node.attributes[attr] = decode(xml.slice(cursor, end));
      cursor = end + 1;
      if (Object.keys(node.attributes).length > 100) throw fail();
    }
    const self = xml[cursor] === '/';
    cursor += self ? 2 : 1;
    if (closing) {
      if (self || stack.length === 1 || stack.pop()!.name !== name) throw fail();
    } else {
      append(node);
      if (!self) stack.push(node);
      if (stack.length > 64) throw new Error('Office XML nesting exceeds the reader limit.');
    }
  }
  const elements = root.children.filter((node): node is XMLNode => typeof node !== 'string');
  if (
    stack.length !== 1 ||
    elements.length !== 1 ||
    root.children.some((node) => typeof node === 'string' && node.trim())
  )
    throw fail();
  const [element] = elements;
  if (!element) throw fail();
  return element;
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
