import { ReconstructionPanel } from './ReconstructionPanel';
import { canvasInputWriter, flushCanvasWrites } from './writes';
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
import { ChoiceButton } from '../ui/ChoiceMenu';
import { CanvasSources } from './CanvasSources';
import { RobotCheckPanel } from './RobotCheckPanel';
import { ResultReview } from './ResultReview';
import type { PendingCanvasResult } from './ResultReview';
import { canvasResultSchema } from '../../domain/canvases/results';
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
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceJoint, setSourceJoint] = useState<{ id: string; name: string }>();
  const [result, setResult] = useState<PendingCanvasResult>();
  const [saved, setSaved] = useState('');
  const iframe = useRef<HTMLIFrameElement>(null);
  const current = useRef(document);
  const receive = useCallback((value: CanvasDocument, render = true) => {
    const previous = current.current;
    if (
      !previous ||
      value.revision > previous.revision ||
      (value.revision === previous.revision && value.stateRevision >= previous.stateRevision)
    ) {
      current.current = value;
      if (render) setDocument(value);
    }
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
    let checkingRobot = false;
    const saveInput = canvasInputWriter(
      async (patch) => {
        const latest = current.current;
        if (!latest || latest.revision !== revision) return;
        const reply = await window.viewer.canvas({
          kind: 'state',
          id: pane.canvasID,
          revision: latest.stateRevision,
          contentRevision: revision,
          patch,
        });
        receive(reply.document, live);
      },
      async (value) => {
        if (live) {
          fail(value);
          port?.postMessage({ kind: 'error', message: errorMessage(value) });
        }
        try {
          const saved = await window.viewer.canvas({ kind: 'read', id: pane.canvasID });
          receive(saved.document, live);
          if (live) {
            port?.postMessage({ kind: 'state', state: saved.document.state });
          }
        } catch {
          /* Keep the failed revision visible for review. */
        }
      },
    );
    let observationSent = false;
    let errorObserved = false;
    const observe = (status: 'ready' | 'error', message?: string) => {
      if (!live || (observationSent && status === 'ready')) return;
      if (status === 'error' && errorObserved) return;
      if (status === 'error') errorObserved = true;
      observationSent = true;
      void window.viewer
        .canvas({ kind: 'observe', id: pane.canvasID, revision, status, message })
        .catch(report);
    };
    const timeout = setTimeout(() => {
      if (!observationSent) {
        setError('The canvas did not finish loading. Reload or ask the conversation to repair it.');
        observe('error', 'Canvas loading timed out.');
      }
    }, 4500);
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
        if (value.kind === 'ready') observe('ready');
        else if (value.kind === 'export') {
          const parsed = canvasResultSchema.safeParse(value.result);
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Invalid result.');
            return;
          }
          void writes
            .then(() => {
              const latest = current.current;
              if (!live || !latest || latest.revision !== revision) return;
              if (JSON.stringify(latest.state) !== JSON.stringify(value.state))
                throw new Error(
                  'The inputs changed or could not be saved. Prepare the result again.',
                );
              setResult({ result: parsed.data, revision, stateRevision: latest.stateRevision });
            })
            .catch(fail);
        } else if (
          value.kind === 'robot-check' &&
          typeof value.sourceID === 'string' &&
          typeof value.stateKey === 'string'
        ) {
          if (checkingRobot) return;
          checkingRobot = true;
          void writes
            .then(async () => {
              const latest = current.current;
              if (!live || !latest || latest.revision !== revision) return;
              if (JSON.stringify(latest.state) !== JSON.stringify(value.state))
                throw new Error(
                  'The task inputs changed or could not be saved. Request the check again.',
                );
              const reply = await window.viewer.canvas({
                kind: 'check-robot',
                id: pane.canvasID,
                revision,
                stateRevision: latest.stateRevision,
                sourceID: value.sourceID,
                stateKey: value.stateKey,
              });
              if (live) receive(reply.document);
            })
            .catch(fail)
            .finally(() => {
              checkingRobot = false;
            });
        } else if (value.kind === 'state') {
          const patch = canvasStateSchema.safeParse(value.patch);
          if (!patch.success) {
            setError('The canvas sent invalid saved values.');
            return;
          }
          try {
            writes = saveInput(patch.data);
          } catch (value) {
            fail(value);
          }
        } else if (value.kind === 'source' && typeof value.assetID === 'string') {
          const snapshot = current.current?.sources.find((item) => item.id === value.assetID);
          if (snapshot) {
            const joint = snapshot.data.robot?.joints.find((item) => item.name === value.joint);
            setSourceJoint(joint ? { id: snapshot.id, name: joint.name } : undefined);
            setSourcesOpen(true);
            return;
          }
          const asset = current.current?.assets.find((asset) => asset.id === value.assetID);
          // A generated frame requests a review; it never opens files or performs actions itself.
          if (asset?.source) setProposal('Open source: ' + asset.source);
        } else if (value.kind === 'proposal' && typeof value.text === 'string')
          setProposal(value.text.slice(0, 4000));
        else if (value.kind === 'error' && typeof value.message === 'string') {
          setError(value.message.slice(0, 1000));
          observe('error', value.message.slice(0, 1000));
        }
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
      clearTimeout(timeout);
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
        <span className="canvas-revision">Revision {document.revision}</span>
        <ChoiceButton
          label="Canvas tools"
          value=""
          placeholder="Tools"
          disabled={busy}
          choices={[
            { value: 'source', label: source ? 'Hide source code' : 'Source code' },
            { value: 'reload', label: 'Reload' },
            ...(document.history.length ? [{ value: 'undo', label: 'Undo revision' }] : []),
            { value: '3d', label: 'Photo to 3D' },
          ]}
          onChoose={(choice) => {
            if (choice === 'source') setSource(!source);
            if (choice === 'reload') {
              void act(async () => {
                setStopped(false);
                setReload((value) => value + 1);
              });
            }
            if (choice === '3d') setReconstruct(!reconstruct);
            if (choice === 'undo')
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
              );
          }}
        />
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
          Export canvas…
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
      {document.robotCheck && (
        <RobotCheckPanel
          document={document}
          busy={busy}
          onDefinition={(id, name) => {
            setSourceJoint({ id, name });
            setSourcesOpen(true);
          }}
          onCheck={() =>
            void act(async () => {
              const latest = current.current!;
              receive(
                (
                  await window.viewer.canvas({
                    kind: 'check-robot',
                    id: latest.id,
                    revision: latest.revision,
                    stateRevision: latest.stateRevision,
                    sourceID: latest.robotCheck!.sourceID,
                    stateKey: latest.robotCheck!.stateKey,
                  })
                ).document,
              );
            })
          }
          onSave={() =>
            void act(async () => {
              const latest = current.current!;
              const reply = await window.viewer.canvas({
                kind: 'save-robot-check',
                id: latest.id,
                revision: latest.revision,
                stateRevision: latest.stateRevision,
              });
              if (reply.saved) setSaved(reply.saved);
            })
          }
        />
      )}
      {!!document.sources.length && (
        <Disclosure
          variant="compact"
          summary={`Sources (${document.sources.length})`}
          open={sourcesOpen}
          onOpenChange={setSourcesOpen}
        >
          <CanvasSources
            joint={sourceJoint}
            sources={document.sources}
            paneID={pane.id}
            busy={busy}
            onError={fail}
            onRefresh={(sourceID) =>
              void act(async () =>
                receive(
                  (
                    await window.viewer.canvas({
                      kind: 'refresh-source',
                      id: document.id,
                      sourceID,
                      revision: document.revision,
                    })
                  ).document,
                ),
              )
            }
          />
        </Disclosure>
      )}
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
      {result && (
        <ResultReview
          pending={result}
          busy={busy}
          stale={
            result.revision !== document.revision || result.stateRevision !== document.stateRevision
          }
          onCancel={() => setResult(undefined)}
          onSave={() =>
            void act(async () => {
              const reply = await window.viewer.canvas({
                kind: 'save-result',
                id: document.id,
                ...result,
              });
              if (reply.saved) {
                setSaved(reply.saved);
                setResult((pending) => (pending === result ? undefined : pending));
              }
            })
          }
        />
      )}
      {saved && (
        <div className="canvas-message" role="status">
          <button
            onClick={() =>
              void workspace
                .openPath(saved, { paneID: pane.id, linked: true, activate: true })
                .catch(fail)
            }
          >
            Open saved file
          </button>
          <span>{saved.split(/[\\/]/).at(-1)}</span>
        </div>
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
