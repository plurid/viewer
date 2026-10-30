import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { Resource } from '../../../domain/contracts';
import type { PreviewContext } from '../contracts';
import { choosePreview, previewModules } from '../registry';
import { preloadPreviewModule } from '../module-loading';
import { Empty, Loading } from '../../ui/primitives';
import { NativeOpenActions } from '../../ui/navigation/NativeOpenActions';
import { errorMessage } from '../../../domain/errors';
import {
  embeddedFactLimit,
  embeddedFacts,
  embeddedFormat,
  embeddedPictures,
  embeddedSummary,
} from '../../../domain/previews/documents/embedded';
import type { EmbeddedFacts, EmbeddedFormat } from '../../../domain/previews/documents/embedded';
import ImagePreview from './ImagePreview';

type Reading =
  | { state: 'reading' }
  | { state: 'shown'; picture: Resource; facts: EmbeddedFacts }
  | { state: 'missing'; facts: EmbeddedFacts }
  | { state: 'other'; Viewer: ComponentType<PreviewContext> }
  | { state: 'failed'; error: string };

/** A member's text through its own resource, released once read. */
async function memberText(
  services: PreviewContext['services'],
  id: string,
  name: string,
): Promise<string | undefined> {
  const child = await services.archiveEntry(id, name).catch(() => undefined);
  if (!child) return undefined;
  try {
    const read = await services.read(child.id, embeddedFactLimit);
    return read.binary || read.truncated ? undefined : read.text;
  } finally {
    void services.release(child.id).catch(() => {});
  }
}

/**
 * A document shown by the picture its app saved inside it: an iWork, Krita, OpenRaster, Sketch or
 * XPS file, or an iWork package folder. The desktop reads only the format's own pictures and fact
 * members, within their limits, and checks a picture is the PNG or JPEG it is named.
 */
export default function EmbeddedPreview(context: PreviewContext) {
  const { resource, services } = context;
  const format = embeddedFormat(resource.entry.extension) as EmbeddedFormat;
  const [reading, setReading] = useState<Reading>({ state: 'reading' });
  useEffect(() => {
    let live = true,
      owned: Resource | undefined;
    setReading({ state: 'reading' });
    void (async () => {
      const listing = await services.archive(resource.id).catch(async (error: unknown) => {
        // a `.key` file is as often a private key written as text: it keeps the preview it had
        if (resource.entry.directory || (await services.read(resource.id, 4096)).binary)
          throw error;
        return undefined;
      });
      if (!listing) {
        const others = previewModules.filter((module) => module.id !== 'embedded');
        const Viewer = await preloadPreviewModule(choosePreview(resource.entry, others));
        if (live) setReading({ state: 'other', Viewer });
        return;
      }
      const names = listing.entries.map((entry) => entry.name);
      const facts = await embeddedFacts(format, names, (name) =>
        memberText(services, resource.id, name),
      ).catch((): EmbeddedFacts => ({}));
      for (const name of embeddedPictures(format, listing.entries)) {
        if (!live) return;
        // a picture over its pixel limit or not the image it is named: the next one is tried
        const picture = await services.archiveEntry(resource.id, name).catch(() => undefined);
        if (!picture) continue;
        if (!live) {
          void services.release(picture.id).catch(() => {});
          return;
        }
        owned = picture;
        setReading({ state: 'shown', picture, facts });
        return;
      }
      if (live) setReading({ state: 'missing', facts });
    })().catch((error: unknown) => {
      if (live) setReading({ state: 'failed', error: errorMessage(error) });
    });
    return () => {
      live = false;
      if (owned) void services.release(owned.id).catch(() => {});
    };
  }, [resource.id, resource.entry, services, format]);
  if (reading.state === 'reading') return <Loading label="Reading the saved preview…" />;
  if (reading.state === 'other') return <reading.Viewer {...context} />;
  if (reading.state === 'failed')
    return (
      <Empty icon="file" title="This document could not be read" detail={reading.error}>
        <NativeOpenActions path={resource.entry.path} />
      </Empty>
    );
  const summary = embeddedSummary(format, reading.facts);
  if (reading.state === 'missing')
    return (
      <Empty icon="image" title="No preview image in this document" detail={summary}>
        <NativeOpenActions path={resource.entry.path} />
      </Empty>
    );
  return (
    <div className="embedded-viewer">
      {/* a caption, so the plane's header keeps one row: the picture's own zoom controls */}
      <p className="embedded-caption">
        <span>{summary}</span>
        <span className="muted">The image this document saved, not a live rendering</span>
      </p>
      <ImagePreview
        {...context}
        resource={reading.picture}
        editing={undefined}
        optimize={undefined}
        editImage={undefined}
      />
    </div>
  );
}
