import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PreviewContext } from '../contracts';
import { PreviewToolbar } from '../controls';
import { usePreviewState } from '../state';
import { ChoiceButton } from '../../ui/ChoiceMenu';
import { Empty, Loading } from '../../ui/primitives';
import {
  FontError,
  fontByteLimit,
  fontFormatLabels,
  readFontInfo,
  specimenCharacters,
} from '../../../domain/previews/fonts/sfnt';
import type { FontInfo } from '../../../domain/previews/fonts/sfnt';

type FontFact = [label: string, value: string | undefined];
type FontLoad =
  | { status: 'loading' }
  | { status: 'failed'; url: string; detail: string }
  | { status: 'ready'; url: string; family: string; info?: FontInfo; unread?: string };

const sampleSizes = [16, 24, 36, 48, 72, 96];
const defaultSize = 48;
const pangram = 'The quick brown fox jumps over the lazy dog';
const figures = '0123456789 .,:;!? &@#$%*+=/ ()[]{} \'"';
const oversized =
  'This font exceeds the preview file limit (32 MB). Open it in another app to view it.';
const unloadable = 'The font may be damaged or use a format Viewer cannot render.';

// Each face gets its own family, so two previews of different files never share a name.
let families = 0;

export default function FontPreview(context: PreviewContext) {
  const { resource, signal } = context;
  const [storedSize, setSize] = usePreviewState(context, 'font.size', defaultSize);
  const [sample, setSample] = usePreviewState(context, 'font.sample', '');
  const [load, setLoad] = useState<FontLoad>({ status: 'loading' });
  const tooLarge = resource.entry.size > fontByteLimit;
  useEffect(() => {
    if (tooLarge) return;
    const abort = new AbortController();
    const cancel = () => abort.abort();
    if (signal.aborted) abort.abort();
    else signal.addEventListener('abort', cancel, { once: true });
    const url = resource.url;
    const family = `viewer-font-${++families}`;
    let face: FontFace | undefined;
    void (async () => {
      try {
        const bytes = await fontBytes(url, abort.signal);
        const details = readFontInfo(bytes).then(
          (info) => ({ info, unread: info.unread }),
          (error: unknown) => ({
            info: undefined,
            unread: error instanceof FontError ? error.message : 'Its tables could not be read.',
          }),
        );
        face = new FontFace(family, bytes);
        try {
          await face.load();
        } catch {
          const { unread } = await details;
          throw new Error(unread ? `${unloadable} ${unread}` : unloadable);
        }
        if (abort.signal.aborted) return;
        document.fonts.add(face);
        const { info, unread } = await details;
        if (!abort.signal.aborted) setLoad({ status: 'ready', url, family, info, unread });
      } catch (error) {
        if (abort.signal.aborted) return;
        const detail = error instanceof Error ? error.message : unloadable;
        setLoad({ status: 'failed', url, detail });
      }
    })();
    return () => {
      abort.abort();
      signal.removeEventListener('abort', cancel);
      if (face) document.fonts.delete(face);
    };
  }, [tooLarge, resource.url, signal]);
  if (tooLarge) return <Empty icon="text" title="Font preview unavailable" detail={oversized} />;
  // a result for an earlier resource is never shown as this one's
  const current = load.status !== 'loading' && load.url === resource.url ? load : undefined;
  if (current?.status === 'failed')
    return <Empty icon="text" title="Font could not be loaded" detail={current.detail} />;
  if (current?.status !== 'ready') return <Loading label="Loading font…" />;
  const size = sampleSizes.includes(storedSize) ? storedSize : defaultSize;
  const fontStyle: CSSProperties = { fontFamily: `"${current.family}"` };
  const { info, unread } = current;
  const coverage = info?.coverage;
  const facts: FontFact[] = [
    ['Family', info?.names.family],
    ['Style', info?.names.style],
    ['Full name', info?.names.fullName],
    ['Version', info?.names.version],
    ['Designer', info?.names.designer],
    ['Manufacturer', info?.names.manufacturer],
    ['Copyright', info?.names.copyright],
    ['Glyphs', info?.glyphs?.toLocaleString()],
    ['Format', info ? formatText(info) : resource.entry.extension.toUpperCase()],
  ];
  return (
    <div className="font-viewer">
      <PreviewToolbar context={context}>
        <ChoiceButton
          label="Sample size"
          value={String(size)}
          choices={sampleSizes.map((value) => ({
            value: String(value),
            label: `${value} px`,
          }))}
          onChoose={(value) => setSize(Number(value))}
        />
      </PreviewToolbar>
      <div className="font-scroll">
        <input
          className="font-sample-field"
          aria-label="Sample text"
          placeholder={pangram}
          maxLength={200}
          value={sample}
          onChange={(event) => setSample(event.target.value)}
        />
        <section
          className="font-specimen"
          aria-label="Specimen"
          style={{ ...fontStyle, fontSize: size }}
        >
          <p>{sample || pangram}</p>
          <p>{figures}</p>
        </section>
        <dl className="font-facts">
          {facts.map(
            ([label, value]) =>
              value && (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ),
          )}
        </dl>
        {unread && <p className="muted">Font details are unavailable. {unread}</p>}
        <section className="font-characters" aria-label="Characters">
          <h3>
            Basic Latin and Latin-1
            {coverage && (
              <span className="muted">
                {' · '}
                {coverage.size} of {specimenCharacters.length} in this font
              </span>
            )}
          </h3>
          <ul className="font-grid">
            {specimenCharacters.map((code) => {
              const hex = code.toString(16).toUpperCase().padStart(4, '0');
              const missing = !!coverage && !coverage.has(code);
              return (
                <li
                  key={code}
                  className={missing ? 'font-glyph is-missing' : 'font-glyph'}
                  title={missing ? `U+${hex} is not in this font` : `U+${hex}`}
                >
                  <span style={missing ? undefined : fontStyle}>{String.fromCodePoint(code)}</span>
                  <small>{hex}</small>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

function formatText({ format, faces }: FontInfo): string {
  const label = fontFormatLabels[format];
  return faces > 1 ? `${label}, first of ${faces} faces` : label;
}

/** The file's bytes, refused past the preview limit even when it grew after it was listed. */
async function fontBytes(url: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body)
    throw new Error('The font file is unavailable. Reopen it to retry.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > fontByteLimit) throw new Error(oversized);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
