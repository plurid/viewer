import { useEffect, useMemo, useState } from 'react';
import type { PreviewContext } from '../contracts';
import type { ShortcutFacts } from '../../../domain/previews/data/shortcuts';
import { isBinaryPlist } from '../../../domain/previews/data/plist';
import { readShortcut, shortcutLimit } from '../../../domain/previews/data/shortcuts';
import { errorMessage } from '../../../domain/errors';
import { Empty, Loading } from '../../ui/primitives';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { usePreviewState } from '../state';
import { report } from '../../state/store';
import TextPreview from './TextPreview';
import './inspection.css';

type Reading =
  | { status: 'loading' }
  | { status: 'ready'; shortcut: ShortcutFacts; text: boolean }
  | { status: 'failed'; message: string };

/**
 * An Internet shortcut: the address it names and its host. Viewer never loads the address; Open
 * hands a web or email address to the person's browser or mail app, through the desktop service,
 * which checks it again.
 */
export default function ShortcutPreview(context: PreviewContext) {
  const { resource, signal } = context;
  const [reading, setReading] = useState<Reading>({ status: 'loading' });
  const [source, setSource] = usePreviewState(context, 'text.source', false);
  useEffect(() => {
    let live = true;
    const size = resource.entry.size;
    const read = async () => {
      if (size > shortcutLimit) throw new Error('This file is too large to be a shortcut.');
      if (!size) return new Uint8Array();
      const response = await fetch(resource.url, {
        headers: { Range: `bytes=0-${size - 1}` },
        signal,
      });
      if (!response.ok) throw new Error('The shortcut could not be read.');
      return new Uint8Array(await response.arrayBuffer()).slice(0, shortcutLimit);
    };
    read()
      .then((bytes) => {
        if (!live) return;
        setReading({
          status: 'ready',
          shortcut: readShortcut(bytes, resource.entry.extension.toLowerCase()),
          text: bytes.length > 0 && !isBinaryPlist(bytes),
        });
      })
      .catch((error: unknown) => {
        if (live && !signal.aborted) setReading({ status: 'failed', message: errorMessage(error) });
      });
    return () => {
      live = false;
    };
  }, [resource.url, resource.entry.size, resource.entry.extension, signal]);
  const shortcut = reading.status === 'ready' ? reading.shortcut : undefined;
  const textual = reading.status === 'ready' && reading.text;
  const open = useMemo(
    () =>
      shortcut && !shortcut.refusal
        ? () => void window.viewer.openAddress(shortcut.url).catch(report)
        : undefined,
    [shortcut],
  );
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'open-address',
          label: shortcut?.scheme === 'mailto' ? 'Open in Mail App' : 'Open in Browser',
          available: !!open,
          primary: true,
          run: () => open?.(),
        },
        {
          id: 'view-source',
          label: source ? 'Show shortcut' : 'Show source',
          aliases: ['vs'],
          available: textual,
          run: () => setSource((value) => !value),
        },
      ],
      [shortcut, open, source, textual, setSource],
    ),
  );
  if (reading.status === 'loading') return <Loading label="Reading shortcut…" />;
  if (reading.status === 'failed')
    return (
      <div className="inspection-viewer">
        <Empty icon="link" title="The shortcut could not be read" detail={reading.message} />
      </div>
    );
  const facts = reading.shortcut;
  const mail = facts.scheme === 'mailto';
  return (
    <div className="inspection-viewer">
      <PreviewToolbar context={context}>
        {textual && (
          <>
            <button
              type="button"
              aria-pressed={!source}
              className={source ? '' : 'selected'}
              onClick={() => setSource(false)}
            >
              Shortcut
            </button>
            <button
              type="button"
              aria-pressed={source}
              className={source ? 'selected' : ''}
              onClick={() => setSource(true)}
            >
              Source
            </button>
          </>
        )}
      </PreviewToolbar>
      {textual && source ? (
        <TextPreview {...context} commands={undefined} />
      ) : (
        <div className="inspection-scroll">
          <article className="inspection-card" aria-label="Shortcut">
            <header>
              <h3>{facts.host || facts.url}</h3>
              {facts.scheme && <span className="inspection-badge">{facts.scheme}</span>}
            </header>
            <p className="shortcut-address">{facts.url}</p>
            <dl className="inspection-facts">
              {facts.host && (
                <div>
                  <dt>{mail ? 'To' : 'Host'}</dt>
                  <dd>{facts.host}</dd>
                </div>
              )}
            </dl>
            {facts.refusal ? (
              <p className="inspection-warning">{facts.refusal}</p>
            ) : (
              <div className="shortcut-actions">
                <button type="button" className="primary" onClick={open}>
                  {mail ? 'Open in Mail App' : 'Open in Browser'}
                </button>
              </div>
            )}
            <p className="inspection-note">Viewer does not load the address to preview it.</p>
          </article>
        </div>
      )}
    </div>
  );
}
