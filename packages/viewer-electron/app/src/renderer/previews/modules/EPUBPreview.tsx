import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import type { PreviewContext } from '../contracts';
import type { EPUBReference, EPUBChapter } from '../../../domain/previews/documents/epub';
import type { BookMatch } from '../epub-content';
import { readBookChapter, bookNodes, searchBook } from '../epub-content';
import { usePreviewState } from '../state';
import { usePreviewScroll } from '../scroll';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { Empty, IconButton, Loading } from '../../ui/primitives';
import { useOfficeDocument } from '../useOfficeDocument';
import { EPUBBookmarks } from '../EPUBBookmarks';
import { readEPUBBookmarks } from '../../../domain/previews/documents/epub-bookmarks';
export { chapterNodes } from '../epub-content';
const emptyChapters: EPUBChapter[] = [];
/** The only pictures a book may carry inline: base64 PNG, JPEG, GIF or WebP, as the desktop
 * reader checked them. */
const pictureURL = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** An EPUB, or a FictionBook read into the same chapters. */
export default function EPUBPreview(context: PreviewContext) {
  const kind = context.resource.entry.extension.toLowerCase() === 'fb2' ? 'FictionBook' : 'EPUB';
  const { document, error, retry } = useOfficeDocument(context);
  const [chapter, setChapter] = usePreviewState(context, 'epub.chapter', 0);
  useEffect(() => {
    if (context.evidence?.anchor.kind === 'epub') setChapter(context.evidence.anchor.chapter);
  }, [context.evidence, setChapter]);
  const [size, setSize] = usePreviewState(context, 'epub.size', context.reading?.fontSize ?? 16);
  const [contents, setContents] = usePreviewState(context, 'epub.contents', true);
  const [savedBookmarks, setBookmarks] = usePreviewState<unknown>(context, 'epub.bookmarks', []);
  const bookmarks = useMemo(() => readEPUBBookmarks(savedBookmarks), [savedBookmarks]);
  const [marking, setMarking] = useState(false);
  const chapters = document?.chapters || emptyChapters;
  const position = Math.min(chapter, Math.max(0, chapters.length - 1));
  const html = chapters[position]?.html || '';
  const content = useMemo(() => readBookChapter(html), [html]);
  const chapterRef = useRef<HTMLElement>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; matches: BookMatch[]; limited: boolean }>();
  const [searchError, setSearchError] = useState('');
  const [match, setMatch] = useState<BookMatch>();
  const [jump, setJump] = useState<{
    chapter: number;
    fragment?: string;
    match?: BookMatch;
    top?: number;
    left?: number;
  }>();
  const [back, setBack] = useState<{ chapter: number; top: number; left: number }[]>([]);
  const [navigationError, setNavigationError] = useState('');
  const searchField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (finding) searchField.current?.focus();
  }, [finding]);
  useEffect(() => {
    setSearchError('');
    if (!query.trim()) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void searchBook(chapters, query, abort.signal).then(
        (result) => {
          if (!abort.signal.aborted) setFound({ query, ...result });
        },
        (error: Error) => {
          if (!abort.signal.aborted) setSearchError(error.message);
        },
      );
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [chapters, query]);
  const saveReturn = () =>
    setBack((previous) =>
      [
        ...previous,
        {
          chapter: position,
          top: chapterRef.current?.scrollTop ?? 0,
          left: chapterRef.current?.scrollLeft ?? 0,
        },
      ].slice(-32),
    );
  const navigate = (target: EPUBReference) => {
    const next = chapters.findIndex((chapter) => chapter.path === target.path);
    if (next < 0) return;
    saveReturn();
    setNavigationError('');
    setMatch(undefined);
    setChapter(next);
    setJump({ chapter: next, fragment: target.fragment });
  };
  const images = useMemo(
    () => new Set(document?.epub?.images.filter((image) => !image.data).map((image) => image.path)),
    [document?.epub],
  );
  const pictures = useMemo(
    () =>
      new Map(
        document?.epub?.images.flatMap((image) =>
          image.data && pictureURL.test(image.data) ? [[image.path, image.data] as const] : [],
        ),
      ),
    [document?.epub],
  );
  const nodes = bookNodes(content, {
    chapter: chapters[position],
    chapters,
    images,
    pictures,
    context,
    navigate,
    match: match?.chapter === position ? match : undefined,
  });
  usePreviewScroll(context.state, chapterRef, 'epub', {
    ready: !!document,
    section: String(position),
    restore: !context.evidence,
  });
  useLayoutEffect(() => {
    const element = chapterRef.current;
    if (!jump || jump.chapter !== position || !element || !document) return;
    if (jump.top !== undefined) {
      element.scrollTop = jump.top;
      element.scrollLeft = jump.left ?? 0;
    } else {
      const destination = jump.match
        ? element.querySelector<HTMLElement>('[data-epub-match]')
        : jump.fragment
          ? Array.from(element.querySelectorAll<HTMLElement>('[data-epub-anchor]')).find(
              (node) => node.dataset.epubAnchor === jump.fragment,
            )
          : undefined;
      if (destination) {
        destination.scrollIntoView({ block: 'center' });
        destination.focus({ preventScroll: true });
      } else if (jump.fragment)
        setNavigationError('This link target is outside the available chapter content.');
      else element.scrollTop = 0;
    }
    setJump(undefined);
  }, [jump, position, document]);
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'epub-find',
          label: 'Find in book',
          aliases: ['search', 'epub'],
          available: !!chapters.length,
          run: () => setFinding(true),
        },
        {
          id: 'epub-bookmarks',
          label: 'Show bookmarks',
          aliases: ['save reading position', 'epub'],
          available: !!chapters.length,
          run: () => setMarking(true),
        },
        {
          id: 'epub-contents',
          label: 'Show / hide contents',
          available: !!chapters.length,
          run: () => {
            setContents(marking ? true : !contents);
            setMarking(false);
          },
        },
        {
          id: 'epub-next',
          label: 'Next chapter',
          available: position < chapters.length - 1,
          run: () => setChapter(position + 1),
        },
        {
          id: 'epub-previous',
          label: 'Previous chapter',
          available: position > 0,
          run: () => setChapter(position - 1),
        },
      ],
      [chapters.length, position, setChapter, setContents, contents, marking],
    ),
  );
  if (error)
    return (
      <Empty icon="warning" title={`${kind} could not be opened`} detail={error}>
        <button onClick={context.retry ?? retry}>Try again</button>
      </Empty>
    );
  if (!document) return <Loading label={`Reading ${kind}…`} />;
  return (
    <div className="epub-viewer">
      <PreviewToolbar context={context}>
        <IconButton
          icon="list"
          label="Show contents"
          aria-pressed={contents && !marking}
          onClick={() => {
            setContents(marking ? true : !contents);
            setMarking(false);
          }}
        />
        <IconButton
          icon="left"
          label="Previous chapter"
          disabled={!position}
          onClick={() => setChapter(position - 1)}
        />
        <span>
          {position + 1} / {chapters.length}
        </span>
        <IconButton
          icon="right"
          label="Next chapter"
          disabled={position >= chapters.length - 1}
          onClick={() => setChapter(position + 1)}
        />
        {back.length > 0 && (
          <button
            aria-label="Back to reading position"
            onClick={() => {
              const previous = back.at(-1)!;
              setBack((items) => items.slice(0, -1));
              setChapter(previous.chapter);
              setMatch(undefined);
              setJump(previous);
            }}
          >
            Back
          </button>
        )}
        <span className="toolbar-spacer" />
        <button aria-pressed={marking} onClick={() => setMarking(!marking)}>
          Bookmarks
        </button>
        <button aria-pressed={finding} onClick={() => setFinding(!finding)}>
          Find in book
        </button>
        <button aria-label="Smaller text" onClick={() => setSize(Math.max(12, size - 1))}>
          A−
        </button>
        <button aria-label="Larger text" onClick={() => setSize(Math.min(30, size + 1))}>
          A+
        </button>
      </PreviewToolbar>
      {navigationError && (
        <p className="inline-warning" role="status">
          {navigationError}
        </p>
      )}
      {finding && (
        <section className="epub-search" aria-label="Find in book">
          <div>
            <input
              ref={searchField}
              type="search"
              aria-label="Search book text"
              placeholder="Find in book"
              maxLength={160}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setFinding(false);
                }
              }}
            />
            <span className="muted" role="status">
              {searchError ||
                (query.trim()
                  ? found?.query === query
                    ? `${found.matches.length}${found.limited ? '+' : ''} matches${document.truncated || found.limited ? ' · Partial search' : ''}`
                    : 'Searching…'
                  : 'Search the available chapters')}
            </span>
          </div>
          {found?.query === query && (
            <ol>
              {found.matches.map((item, index) => (
                <li key={index}>
                  <button
                    onClick={() => {
                      saveReturn();
                      setChapter(item.chapter);
                      setMatch(item);
                      setJump({ chapter: item.chapter, match: item });
                    }}
                  >
                    <strong>{chapters[item.chapter]?.title}</strong> <span>{item.quote}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      <div className="epub-body">
        {marking ? (
          <EPUBBookmarks
            bookmarks={bookmarks}
            chapters={chapters}
            current={() => ({
              chapter: position,
              path: chapters[position]?.path ?? '',
              top: Math.max(0, Math.round(chapterRef.current?.scrollTop ?? 0)),
              left: Math.max(0, Math.round(chapterRef.current?.scrollLeft ?? 0)),
            })}
            change={setBookmarks}
            open={(bookmark) => {
              const chapter = bookmark.path
                ? chapters.findIndex((item) => item.path === bookmark.path)
                : bookmark.chapter;
              if (chapter < 0 || !chapters[chapter]) return;
              saveReturn();
              setMatch(undefined);
              setNavigationError('');
              setChapter(chapter);
              setJump({ chapter, top: bookmark.top, left: bookmark.left });
            }}
          />
        ) : (
          contents && (
            <nav aria-label={`${kind} contents`}>
              {chapters.map((item, index) => (
                <button
                  key={index}
                  aria-current={position === index ? 'page' : undefined}
                  onClick={() => setChapter(index)}
                >
                  {item.title}
                </button>
              ))}
            </nav>
          )
        )}
        <article
          ref={chapterRef}
          key={position}
          className="epub-chapter"
          style={{ fontSize: size }}
        >
          {nodes}
          {(document.truncated || content.limited) && (
            <p className="muted">This preview reached its extraction limit.</p>
          )}
        </article>
      </div>
    </div>
  );
}
