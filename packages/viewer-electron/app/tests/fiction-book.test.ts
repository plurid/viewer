import { describe, expect, it } from 'vitest';
import { epubReference } from '../src/domain/previews/documents/epub';
import { fictionBookLimits, readFictionBook } from '../src/domain/previews/documents/fiction-book';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const book = (body: string, description = '', binaries = '', declaration = 'UTF-8') =>
  `<?xml version="1.0" encoding="${declaration}"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info>
<author><first-name>Ana</first-name><middle-name>M.</middle-name><last-name>Ionescu</last-name></author>
<author><nickname>Keeper</nickname></author>
<book-title>Harbour &amp; Light</book-title>
<coverpage><image l:href="#cover.png"/></coverpage>
<lang>ro</lang>
${description}
</title-info></description>
${body}
${binaries}
</FictionBook>`;
const encode = (text: string) => new TextEncoder().encode(text);

describe('FictionBook', () => {
  it('reads the title, authors and cover, and a chapter per top-level section', () => {
    const result = readFictionBook(
      encode(
        book(
          `<body><title><p>Harbour &amp; Light</p></title>
<section id="one"><title><p>First</p><p>light</p></title><p>See the <a l:href="#n1" type="note">note</a>.</p>
<image l:href="#cover.png"/><section><title><p>Inner</p></title><p><emphasis>Calm</emphasis> sea</p></section></section>
<section><p>Untitled</p></section></body>
<body name="notes"><section id="n1"><p>A note.</p></section></body>`,
          '<annotation><p>About the book.</p></annotation>',
          `<binary id="cover.png" content-type="image/png">${png.toString('base64')}</binary>`,
        ),
      ),
    );
    expect(result.metadata).toEqual({
      title: 'Harbour & Light',
      creator: 'Ana M. Ionescu; Keeper',
      language: 'ro',
    });
    expect(result.chapters.map((chapter) => [chapter.title, chapter.path])).toEqual([
      ['Harbour & Light', 'title'],
      ['First light', 'chapter-1'],
      ['Chapter 2', 'chapter-2'],
      ['Notes', 'notes-1'],
    ]);
    const [title, first] = result.chapters;
    expect(title!.html).toContain('<img src="images/1.png" alt="Cover">');
    expect(title!.html).toContain('<h1>Harbour &amp; Light</h1>');
    expect(title!.html).toContain('<strong>Ana M. Ionescu; Keeper</strong>');
    expect(title!.html).toContain('About the book.');
    // the body's own title repeats the book's and is not shown twice
    expect(title!.html.match(/Harbour &amp; Light/g)).toHaveLength(1);
    expect(first!.html).toContain('<h2>First<br>light</h2>');
    expect(first!.html).toContain('<h3>Inner</h3>');
    expect(first!.html).toContain('<em>Calm</em>');
    // a note link resolves to the chapter that holds its target
    const link = /<a href="([^"]+)">note<\/a>/.exec(first!.html)![1]!;
    expect(epubReference(first!.path!, link)).toEqual({ path: 'notes-1', fragment: 'n1' });
    // one picture, decoded once although two places show it
    expect(result.images).toEqual([
      { path: 'images/1.png', type: 'image/png', data: new Uint8Array(png) },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('reads the encoding its declaration names', () => {
    const text = book(
      '<body><section><p>Привет, маяк</p></section></body>',
      '',
      '',
      'windows-1251',
    );
    const bytes = Uint8Array.from(
      [...text].map((character) => {
        const code = character.charCodeAt(0);
        // Cyrillic letters in Windows-1251
        return code >= 0x410 && code <= 0x44f ? code - 0x410 + 0xc0 : code;
      }),
    );
    expect(readFictionBook(bytes).chapters[1]!.html).toContain('Привет, маяк');
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(book('<body/>'), 'utf16le'),
    ]);
    expect(readFictionBook(utf16).metadata.title).toBe('Harbour & Light');
  });

  it('refuses a DTD, entity declarations and undeclared entities', () => {
    const external = `<?xml version="1.0"?>
<!DOCTYPE FictionBook [<!ENTITY secret SYSTEM "file:///etc/passwd">]>
<FictionBook><body><p>&secret;</p></body></FictionBook>`;
    expect(() => readFictionBook(encode(external))).toThrow(/not supported/);
    expect(() => readFictionBook(encode(book('<body><p>&nbsp;</p></body>')))).toThrow();
    expect(() => readFictionBook(encode('<html><body/></html>'))).toThrow('not a FictionBook');
    expect(() => readFictionBook(encode('<FictionBook><body>'))).toThrow();
  });

  it('shows only pictures whose bytes are an image, within their limits', () => {
    const result = readFictionBook(
      encode(
        book(
          '<body><section><image l:href="#fake.png"/><image l:href="#missing"/><image l:href="https://example.invalid/remote.png"/></section></body>',
          '',
          `<binary id="cover.png" content-type="image/png">${Buffer.alloc(fictionBookLimits.imageBytes + 10).toString('base64')}</binary>
<binary id="fake.png" content-type="image/png">${Buffer.from('<svg onload="x"/>').toString('base64')}</binary>`,
        ),
      ),
    );
    expect(result.images).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(result.chapters[1]!.html).not.toContain('<img');
    expect(result.chapters[1]!.html).not.toContain('example.invalid');
  });

  it('bounds the file, its chapters and their text', () => {
    expect(() => readFictionBook(new Uint8Array(fictionBookLimits.bytes + 1))).toThrow('32 MB');
    const many = readFictionBook(
      encode(
        book(
          `<body>${'<section><p>x</p></section>'.repeat(fictionBookLimits.chapters + 5)}</body>`,
        ),
      ),
    );
    expect(many.chapters).toHaveLength(fictionBookLimits.chapters);
    expect(many.truncated).toBe(true);
    const long = readFictionBook(
      encode(book(`<body><section>${'<p>words words words</p>'.repeat(30_000)}</section></body>`)),
    );
    expect(long.chapters[1]!.html).toHaveLength(fictionBookLimits.chapterCharacters);
    expect(long.truncated).toBe(true);
  });
});
