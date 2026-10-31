import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultShortcuts, matchesShortcut } from '../../domain/preferences/shortcuts';
import { activeWorkspace, useViewer } from '../state/store';
import { SpokenRequest } from '../command-line/SpokenRequest';
import { onWindowEvent } from '../app/window-events';

/**
 * Ask Viewer by voice: hold the Dictate shortcut, speak and release; or choose the microphone or
 * the command, speak, then Finish, or choose the microphone again. One request at a time: a new one
 * replaces the last.
 */
export function SpeechControls({ onEdit }: { onEdit(text: string): void }) {
  const shortcut = useViewer(
    (state) => state.settings.settings.shortcuts.dictate ?? defaultShortcuts.dictate!,
  );
  const target = useViewer((state) => {
    const space = activeWorkspace(state);
    const pane = space.panes.find((pane) => pane.id === state.activePane);
    return JSON.stringify([space.id, state.activePane, pane?.path]);
  });
  const [request, setRequest] = useState<{ opening: number; held?: boolean }>();
  const holding = useRef<string | undefined>(undefined);
  const recording = useRef(false);
  const openings = useRef(0);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!matchesShortcut(shortcut, event) || event.isComposing) return;
      if (document.querySelector('dialog[open]:not(.speech-dialog)')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || holding.current) return;
      holding.current = event.code || event.key;
      setRequest({ opening: ++openings.current, held: true });
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
    // the microphone or the command: a second choice while it listens finishes the recording
    const invoke = () =>
      setRequest((value) =>
        value && recording.current ? { ...value, held: false } : { opening: ++openings.current },
      );
    const blur = () => {
      holding.current = undefined;
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    const stopDictate = onWindowEvent('viewer:dictate', invoke);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      stopDictate();
      window.removeEventListener('blur', blur);
    };
  }, [shortcut]);
  const onRecording = useCallback((value: boolean) => {
    recording.current = value;
  }, []);
  const close = useCallback(() => {
    holding.current = undefined;
    recording.current = false;
    setRequest(undefined);
  }, []);
  return request ? (
    <SpokenRequest
      key={request.opening}
      target={target}
      held={request.held}
      onRecording={onRecording}
      onEdit={(text) => {
        close();
        onEdit(text);
      }}
      onClose={close}
    />
  ) : null;
}
