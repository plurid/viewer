import type { DocumentData } from '../../domain/services';
import type { EPUBImage } from '../../domain/previews/documents/epub';
import { fictionBookLimits, readFictionBook } from '../../domain/previews/documents/fiction-book';
import { documentBytes } from './formats';
import { imageDimensions } from './image-dimensions';

const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[\t ]+/g, ' ')
    .trim();

/** A FictionBook as the book reader reads an EPUB: chapters, with the book's pictures carried as
 * `data:` URLs, each within the reader's size and pixel bounds. Caller must hold a read
 * coordination claim for this file. */
export async function extractFictionBook(file: string): Promise<DocumentData> {
  const book = readFictionBook(await documentBytes(file, fictionBookLimits.bytes));
  const images: EPUBImage[] = book.images.flatMap((image) => {
    const data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    const dimensions = imageDimensions(data);
    if (!dimensions || dimensions.width * dimensions.height > 64_000_000) return [];
    return [
      {
        path: image.path,
        size: data.length,
        data: `data:${image.type};base64,${data.toString('base64')}`,
      },
    ];
  });
  const result: DocumentData = {
    path: file,
    metadata: book.metadata,
    evidence: [],
    text: '',
    chapters: book.chapters,
    epub: { images },
    truncated: book.truncated || images.length < book.images.length,
  };
  for (const [key, value] of Object.entries(book.metadata))
    result.evidence.push({ source: 'publication:' + key, text: value });
  book.chapters.forEach((chapter, index) =>
    result.evidence.push({
      source: 'chapter:' + chapter.title,
      text: plainText(chapter.html).slice(0, 30_000),
      anchor: { kind: 'epub', chapter: index },
    }),
  );
  if (result.truncated)
    result.coverageReason = 'Some chapters, text or pictures exceed the supported reading limits.';
  result.text = result.evidence
    .map((item) => '[' + item.source + ']\n' + item.text)
    .join('\n\n')
    .slice(0, 150_000);
  return result;
}
