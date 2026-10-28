import { useEffect, useRef, useState } from 'react';
import { defaultShortcuts, matchesShortcut } from '../../domain/preferences/shortcuts';
import { activeWorkspace, useViewer } from '../state/store';
import { DictationDialog } from './DictationDialog';

export function SpeechControls({ onUse }: { onUse(text: string): void }) {
  const shortcut = useViewer(
    (state) => state.settings.settings.shortcuts.dictate ?? defaultShortcuts.dictate!,
  );
  const target = useViewer((state) => {
    const space = activeWorkspace(state);
    const pane = space.panes.find((pane) => pane.id === state.activePane);
    return JSON.stringify([space.id, state.activePane, pane?.path]);
  });
  const [request, setRequest] = useState<{ target: string; held?: boolean }>();
  const holding = useRef<string | undefined>(undefined);
  const current = useRef(target);
  current.current = target;
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!matchesShortcut(shortcut, event) || event.isComposing) return;
      if (document.querySelector('dialog[open]:not(.speech-dialog)')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || holding.current) return;
      holding.current = event.code || event.key;
      setRequest({ target: current.current, held: true });
    };
    const up = (event: KeyboardEvent) => {
      if (!holding.current) return;
      if (
        (event.code || event.key) === holding.current ||
        ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)
      ) {
        holding.current = undefined;
        setRequest((value) => (value ? { ...value, held: false } : undefined));
      }
    };
    const invoke = () => setRequest({ target: current.current });
    const blur = () => {
      holding.current = undefined;
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('viewer:dictate', invoke);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('viewer:dictate', invoke);
      window.removeEventListener('blur', blur);
    };
  }, [shortcut]);
  return request?.target === target ? (
    <DictationDialog
      destination="Ask Viewer · review, then insert into the request field"
      held={request.held}
      onClose={() => {
        holding.current = undefined;
        setRequest(undefined);
      }}
      onUse={onUse}
    />
  ) : null;
}
