import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiffPane as DiffRecord, Resource } from '../../domain/contracts';
import type { DiffSource } from '../../domain/diff';
import { FileEditor } from '../editing/FileEditor';
import { Empty, Loading } from '../ui/primitives';
import { report, updatePane } from '../state/store';
import MergeEditor, { MergeContext, type DiffNavigation } from './MergeEditor';
import ImageDiff from './ImageDiff';
import { editingPlane } from '../editing/planes';
import { useViewer } from '../state/store';
import { ChoiceButton } from '../ui/ChoiceMenu';

const sourceName = (source: DiffSource) => {
  if (source.kind === 'empty') return source.name;
  const name = source.path.split('/').at(-1) || source.path;
  return source.kind === 'git' ? `${name} · HEAD ${source.commit.slice(0, 8)}` : source.path;
};

async function acquire(source: DiffSource): Promise<Resource | null> {
  if (source.kind === 'empty') return null;
  return source.kind === 'file'
    ? window.viewer.resource(source.path)
    : window.viewer.gitResource(source);
}

export default function DiffPlane({ pane }: { pane: DiffRecord }) {
  const [loaded, setLoaded] = useState<{
    left: Resource | null;
    right: Resource | null;
    original: string;
    text: string;
    image: boolean;
  } | null>(null);
  const [error, setError] = useState('');
  const navigation = useRef<DiffNavigation | null>(null);
  const [generation, setGeneration] = useState(0);
  const [editing, setEditing] = useState(true);
  const editorSettings = useViewer((state) => state.settings.settings.editor);

  useEffect(() => {
    let live = true;
    const held: Resource[] = [];
    const subscriber = crypto.randomUUID();
    const directory =
      pane.right.kind === 'file'
        ? pane.right.path.slice(0, pane.right.path.lastIndexOf('/')) || '/'
        : undefined;
    if (directory)
      void window.viewer
        .watch(directory, subscriber)
        .then(() => {
          if (!live) return window.viewer.unwatch(subscriber);
        })
        .catch(report);
    setLoaded(null);
    setError('');
    const read = async (source: DiffSource) => {
      const resource = await acquire(source);
      if (resource) held.push(resource);
      if (!live && resource) await window.viewer.release(resource.id);
      return resource;
    };
    void (async () => {
      const [left, right] = await Promise.all([read(pane.left), read(pane.right)]);
      if (!live) return;
      const resources = [left, right].filter((value): value is Resource => !!value);
      const image =
        resources.length > 0 && resources.every((value) => value.entry.mime.startsWith('image/'));
      if (image) {
        setLoaded({ left, right, original: '', text: '', image: true });
        return;
      }
      const texts = await Promise.all(
        [left, right].map(async (resource) => {
          if (!resource) return '';
          const data = await window.viewer.read(resource.id);
          if (data.binary || data.truncated)
            throw new Error('Text comparisons require complete text files of at most 4 MiB.');
          return data.text;
        }),
      );
      if (live) setLoaded({ left, right, original: texts[0]!, text: texts[1]!, image: false });
    })().catch((failure: Error) => {
      if (live) setError(failure.message);
    });
    const off = window.viewer.onEvent((event) => {
      if (event.type === 'folder-changed' && event.path === directory)
        editingPlane(pane.id)?.changedOnDisk?.();
      if (
        event.type === 'file-access' &&
        held.some((resource) => event.resources?.includes(resource.id))
      ) {
        live = false;
        setLoaded(null);
        setError('File access was revoked. Allow access and reload this comparison.');
      }
    });
    return () => {
      live = false;
      off();
      if (directory) void window.viewer.unwatch(subscriber).catch(report);
      for (const resource of held) void window.viewer.release(resource.id).catch(report);
    };
  }, [pane.id, pane.left, pane.right, generation]);

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

  if (error)
    return (
      <Empty title="Comparison unavailable" detail={error}>
        <button onClick={() => setGeneration((value) => value + 1)}>Reload comparison</button>
      </Empty>
    );
  if (!loaded) return <Loading label="Opening comparison…" />;
  const modes = loaded.image
    ? (['slider', 'onion', 'side', 'difference'] as const)
    : (['split', 'unified'] as const);

  return (
    <div className="diff-plane">
      <div className="diff-toolbar">
        {!editing && !loaded.image && pane.right.kind === 'file' && (
          <button onClick={() => setEditing(true)}>Edit right file</button>
        )}
        <ChoiceButton
          label="Comparison mode"
          value={
            loaded.image
              ? (modes as readonly string[]).includes(pane.mode ?? '')
                ? pane.mode!
                : 'slider'
              : mode
          }
          onChoose={(value) => updatePane(pane.id, { mode: value as DiffRecord['mode'] })}
          choices={modes.map((value) => ({
            value,
            label:
              value === 'split' || value === 'side'
                ? 'Side by side'
                : value === 'onion'
                  ? 'Onion skin'
                  : value[0]!.toUpperCase() + value.slice(1),
          }))}
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
        <ImageDiff
          left={loaded.left}
          right={loaded.right}
          mode={
            pane.mode && ['slider', 'onion', 'side', 'difference'].includes(pane.mode)
              ? pane.mode
              : 'slider'
          }
        />
      ) : (
        <MergeContext.Provider value={context}>
          {loaded.right && pane.right.kind === 'file' && editing ? (
            <FileEditor
              resourceID={loaded.right.id}
              paneID={pane.id}
              bufferID={pane.bufferID}
              editor={MergeEditor}
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
            <MergeEditor
              text={loaded.text}
              label="Read-only comparison"
              settings={editorSettings}
              onChange={() => {}}
              onHandle={() => {}}
            />
          )}
        </MergeContext.Provider>
      )}
    </div>
  );
}
