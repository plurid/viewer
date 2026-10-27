export interface XMLNode {
  name: string;
  attributes: Record<string, string>;
  children: (XMLNode | string)[];
}
export type XMLTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';
export function xmlEncoding(bytes: Uint8Array): XMLTextEncoding {
  return bytes[0] === 0xff && bytes[1] === 0xfe
    ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff
      ? 'utf-16be'
      : 'utf-8';
}
const namePattern = /^[\p{L}_:][\p{L}\p{N}_.:\-\u00b7\u0300-\u036f\u203f-\u2040]*/u;
const fail = () => new Error('Malformed or unsupported XML.');
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
export interface XMLEvents {
  open(node: XMLNode): void;
  close(name: string): void;
  text(value: string): void;
}

function tagNode(token: string): { node: XMLNode; closing: boolean; self: boolean } {
  const closing = token.startsWith('</'),
    self = token.endsWith('/>');
  const body = token.slice(closing ? 2 : 1, self ? -2 : -1);
  const name = body.match(namePattern)?.[0];
  if (!name || (closing && self)) throw fail();
  const node: XMLNode = { name, attributes: Object.create(null), children: [] };
  let cursor = name.length,
    attributes = 0;
  while (cursor < body.length) {
    const before = cursor;
    while (/\s/.test(body[cursor] || '') && cursor < body.length) cursor++;
    if (cursor === body.length) break;
    if (closing || cursor === before) throw fail();
    const attr = body.slice(cursor).match(namePattern)?.[0];
    if (!attr || Object.hasOwn(node.attributes, attr) || ++attributes > 100) throw fail();
    cursor += attr.length;
    while (/\s/.test(body[cursor] || '') && cursor < body.length) cursor++;
    if (body[cursor++] !== '=') throw fail();
    while (/\s/.test(body[cursor] || '') && cursor < body.length) cursor++;
    const quote = body[cursor++];
    if (quote !== '"' && quote !== "'") throw fail();
    const end = body.indexOf(quote, cursor);
    if (end < 0 || body.slice(cursor, end).includes('<')) throw fail();
    node.attributes[attr] = decode(body.slice(cursor, end));
    cursor = end + 1;
  }
  return { node, closing, self };
}

/** Bounded incremental scanner. All input is validated, including discarded
 * worksheet rows. No DTD, entity expansion, network resolution or HTML. */
export class XMLStream {
  private decoder?: TextDecoder;
  private prefix = new Uint8Array();
  private pending = '';
  private stack: string[] = [];
  private roots = 0;
  private nodes = 0;
  private ended = false;
  private textSuffix = '';
  constructor(
    private events: XMLEvents,
    private maximumNodes = 200000,
  ) {}

  write(bytes: Uint8Array): void {
    if (this.ended) throw fail();
    if (!this.decoder) {
      if (this.prefix.length) bytes = Uint8Array.from([...this.prefix, ...bytes]);
      if (bytes.length < 2) {
        this.prefix = bytes.slice();
        return;
      }
      const encoding = xmlEncoding(bytes);
      this.decoder = new TextDecoder(encoding, { fatal: true });
      this.prefix = new Uint8Array();
    }
    this.pending += this.decoder.decode(bytes, { stream: true });
    this.scan(false);
  }
  end(): void {
    if (this.ended || !this.decoder) throw fail();
    this.ended = true;
    this.pending += this.decoder.decode();
    this.scan(true);
    if (this.pending || this.stack.length || this.roots !== 1) throw fail();
  }
  private count(): void {
    if (++this.nodes > this.maximumNodes)
      throw new Error('XML structure exceeds the reader limit.');
  }
  private text(value: string): void {
    if (!value) return;
    this.count();
    if (!this.stack.length) {
      if (value.trim()) throw fail();
    } else this.events.text(value);
  }
  private scan(final: boolean): void {
    const xml = this.pending;
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) throw fail();
    let cursor = 0;
    while (cursor < xml.length) {
      if (xml[cursor] !== '<') {
        const next = xml.indexOf('<', cursor);
        let end = next < 0 ? xml.length : next;
        if (next < 0 && !final) {
          const amp = xml.lastIndexOf('&');
          if (amp >= cursor && xml.indexOf(';', amp) < 0) end = amp;
        }
        const raw = xml.slice(cursor, end);
        const joined = this.textSuffix + raw;
        if (joined.includes(']]>')) throw fail();
        this.textSuffix = joined.slice(-2);
        this.text(decode(raw));
        if (end === cursor) break;
        cursor = end;
        continue;
      }
      this.textSuffix = '';
      let end = -1;
      if (xml.startsWith('<!--', cursor)) {
        end = xml.indexOf('-->', cursor + 4);
        if (end < 0) break;
        if (end - cursor > 262144) throw new Error('XML token exceeds the reader limit.');
        if (xml.slice(cursor + 4, end).includes('--')) throw fail();
        cursor = end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', cursor)) {
        end = xml.indexOf(']]>', cursor + 9);
        if (end < 0) break;
        if (end - cursor > 262144) throw new Error('XML token exceeds the reader limit.');
        this.text(xml.slice(cursor + 9, end));
        cursor = end + 3;
        continue;
      }
      if (xml.startsWith('<?', cursor)) {
        end = xml.indexOf('?>', cursor + 2);
        if (end < 0) break;
        if (end - cursor > 262144) throw new Error('XML token exceeds the reader limit.');
        cursor = end + 2;
        continue;
      }
      const remaining = xml.slice(cursor);
      if (!final && ['<!--', '<![CDATA[', '<?'].some((prefix) => prefix.startsWith(remaining)))
        break;
      if (xml.startsWith('<!', cursor))
        throw new Error('XML declarations and external entities are not supported.');
      let quote = '';
      for (let at = cursor + 1; at < xml.length; at++) {
        const character = xml[at]!;
        if (quote) {
          if (character === quote) quote = '';
        } else if (character === '"' || character === "'") quote = character;
        else if (character === '>') {
          end = at;
          break;
        }
      }
      if (end < 0) break;
      if (end - cursor > 262144) throw new Error('XML token exceeds the reader limit.');
      const { node, closing, self } = tagNode(xml.slice(cursor, end + 1));
      if (closing) {
        if (this.stack.pop() !== node.name) throw fail();
        this.events.close(node.name);
      } else {
        this.count();
        if (!this.stack.length && ++this.roots > 1) throw fail();
        if (this.stack.length >= 63) throw new Error('XML nesting exceeds the reader limit.');
        this.events.open(node);
        if (self) this.events.close(node.name);
        else this.stack.push(node.name);
      }
      cursor = end + 1;
    }
    this.pending = xml.slice(cursor);
    if (this.pending.length > 262144) throw new Error('XML token exceeds the reader limit.');
    if (final && this.pending) throw fail();
  }
}

export function parseXML(bytes: Uint8Array, maximumNodes = 200000): XMLNode {
  if (bytes.length > 4000000) throw new Error('XML part exceeds 4 MB.');
  let root: XMLNode | undefined;
  const stack: XMLNode[] = [];
  const reader = new XMLStream(
    {
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
    },
    maximumNodes,
  );
  reader.write(bytes);
  reader.end();
  if (!root) throw fail();
  return root;
}
