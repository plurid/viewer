import { useState } from 'react';
import type { WorkspaceController } from '../workspace/context';
import { Dialog } from './primitives';

/**
 * VIEWS (2026-10-23): the space's saved camera positions, to fly to, rename or remove. Views 1–9
 * are the numbered ones (⌥⌘1–9); others carry the names they were saved under.
 */
export function ViewsDialog({
  workspace,
  onClose,
}: {
  workspace: WorkspaceController;
  onClose(): void;
}) {
  const [, refresh] = useState(0);
  const [renaming, setRenaming] = useState<{ name: string; text: string } | null>(null);
  const views = workspace.bookmarks();
  const changed = () => refresh((value) => value + 1);
  return (
    <Dialog title="Views" onClose={onClose} className="views-dialog">
      {views.length ? (
        <ul className="views-list">
          {views.map((view) => (
            <li key={view.name}>
              {renaming?.name === view.name ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const to = renaming.text.trim();
                    if (to && to !== view.name) workspace.renameBookmark(view.name, to);
                    setRenaming(null);
                    changed();
                  }}
                >
                  <input
                    autoFocus
                    aria-label={`New name for ${view.label}`}
                    value={renaming.text}
                    maxLength={100}
                    onChange={(event) => setRenaming({ ...renaming, text: event.target.value })}
                  />
                  <button type="submit">Rename</button>
                </form>
              ) : (
                <>
                  <span className="views-name">{view.label}</span>
                  <button
                    onClick={() => {
                      onClose();
                      workspace.goBookmark(view.name);
                    }}
                  >
                    Go
                  </button>
                  <button onClick={() => setRenaming({ name: view.name, text: view.label })}>
                    Rename
                  </button>
                  <button
                    onClick={() => {
                      workspace.removeBookmark(view.name);
                      changed();
                    }}
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="dialog-copy">
          <p>No views yet: ⌃⌥⌘1–9 saves the camera as view 1–9, or use Save view….</p>
        </div>
      )}
      <footer>
        <button className="primary" data-autofocus onClick={onClose}>
          Done
        </button>
      </footer>
    </Dialog>
  );
}
