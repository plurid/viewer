import { effectiveWindowSettings } from '../state/effective-ui';
import { useMemo, useRef, useState } from 'react';
import type { DiffPane as DiffRecord } from '../../domain/contracts';
import type { DiffSource } from '../../domain/comparison/diff';
import { FileEditor } from '../editing/FileEditor';
import { Empty, Loading } from '../ui/primitives';
import { updatePane } from '../state/store';
import MergeEditor, { MergeContext, type DiffNavigation } from './MergeEditor';
import ImageDiff from './ImageDiff';
import { useComparisonSession } from './useComparisonSession';
import { imageComparisonMode, imageComparisonModes, textComparisonModes } from './modes';
import { useViewer } from '../state/store';
import { ChoiceButton } from '../ui/ChoiceMenu';

const sourceName = (source: DiffSource) => {
  if (source.kind === 'empty') return source.name;
  const name = source.path.split('/').at(-1) || source.path;
  return source.kind === 'git' ? `${name} · HEAD ${source.commit.slice(0, 8)}` : source.path;
};

export default function DiffPlane({ pane }: { pane: DiffRecord }) {
  const navigation = useRef<DiffNavigation | null>(null);
  const [generation, setGeneration] = useState(0);
  const [editing, setEditing] = useState(true);
  const editorSettings = useViewer((state) => effectiveWindowSettings(state).editor);

  const session = useComparisonSession(pane.id, pane.left, pane.right, generation);
  const loaded = session.status === 'ready' ? session.content : null;

  const mode: 'split' | 'unified' = pane.mode === 'unified' ? 'unified' : 'split';
  const context = useMemo(
    () => ({
      original: loaded?.original ?? '',
      mode,
      editable: pane.right.kind === 'file' && editing,
      navigation,
    }),
    [loaded?.original, mode, pane.right.kind, editing],
  );

  if (session.status === 'failed')
    return (
      <Empty title="Comparison unavailable" detail={session.error}>
        <button onClick={() => setGeneration((value) => value + 1)}>Reload comparison</button>
      </Empty>
    );
  if (!loaded) return <Loading label="Opening comparison…" />;
  const modes = loaded.image ? imageComparisonModes : textComparisonModes;
  const readOnly = (reason?: string) => (
    <>
      {reason && <p className="inline-warning editing-bar">Read-only: {reason}</p>}
      <MergeContext.Provider value={{ ...context, editable: false }}>
        <MergeEditor
          text={loaded.text}
          label="Read-only comparison"
          settings={editorSettings}
          onChange={() => {}}
          onHandle={() => {}}
        />
      </MergeContext.Provider>
    </>
  );

  return (
    <div className="diff-plane">
      <div className="diff-toolbar">
        {!editing && !loaded.image && pane.right.kind === 'file' && (
          <button onClick={() => setEditing(true)}>Edit right file</button>
        )}
        <ChoiceButton
          label="Comparison mode"
          value={loaded.image ? imageComparisonMode(pane.mode) : mode}
          onChoose={(value) => updatePane(pane.id, { mode: value as DiffRecord['mode'] })}
          choices={modes}
        />
        {!loaded.image && (
          <>
            <button onClick={() => navigation.current?.previous()}>Previous change</button>
            <button onClick={() => navigation.current?.next()}>Next change</button>
          </>
        )}
      </div>
      <div className="diff-sources">
        <span title={sourceName(pane.left)}>{sourceName(pane.left)}</span>
        <span title={sourceName(pane.right)}>{sourceName(pane.right)}</span>
      </div>
      {loaded.image ? (
        <ImageDiff left={loaded.left} right={loaded.right} mode={imageComparisonMode(pane.mode)} />
      ) : (
        <MergeContext.Provider value={context}>
          {loaded.right && pane.right.kind === 'file' && editing ? (
            <FileEditor
              resourceID={loaded.right.id}
              paneID={pane.id}
              bufferID={pane.bufferID}
              editor={MergeEditor}
              unavailable={readOnly}
              onClose={() => {
                setEditing(false);
                setGeneration((value) => value + 1);
              }}
              onSaveAs={(file) =>
                updatePane(pane.id, {
                  path: file,
                  right: { kind: 'file', path: file },
                })
              }
            />
          ) : (
            readOnly()
          )}
        </MergeContext.Provider>
      )}
    </div>
  );
}
