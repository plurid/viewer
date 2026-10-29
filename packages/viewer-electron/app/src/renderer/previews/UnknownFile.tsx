import { useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import type { FileEntry, Resource } from '../../domain/contracts';
import type { FileGuess } from '../../domain/files/file-guess';
import type { FileIdentity } from '../../domain/files/signatures';
import type { PreviewContext, PreviewModule } from './contracts';
import { confirmedFormats, identifyBytes, identifyProbe } from '../../domain/files/signatures';
import { errorMessage } from '../../domain/errors';
import { Empty, ErrorBoundary } from '../ui/primitives';
import { getState, report, useViewer } from '../state/store';
import { choosePreview, previewModules } from './registry';
import { loadedPreviewModule, preloadPreviewModule } from './module-loading';

/** The MIME type the media module reads to choose a player, for the formats Chromium plays. */
const playable: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
};
/**
 * Formats whose preview reads a misnamed file from its bytes, each opened that way. The desktop
 * service goes by extension for Office layout and content, document extraction and media
 * compatibility copies: for those, Show as first has it confirm the format from the file's own
 * bytes (`confirmedFormats`). Others, camera RAW and Office 97-2003 among them, are named, not
 * shown.
 */
const showable = new Set([
  'sqlite',
  'pdf',
  'djvu',
  'zip',
  'jar',
  'apk',
  'tar',
  'tgz',
  'png',
  'jpg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
  'heic',
  'heif',
  'tiff',
  'psd',
  'jp2',
  'icns',
  'exr',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'plist',
  ...Object.keys(playable),
]);
/** The image module bounds pixels by the dimensions a resource carries, which a misnamed image's
 * lacks; the rendered module's decoder bounds them itself. */
const rendered = () => previewModules.find((module) => module.id === 'rendered-image');

interface Shown {
  entry: FileEntry;
  module: PreviewModule;
  /** The desktop service reads this format by extension, once the file's bytes confirm it. */
  confirmed: boolean;
}
/** The preview of a file as `extension`, when its module reads the bytes of a misnamed file or the
 * desktop service confirms the format from them. */
function showAs(entry: FileEntry, extension?: string | null): Shown | undefined {
  if (!extension || extension === entry.extension) return undefined;
  const confirmed = confirmedFormats.has(extension);
  if (!confirmed && !showable.has(extension)) return undefined;
  const shown = { ...entry, extension, mime: playable[extension] ?? entry.mime };
  const module = choosePreview(shown);
  if (module.id === 'fallback') return undefined;
  return {
    entry: shown,
    module: module.id === 'image' ? (rendered() ?? module) : module,
    confirmed,
  };
}
/** "a SQLite database", "an EPUB book", "MP3 audio". */
const withArticle = (label: string) =>
  /(?:audio|video|data|media)$/.test(label)
    ? label
    : `${/^(?:[aeiou]|LZ4|xz)/i.test(label) ? 'an' : 'a'} ${label}`;

type GuessState =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'answered'; guess: FileGuess }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string };

/**
 * A file no preview reads: what its first bytes say it is, the preview that reads such bytes in
 * place, and, asked for, the prompt model's guess.
 */
