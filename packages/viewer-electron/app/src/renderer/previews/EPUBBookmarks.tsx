import { useState } from 'react';
import type { EPUBChapter } from '../../domain/previews/documents/epub';
import type { EPUBBookmark } from '../../domain/previews/documents/epub-bookmarks';
import { saveEPUBBookmark } from '../../domain/previews/documents/epub-bookmarks';
import { errorMessage } from '../../domain/errors';

export function EPUBBookmarks({
  bookmarks,
  chapters,
  current,
  change,
  open,
}: {
  bookmarks: readonly EPUBBookmark[];
  chapters: readonly EPUBChapter[];
  current(): Omit<EPUBBookmark, 'id' | 'name'>;
  change(value: EPUBBookmark[]): void;
  open(bookmark: EPUBBookmark): void;
}) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<EPUBBookmark>();
  const [error, setError] = useState('');
  return (
    <nav className="epub-bookmarks" aria-label="Book bookmarks">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const point = editing ?? current();
            const title = name.trim() || chapters[point.chapter]?.title || 'Reading position';
            change(
              saveEPUBBookmark(bookmarks, {
                ...point,
                id: editing?.id ?? crypto.randomUUID(),
                name: title.slice(0, 80),
              }),
            );
            setEditing(undefined);
            setName('');
            setError('');
          } catch (error) {
            setError(errorMessage(error));
          }
        }}
      >
        <label>
          Bookmark name
          <input
            value={name}
            maxLength={80}
            placeholder="Current chapter"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="submit">{editing ? 'Save name' : 'Add bookmark'}</button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setName('');
              setError('');
            }}
          >
            Cancel rename
          </button>
        )}
      </form>
      {error && <p role="alert">{error}</p>}
      {!bookmarks.length && <p className="muted">Save a position to return to it later.</p>}
      <ol>
        {bookmarks.map((bookmark) => {
          const available = bookmark.path
            ? chapters.some((chapter) => chapter.path === bookmark.path)
            : !!chapters[bookmark.chapter];
          return (
            <li key={bookmark.id}>
              <button disabled={!available} onClick={() => open(bookmark)}>
                {bookmark.name}
              </button>
              {!available && <small className="muted">Chapter unavailable</small>}
              <div className="epub-bookmark-actions">
                <button
                  aria-label={'Rename bookmark ' + bookmark.name}
                  onClick={() => {
                    setEditing(bookmark);
                    setName(bookmark.name);
                    setError('');
                  }}
                >
                  Rename
                </button>
                <button
                  aria-label={'Remove bookmark ' + bookmark.name}
                  onClick={() => {
                    change(bookmarks.filter((item) => item.id !== bookmark.id));
                    if (editing?.id === bookmark.id) {
                      setEditing(undefined);
                      setName('');
                    }
                    setError('');
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
