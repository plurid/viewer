import { useEffect, useRef } from 'react';
import { useViewer } from '../state/core';
import { dismissFolderRecovery, undoClearRecentFolders } from '../state/places';
import { IconButton } from './primitives';

export function FolderHistoryRecovery({ onEnd }: { onEnd(): void }) {
  const recovery = useViewer((state) => state.folderRecovery);
  const focused = useRef(false);
  useEffect(() => {
    if (!recovery && focused.current) {
      focused.current = false;
      onEnd();
    }
  }, [recovery, onEnd]);
  if (!recovery) return null;
  return (
    <div
      className="bar"
      role="status"
      onFocusCapture={() => {
        focused.current = true;
      }}
      onBlurCapture={() => {
        focused.current = false;
      }}
    >
      <span>Recent folders and visit counts cleared.</span>
      <button
        type="button"
        onClick={() => {
          undoClearRecentFolders();
          onEnd();
        }}
      >
        Undo clear recent folders
      </button>
      <IconButton
        icon="close"
        label="Dismiss recent folder Undo"
        onClick={() => {
          dismissFolderRecovery();
          onEnd();
        }}
      />
    </div>
  );
}