export function UnknownFile(context: PreviewContext) {
  const { resource, signal } = context;
  const [identity, setIdentity] = useState<FileIdentity>();
  const [shown, setShown] = useState<{
    resource: Resource;
    Preview: ComponentType<PreviewContext>;
  }>();
  const [refusal, setRefusal] = useState('');
  const [guess, setGuess] = useState<GuessState>({ kind: 'idle' });
  const settings = useViewer((state) => state.settings.settings);
  const provider = useMemo(
    () =>
      settings.providers.find((item) => item.id === settings.prompts.providerID) ??
      settings.providers[0],
    [settings.providers, settings.prompts.providerID],
  );
  useEffect(() => {
    let live = true;
    void fetch(resource.url, { headers: { Range: `bytes=0-${identifyProbe - 1}` }, signal })
      .then((response) => {
        if (!response.ok) throw new Error('The file could not be read.');
        return response.arrayBuffer();
      })
      .then((bytes) => {
        if (live) setIdentity(identifyBytes(new Uint8Array(bytes), resource.entry.name));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [resource.url, resource.entry.name, signal]);
  const show = (target: Shown) => {
    const ready = loadedPreviewModule(target.module);
    if (ready && !target.confirmed) {
      setShown({ resource: { ...resource, entry: target.entry }, Preview: ready });
      return;
    }
    setRefusal('');
    void Promise.all([
      target.confirmed
        ? window.viewer.resourceFormat(resource.id, target.entry.extension)
        : { ...resource, entry: target.entry },
      ready ?? preloadPreviewModule(target.module),
    ]).then(
      ([confirmed, Preview]) => {
        if (!signal.aborted) setShown({ resource: confirmed, Preview });
      },
      (error: unknown) => {
        if (!signal.aborted) setRefusal(errorMessage(error));
      },
    );
  };
  const ask = () => {
    setGuess({ kind: 'asking' });
    void window.viewer.identifyFile(resource.entry.path).then(
      (answer) => {
        if (!signal.aborted) setGuess({ kind: 'answered', guess: answer });
      },
      (error: { code?: string }) => {
        if (signal.aborted) return;
        const message = errorMessage(error);
        setGuess(
          error.code === 'MODEL_DATA_PERMISSION_REQUIRED'
            ? { kind: 'refused', message }
            : { kind: 'failed', message },
        );
      },
    );
  };
  if (shown) {
    const { Preview } = shown;
    return (
      <ErrorBoundary>
        <Preview {...context} resource={shown.resource} />
      </ErrorBoundary>
    );
  }
  const own = showAs(resource.entry, identity?.extension);
  const proposed =
    guess.kind === 'answered' ? showAs(resource.entry, guess.guess.extension) : undefined;
  return (
    <Empty
      icon="file"
      title={identity ? `Looks like ${withArticle(identity.label)}` : 'Preview unavailable'}
      detail={
        identity?.extension && identity.extension !== resource.entry.extension && !own
          ? `Viewer previews it when its name ends in .${identity.extension}.`
          : undefined
      }
    >
      <div className="empty-actions">
        {identity && own && <button onClick={() => show(own)}>Show as {identity.label}</button>}
        {getState().bootstrap.platform === 'darwin' && (
          <button
            onClick={() => {
              void window.viewer.nativeFilePanel('preview', [resource.entry.path]).catch(report);
            }}
          >
            Quick Look in macOS
          </button>
        )}
        <button
          onClick={() => {
            void window.viewer.openExternal(resource.entry.path).catch(report);
          }}
        >
          Open in Default App
        </button>
        {provider && (guess.kind === 'idle' || guess.kind === 'asking') && (
          <button disabled={guess.kind === 'asking'} onClick={ask}>
            {guess.kind === 'asking' ? `Asking ${provider.name}…` : `Ask ${provider.name}`}
          </button>
        )}
      </div>
      {refusal && <p role="alert">{refusal}</p>}
      {guess.kind === 'answered' && (
        <>
          <p role="status">
            {guess.guess.provider} suggests: {guess.guess.kind}
            {guess.guess.extension && ` (.${guess.guess.extension})`}.
            {guess.guess.apps.length > 0 && ` Opens in ${guess.guess.apps.join(', ')}.`}
            {guess.guess.note && ` ${guess.guess.note}`}
          </p>
          {proposed && (
            <div className="empty-actions">
              <button onClick={() => show(proposed)}>Show as {guess.guess.kind}</button>
            </div>
          )}
        </>
      )}
      {(guess.kind === 'refused' || guess.kind === 'failed') && (
        <>
          <p role="alert">{guess.message}</p>
          <div className="empty-actions">
            {guess.kind === 'refused' && (
              <button
                onClick={() => void window.viewer.openSettings('settings.providers').catch(report)}
              >
                Review in Settings
              </button>
            )}
            <button onClick={ask}>Ask again</button>
          </div>
        </>
      )}
    </Empty>
  );
}
