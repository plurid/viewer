import { expect, it } from 'vitest';
import {
  copyXMLValue,
  inspectStructured,
  visibleDataRows,
} from '../src/domain/previews/data/structured';
import { parseXML } from '../src/domain/previews/data/xml';

it('retains qualified names, attributes, repeated elements and mixed text in source order', () => {
  const source =
    '<Invoice xmlns:c="urn:example" currency="RON">Before<c:Item id="1">A &amp; B</c:Item><![CDATA[between < >]]><c:Item id="2">Second</c:Item>After</Invoice>';
  const tree = inspectStructured(source, 'xml');
  expect(tree.error).toBeUndefined();
  const paths = visibleDataRows(tree, { all: true, open: [], closed: [] }).map((node) => node.path);
  expect(paths).toContain('/Invoice[1]/@xmlns:c');
  expect(paths).toContain('/Invoice[1]/c:Item[1]/@id');
  expect(paths).toContain('/Invoice[1]/c:Item[2]/@id');
  expect(paths.indexOf('/Invoice[1]/text()[2]')).toBeGreaterThan(
    paths.indexOf('/Invoice[1]/c:Item[1]'),
  );
  expect(paths.indexOf('/Invoice[1]/text()[2]')).toBeLessThan(
    paths.indexOf('/Invoice[1]/c:Item[2]'),
  );
  const copied = copyXMLValue(tree.nodes[0]!.value);
  expect(copied).toContain('xmlns:c="urn:example"');
  expect(copied).toContain('A &amp; B');
  expect(copied).toContain('between &lt; &gt;');
  expect(parseXML(new TextEncoder().encode(copied)).name).toBe('Invoice');
});

it('searches attributes and values while retaining their ancestor route', () => {
  const tree = inspectStructured(
    '<root><item code="needle">value</item><item>other</item></root>',
    'xml',
  );
  const rows = visibleDataRows(tree, { all: false, open: [], closed: [] }, 'needle');
  expect(rows.map((node) => node.path)).toEqual([
    '/root[1]',
    '/root[1]/item[1]',
    '/root[1]/item[1]/@code',
  ]);
});

it('accepts Unicode names and UTF-8 or BOM-marked UTF-16 input', () => {
  const text = '<資料 名="値">Neamț &amp; 中文</資料>';
  expect(inspectStructured(text, 'xml').error).toBeUndefined();
  const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const big = Buffer.from(little).swap16();
  expect(parseXML(little).name).toBe('資料');
  expect(parseXML(big).name).toBe('資料');
});

it.each([
  '<root><child></root>',
  '<!DOCTYPE root SYSTEM "https://example.invalid/private"><root/>',
  '<!DOCTYPE root [<!ENTITY secret SYSTEM "file:///private/example">]><root>&secret;</root>',
  '<root>&unknown;</root>',
  '<a>'.repeat(70) + '</a>'.repeat(70),
])('keeps malformed or unsafe XML out of the tree: %s', (source) => {
  expect(inspectStructured(source, 'xml').error).toBeTruthy();
});

it('bounds source size and node count', () => {
  expect(inspectStructured(' '.repeat(1_000_001), 'xml').error).toContain('limited');
  expect(inspectStructured('<root><a/><b/><c/></root>', 'xml', 2).error).toContain('limit');
});
