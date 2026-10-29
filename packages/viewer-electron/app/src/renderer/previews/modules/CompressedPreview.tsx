import { useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import type { ArchiveEntry, FileEntry, Resource } from '../../../domain/contracts';
import type { PreviewContext } from '../contracts';
import { PreviewToolbar } from '../controls';
import { choosePreview } from '../registry';
import { preloadPreviewModule } from '../module-loading';
import { Empty, Loading } from '../../ui/primitives';
import { NativeOpenActions } from '../../ui/navigation/NativeOpenActions';
import { errorMessage } from '../../../domain/errors';
import { formatBytes } from '../../../domain/files/entries';
import { gzipLimits, gzipMember } from '../../../domain/files/containers';

/** The previews a gzip file is expanded for: text, code, data and logs, and documents written as
 * text. Other kinds are described by name and size. */
const textModules = ['text', 'subtitles', 'cards', 'notebook'];

type Expansion =
  | { state: 'reading' }
  | { state: 'shown'; shown: Resource; Viewer: ComponentType<PreviewContext> }
  | { state: 'described'; member: ArchiveEntry }
  | { state: 'failed'; error: string };

/** The file a gzip stream holds, as the registry chooses its preview. A numbered rotation,
 * `access.log.2`, reads as the file it rotated. */
function memberEntry(file: FileEntry, member: string): FileEntry {
  const name = /\.[^.]+\.\d+$/.test(member) ? member.replace(/\.\d+$/, '') : member;
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
  return { ...file, name, extension, mime: '' };
}

/**
 * A single gzip-compressed file, `notes.txt.gz`, shown read-only with the preview of the file it
 * holds. The desktop expands at most 8 MB and stops a stream that grows past that.
 */
export default function CompressedPreview(context: PreviewContext) {
  const { resource, services } = context;
  const member = gzipMember(resource.entry.name) ?? resource.entry.name;
  const inner = useMemo(() => memberEntry(resource.entry, member), [resource.entry, member]);
  const module = choosePreview(inner);
  const readable = textModules.includes(module.id);
  const [expansion, setExpansion] = useState<Expansion>({ state: 'reading' });
  useEffect(() => {
    let live = true,
      owned: Resource | undefined;
    void (async () => {
      const listed = (await services.archive(resource.id)).entries[0];
      if (!listed) throw new Error('This gzip file holds no file.');
      if (!readable || !listed.previewable) {
        if (live) setExpansion({ state: 'described', member: listed });
        return;
      }
      const loading = preloadPreviewModule(module);
      loading.catch(() => {});
      const child = await services.archiveEntry(resource.id, listed.name);
      if (!live) {
        void services.release(child.id).catch(() => {});
        return;
      }
      owned = child;
      const Viewer = await loading;
      // previewed as the file it holds, under the name the registry chose it by
      const shown = {
        ...child,
        entry: { ...child.entry, name: inner.name, extension: inner.extension },
      };
      if (live) setExpansion({ state: 'shown', shown, Viewer });
    })().catch((error) => {
      if (live) setExpansion({ state: 'failed', error: errorMessage(error) });
    });
    return () => {
      live = false;
      if (owned) void services.release(owned.id).catch(() => {});
    };
  }, [resource.id, services, readable, module, inner]);
  if (expansion.state === 'reading') return <Loading label="Expanding compressed file…" />;
  if (expansion.state === 'failed')
    return (
      <Empty icon="archive" title={member} detail={expansion.error}>
        <NativeOpenActions path={resource.entry.path} />
      </Empty>
    );
  if (expansion.state === 'described') {
    const size = formatBytes(expansion.member.size);
    const limit = formatBytes(gzipLimits.expanded);
    const detail = readable
      ? `Gzip-compressed, ${size} expanded. Viewer expands up to ${limit} for a preview.`
      : `Gzip-compressed, ${size} expanded. Viewer shows the text, code and data gzip holds.`;
    return (
      <Empty icon="archive" title={expansion.member.name} detail={detail}>
        <NativeOpenActions path={resource.entry.path} />
      </Empty>
    );
  }
  const { shown, Viewer } = expansion;
  return (
    <div className="compressed-viewer">
      <PreviewToolbar context={context}>
        <span className="muted">Expanded from gzip · {formatBytes(shown.entry.size)}</span>
      </PreviewToolbar>
      <Viewer {...context} resource={shown} editing={undefined} />
    </div>
  );
}
