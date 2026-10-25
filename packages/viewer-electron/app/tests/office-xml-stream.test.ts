import { expect, it } from 'vitest';
import { OfficeXMLStream, officeXML, type XMLNode } from '../src/desktop/previews/office-xml';

function chunked(bytes: Uint8Array, size: number, maximumNodes?: number): XMLNode {
  let root: XMLNode | undefined;
  const stack: XMLNode[] = [];
  const parser = new OfficeXMLStream(
    {
      open(node) {
        stack.at(-1)?.children.push(node);
        root ??= node;
        stack.push(node);
      },
      close() {
        stack.pop();
      },
      text(value) {
        const parent = stack.at(-1)!;
        const last = parent.children.at(-1);
        if (typeof last === 'string') parent.children[parent.children.length - 1] = last + value;
        else parent.children.push(value);
      },
    },
    maximumNodes,
  );
  for (let offset = 0; offset < bytes.length; offset += size)
    parser.write(bytes.subarray(offset, offset + size));
  parser.end();
  return root!;
}

it('keeps Unicode, entities, quoted delimiters, comments and CDATA intact across every byte boundary', () => {
  const xml =
    '<?xml version="1.0"?><root label="x &gt; y"><!-- note --><t>Știință 📏 &amp; &#x1f4cf;</t><empty/><c><![CDATA[<body>&text]]></c></root>';
  const bytes = Buffer.from(xml),
    expected = officeXML(bytes);
  for (const size of [1, 2, 3, 7, 16, 64, bytes.length])
    expect(chunked(bytes, size)).toEqual(expected);
});

it('decodes UTF-16 BOMs, code units and surrogate pairs split between chunks', () => {
  const xml = '<root><t>測定 📏 &amp; &#537;</t></root>';
  const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]);
  const big = Buffer.from(little).swap16();
  for (const bytes of [little, big])
    for (const size of [1, 3, 9, bytes.length])
      expect(chunked(bytes, size)).toEqual(officeXML(Buffer.from(xml)));
});

it('rejects declarations, malformed tails, entities and attributes regardless of chunking', () => {
  const invalid = [
    '<!DOCTYPE root [<!ENTITY x SYSTEM "file:///private/data">]><root>&x;</root>',
    '<root><t>value</t></wrong>',
    '<root/>tail',
    '<root/><second/>',
    '<root>&missing;</root>',
    '<root>&#0;</root>',
    '<root>]]></root>',
    '<root a="1"a="2"/>',
    '<root a="1" a="2"/>',
    '<root a=no/>',
    '<root></root attribute="x">',
    '<root><!-- bad -- comment --></root>',
  ];
  for (const xml of invalid)
    for (const size of [1, 7, xml.length])
      expect(() => chunked(Buffer.from(xml), size), xml).toThrow();
  expect(() => chunked(Buffer.from([60, 114, 62, 0xff, 60, 47, 114, 62]), 1)).toThrow();
});

it('bounds structure, nesting and incomplete or complete token sizes', () => {
  expect(() => chunked(Buffer.from('<root><a/><b/><c/></root>'), 7, 3)).toThrow('structure');
  expect(() => chunked(Buffer.from('<a>'.repeat(65) + '</a>'.repeat(65)), 3)).toThrow('nesting');
  for (const xml of [
    '<root><!--' + 'x'.repeat(270000) + '--></root>',
    '<root label="' + 'x'.repeat(270000) + '"/>',
    '<root><![CDATA[' + 'x'.repeat(270000) + ']]></root>',
  ])
    for (const size of [65536, xml.length])
      expect(() => chunked(Buffer.from(xml), size)).toThrow('token');
});
