import { ReconstructionPanel } from './ReconstructionPanel';
import { flushCanvasWrites, trackCanvasWrite } from './writes';
import { acceptsDrop, droppedPaths } from '../explorer/sections';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasPane as Pane } from '../../domain/contracts';
import type { CanvasDocument } from '../../domain/canvases/document';
import { canvasStateSchema } from '../../domain/canvases/document';
import { errorMessage } from '../../domain/errors';
import { useWorkspace } from '../workspace/context';
import { updatePane, report } from '../state/store';
import { Empty, Loading } from '../ui/primitives';
import { Disclosure } from '../ui/Disclosure';
import './canvas.css';

export default function CanvasPlane({ pane }: { pane: Pane }) {
  const workspace = useWorkspace();
  const [document, setDocument] = useState<CanvasDocument>();
  const [url, setURL] = useState('');
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState('');
  const [reconstruct, setReconstruct] = useState(false);
  const [source, setSource] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const current = useRef(document);
  current.current = document;
  const receive = useCallback((value: CanvasDocument) => {
    setDocument((previous) =>
      !previous ||
      value.revision > previous.revision ||
      (value.revision === previous.revision && value.stateRevision >= previous.stateRevision)
        ? value
        : previous,
    );
  }, []);
  const fail = (value: unknown) => setError(errorMessage(value));
  useEffect(() => {
    let live = true;
    const unsubscribe = window.viewer.onEvent((event) => {
      if (live && event.type === 'canvas' && event.document.id === pane.canvasID)
        receive(event.document);
    });
    void window.viewer
      .canvas({ kind: 'read', id: pane.canvasID })
      .then((reply) => {
        if (live) receive(reply.document);
      })
      .catch((value: unknown) => {
        if (live) fail(value);
      });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [pane.canvasID, receive]);
  const title = document?.title;
  useEffect(() => {
    if (title && pane.title !== title) updatePane(pane.id, { title });
  }, [title, pane.id, pane.title]);

  const revision = document?.revision;
  useEffect(() => {
    if (revision === undefined || stopped) {
      setURL('');
      return;
    }
    let live = true;
    let capability: string | undefined;
    let port: MessagePort | undefined;
    let writes = Promise.resolve();
    let queued = 0;
    setError('');
    setURL('');
    const connect = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        event.data?.kind !== 'viewer-canvas-ready' ||
        event.data.id !== pane.canvasID ||
        event.data.revision !== revision ||
        port
      )
        return;
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = (message) => {
        const value = message.data;
        if (!live || !value || typeof value !== 'object') return;
        if (value.kind === 'state') {
          const patch = canvasStateSchema.safeParse(value.patch);
          if (!patch.success || queued >= 64) {
            setError('The canvas sent too many updates or invalid saved values.');
            return;
          }
          queued++;
          writes = writes
            .then(async () => {
              const latest = current.current;
              if (!latest || latest.revision !== revision) return;
              const reply = await window.viewer.canvas({
                kind: 'state',
                id: pane.canvasID,
                revision: latest.stateRevision,
                contentRevision: revision,
                patch: patch.data,
              });
              current.current = reply.document;
              if (live) receive(reply.document);
            })
            .catch(async (value: unknown) => {
              if (live) {
                fail(value);
                port?.postMessage({ kind: 'error', message: errorMessage(value) });
              }
              try {
                const saved = await window.viewer.canvas({ kind: 'read', id: pane.canvasID });
                current.current = saved.document;
                if (live) {
                  receive(saved.document);
                  port?.postMessage({ kind: 'state', state: saved.document.state });
                }
              } catch {
                /* Keep the failed revision visible for review. */
              }
            })
            .finally(() => {
              queued--;
            });
          trackCanvasWrite(writes);
        } else if (value.kind === 'source' && typeof value.assetID === 'string') {
          const asset = current.current?.assets.find((asset) => asset.id === value.assetID);
          // A generated frame requests a review; it never opens files or performs actions itself.
          if (asset?.source) setProposal('Open source: ' + asset.source);
        } else if (value.kind === 'proposal' && typeof value.text === 'string')
          setProposal(value.text.slice(0, 4000));
        else if (value.kind === 'error' && typeof value.message === 'string')
          setError(value.message.slice(0, 1000));
      };
      port.start();
      iframe.current!.contentWindow!.postMessage({ kind: 'viewer-canvas-connect' }, '*', [
        channel.port2,
      ]);
    };
    window.addEventListener('message', connect);
    void window.viewer
      .canvas({ kind: 'preview', id: pane.canvasID })
      .then((reply) => {
        if (!reply.preview) throw new Error('The canvas preview is unavailable.');
        capability = reply.preview.id;
        if (live) {
          receive(reply.document);
          setURL(reply.preview.url);
        } else void window.viewer.htmlPreviewClose(capability).catch(report);
      })
      .catch((value: unknown) => {
        if (live) fail(value);
      });
    return () => {
      live = false;
      window.removeEventListener('message', connect);
      port?.close();
      if (capability) void window.viewer.htmlPreviewClose(capability).catch(report);
    };
  }, [pane.canvasID, revision, stopped, reload, receive]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await flushCanvasWrites();
      await work();
    } catch (value) {
      fail(value);
    } finally {
      setBusy(false);
    }
  };
  if (!document)
    return error ? (
      <Empty title="Canvas unavailable" detail={error} />
    ) : (
      <Loading label="Opening canvas…" />
    );
  return (
    <section
      className="canvas-plane"
      data-canvas-id={pane.canvasID}
      aria-label="Agent canvas"
      onDragOver={(event) => {
        if (acceptsDrop(event)) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!acceptsDrop(event)) return;
        event.preventDefault();
        void act(async () => {
          for (const path of await droppedPaths(event))
            receive(
              (await window.viewer.canvas({ kind: 'attach', id: pane.canvasID, path })).document,
            );
        });
      }}
    >
      <header className="canvas-toolbar" data-viewer-overlay-protected="canvas-toolbar">
        <button
          onClick={() => void workspace.openChat(document.conversationID, pane.id).catch(fail)}
        >
          Conversation
        </button>
        <button aria-pressed={source} onClick={() => setSource(!source)}>
          Source
        </button>
        <button onClick={() => setReconstruct(!reconstruct)} aria-expanded={reconstruct}>
          Photo to 3D
        </button>
        <span className="canvas-revision">Revision {document.revision}</span>
        <button
          disabled={busy || !document.history.length}
          onClick={() =>
            void act(async () =>
              receive(
                (
                  await window.viewer.canvas({
                    kind: 'undo',
                    id: document.id,
                    revision: document.revision,
                  })
                ).document,
              ),
            )
          }
        >
          Undo
        </button>
        <button
          onClick={() => {
            setStopped(false);
            setReload((value) => value + 1);
          }}
        >
          Reload
        </button>
        <button disabled={stopped} onClick={() => setStopped(true)}>
          Stop
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const result = await window.viewer.canvas({ kind: 'export', id: document.id });
              if (result.exported)
                await workspace.openPath(result.exported, {
                  paneID: pane.id,
                  linked: true,
                  activate: true,
                });
            })
          }
        >
          Export…
        </button>
        {document.fork && (
          <>
            <button
              onClick={() => void workspace.openCanvas(document.fork!.id, pane.id).catch(fail)}
            >
              Compare original
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const result = await window.viewer.canvas({
                    kind: 'apply',
                    id: document.id,
                    revision: document.revision,
                  });
                  await workspace.openCanvas(result.document.id, pane.id);
                })
              }
            >
              Apply to original
            </button>
          </>
        )}
      </header>
      <Disclosure
        variant="compact"
        summary={`Assets (${document.assets.length}) · drop files here`}
      >
        <ul className="canvas-assets">
          {document.assets.map((asset) => (
            <li key={asset.id}>
              {asset.name}
              {asset.provenance && <small>{asset.provenance}</small>}
              {asset.source && (
                <button
                  onClick={() =>
                    void workspace
                      .openPath(asset.source!, { paneID: pane.id, linked: true, activate: true })
                      .catch(fail)
                  }
                >
                  Open source
                </button>
              )}
            </li>
          ))}
        </ul>
      </Disclosure>
      {error && (
        <p className="canvas-message" role="alert">
          {error}
        </p>
      )}
      {proposal && (
        <div className="canvas-message">
          <p>{proposal}</p>
          <button
            onClick={() =>
              void act(async () => {
                const result = await window.viewer.chat({
                  kind: 'open',
                  id: document.conversationID,
                });
                if (Array.isArray(result)) return;
                await window.viewer.chat({
                  kind: 'draft',
                  id: result.id,
                  text: proposal,
                  revision: result.draftRevision + 1,
                });
                setProposal('');
                await workspace.openChat(result.id, pane.id);
              })
            }
          >
            Review in chat
          </button>
          <button onClick={() => setProposal('')}>Dismiss</button>
        </div>
      )}
      <div className="canvas-body">
        {reconstruct && (
          <ReconstructionPanel document={document} onClose={() => setReconstruct(false)} />
        )}
        {source && (
          <div className="canvas-source">
            <pre tabIndex={0}>{document.html}</pre>
            <Disclosure variant="compact" summary="Saved values">
              <pre>{JSON.stringify(document.state, null, 2)}</pre>
            </Disclosure>
          </div>
        )}
        {stopped ? (
          <Empty title="Canvas stopped" detail="Reload to run the saved revision." />
        ) : url ? (
          <iframe
            ref={iframe}
            title={document.title}
            src={url}
            sandbox="allow-scripts"
            allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
            referrerPolicy="no-referrer"
          />
        ) : (
          <Loading label="Loading canvas…" />
        )}
      </div>
    </section>
  );
}
