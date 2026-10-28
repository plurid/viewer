import { zipSync, strToU8 } from 'fflate';
import { imageFixture } from '../media-fixtures';

export function readerBookFixture(): Buffer {
  return Buffer.from(
    zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="Book/package.opf"/></rootfiles></container>',
      ),
      'Book/package.opf': strToU8(
        '<package><metadata><dc:title>Field notebook</dc:title></metadata><manifest><item id="first" href="first.xhtml"/><item id="notes" href="notes.xhtml"/><item id="picture" href="images/illustration.png" media-type="image/png"/></manifest><spine><itemref idref="first"/><itemref idref="notes"/></spine></package>',
      ),
      'Book/first.xhtml': strToU8(
        '<html><head><title>Field notebook</title></head><body><h1>Field notebook</h1><figure><img src="images/illustration.png" alt="Generated field illustration" width="64" height="64"/><figcaption>A local illustration.</figcaption></figure><p>A copper <em>circuit</em> keeps its context.</p><p><a href="notes.xhtml#footnote-one">Open footnote</a></p>' +
          Array.from(
            { length: 100 },
            (_, index) =>
              `<p id="paragraph-${index}">Observation ${index}: keep the source and its explanation together.</p>`,
          ).join('') +
          '<script>window.__epubUnsafe = true</script><img src="https://example.invalid/tracker.png" alt="External image blocked"/></body></html>',
      ),
      'Book/notes.xhtml': strToU8(
        '<html><body><h1>Field notes</h1><aside id="footnote-one" epub:type="footnote"><p>The copper circuit uses a saved reference.</p><a href="first.xhtml#paragraph-40">Return to observation</a></aside></body></html>',
      ),
      'Book/images/illustration.png': imageFixture,
    }),
  );
}
