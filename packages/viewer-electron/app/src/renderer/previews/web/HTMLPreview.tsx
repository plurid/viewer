import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PreviewContext } from '../contracts';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import TextPreview from '../modules/TextPreview';
import { editingPlane } from '../../editing/planes';
import { Empty, Loading } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { report } from '../../state/core';
import { useHtmlPreview } from './useHtmlPreview';

type HtmlTab = 'preview' | 'source';

/** Render local HTML in a script-only opaque sandbox; source editing keeps its own lifetime. */
export default function HTMLPreview(context: PreviewContext) {
  const prefix = useId();
  const [tab, setTab] = useState<HtmlTab>('preview');
  const currentTab = useRef<HtmlTab>('preview');
  const [revision, setRevision] = useState(0);
  const editing = useRef(false);
  const requestedPreview = useRef(false);
  const previewTab = useRef<HTMLButtonElement>(null);
  const sourceTab = useRef<HTMLButtonElement>(null);
  const capability = useHtmlPreview(context, revision);
  const show = useCallback((next: HtmlTab) => {
    currentTab.current = next;
    setTab(next);
  }, []);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const editingChanged = useCallback(
    (active: boolean) => {
      const wasEditing = editing.current;
      editing.current = active;
      if (active) show('source');
      else {
        if (wasEditing) reload();
        if (requestedPreview.current) show('preview');
      }
    },
    [show, reload],
  );
  const choose = useCallback(
    async (next: HtmlTab) => {
      if (next === 'preview' && editing.current) {
        if (requestedPreview.current) return false;
        requestedPreview.current = true;
        try {
          await editingPlane(context.editing?.paneID)?.done?.();
        } finally {
          requestedPreview.current = false;
        }
        return currentTab.current === 'preview';
      }
      show(next);
      return true;
    },
    [context.editing?.paneID, show],
  );
  const sourceContext = useMemo<PreviewContext>(
    () => ({
      ...context,
      // HTML owns its composite toolbar and command source; text keeps its normal editing bridge.
      commands: undefined,
      active: context.active && tab === 'source',
      interactive: context.interactive && tab === 'source',
    }),
    [context, tab],
  );
  const keydown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let next: HtmlTab;
    if (event.key === 'Home') next = 'preview';
    else if (event.key === 'End') next = 'source';
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      next = tab === 'preview' ? 'source' : 'preview';
    else return;
    event.preventDefault();
    event.stopPropagation();
    void choose(next)
      .then((chosen) => {
        const focus = chosen ? next : currentTab.current;
        (focus === 'preview' ? previewTab : sourceTab).current?.focus();
      })
      .catch(report);
  };
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'view-source',
          label: tab === 'preview' ? 'Show source' : 'Show HTML preview',
          aliases: ['vs'],
          run: async () => {
            await choose(tab === 'preview' ? 'source' : 'preview');
          },
        },
        {
          id: 'reload-html',
          label: 'Reload HTML preview',
          aliases: ['reload page'],
          run: reload,
        },
      ],
      [tab, choose, reload],
    ),
  );
  return (
    <div className="html-preview">
      <PreviewToolbar context={context}>
        <div className="html-preview-tabs" role="tablist" aria-label="HTML view">
          <button
            ref={previewTab}
            id={`${prefix}-preview-tab`}
            type="button"
            role="tab"
            aria-selected={tab === 'preview'}
            aria-controls={`${prefix}-preview`}
            tabIndex={tab === 'preview' ? 0 : -1}
            className={tab === 'preview' ? 'selected' : ''}
            onClick={() => void choose('preview').catch(report)}
            onKeyDown={keydown}
          >
            Preview
          </button>
          <button
            ref={sourceTab}
            id={`${prefix}-source-tab`}
            type="button"
            role="tab"
            aria-selected={tab === 'source'}
            aria-controls={`${prefix}-source`}
            tabIndex={tab === 'source' ? 0 : -1}
            className={tab === 'source' ? 'selected' : ''}
            onClick={() => void choose('source').catch(report)}
            onKeyDown={keydown}
          >
            Source
          </button>
        </div>
        <button
          className="html-preview-reload"
          type="button"
          title="Reload the saved HTML and local assets"
          disabled={capability.status === 'loading' || capability.status === 'closed'}
          onClick={reload}
        >
          <Icon name="refresh" />
          Reload
        </button>
      </PreviewToolbar>
      <div
        className="html-preview-panel"
        id={`${prefix}-preview`}
        role="tabpanel"
        aria-labelledby={`${prefix}-preview-tab`}
        hidden={tab !== 'preview'}
      >
        {tab === 'preview' &&
          (capability.status === 'ready' ? (
            <iframe
              key={`${capability.preview.id}:${revision}`}
              className="html-preview-frame"
              title={`HTML preview of ${context.resource.entry.name}`}
              src={capability.preview.url}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
              tabIndex={context.interactive ? 0 : -1}
              style={{ pointerEvents: context.interactive ? 'auto' : 'none' }}
            />
          ) : capability.status === 'loading' ? (
            <Loading label="Opening HTML preview…" />
          ) : (
            <Empty
              icon="code"
              title="Rendered preview unavailable"
              detail={
                capability.status === 'error' ? capability.message : 'This preview is closed.'
              }
            >
              <button
                type="button"
                onClick={() => {
                  show('source');
                  sourceTab.current?.focus();
                }}
              >
                View source
              </button>
            </Empty>
          ))}
      </div>
      <div
        className="html-preview-panel"
        id={`${prefix}-source`}
        role="tabpanel"
        aria-labelledby={`${prefix}-source-tab`}
        hidden={tab !== 'source'}
      >
        <TextPreview {...sourceContext} onEditingChange={editingChanged} />
      </div>
    </div>
  );
}
