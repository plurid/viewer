import { useCallback, useEffect, useState } from 'react';
import type { CanvasDocument } from '../../domain/canvases/document';
import type {
  ReconstructionJob,
  ReconstructionReply,
  ReconstructionSummary,
} from '../../domain/canvases/reconstruction';
import { reconstructionCredentialID } from '../../domain/canvases/reconstruction';
import { errorMessage } from '../../domain/errors';
import { providerSegmentation } from '../../domain/models/providers';
import { useViewer } from '../state/store';
import { ChoiceButton } from '../ui/ChoiceMenu';

export function ReconstructionPanel({
  document,
  onClose,
}: {
  document: CanvasDocument;
  onClose(): void;
}) {
  const providers = useViewer((state) => state.settings.settings.providers).filter((provider) =>
    providerSegmentation(provider),
  );
  const photos = document.assets.filter((asset) => asset.mime.startsWith('image/'));
  const [selectedAsset, setAssetID] = useState('');
  const [selectedProvider, setProviderID] = useState('');
  const assetID = photos.find((asset) => asset.id === selectedAsset)?.id ?? photos[0]?.id ?? '';
  const providerID =
    providers.find((provider) => provider.id === selectedProvider)?.id ?? providers[0]?.id ?? '';
  const [prompt, setPrompt] = useState('');
  const [job, setJob] = useState<ReconstructionJob>();
  const [jobs, setJobs] = useState<ReconstructionSummary[]>([]);
  const configured = useViewer((state) =>
    state.settings.credentials.includes(reconstructionCredentialID),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const receive = useCallback((reply: ReconstructionReply) => {
    if (reply.job) {
      setJob(reply.job);
      setJobs((previous) => [reply.job!, ...previous.filter((item) => item.id !== reply.job!.id)]);
    }
    if (reply.jobs) setJobs(reply.jobs);
  }, []);
  useEffect(() => {
    let live = true;
    void window.viewer
      .reconstruction({ kind: 'list', canvasID: document.id })
      .then(async (reply) => {
        if (!live) return;
        receive(reply);
        const first = reply.jobs?.[0];
        if (first) {
          const selected = await window.viewer.reconstruction({ kind: 'get', id: first.id });
          if (live) receive(selected);
        }
      })
      .catch((value: unknown) => {
        if (live) setError(errorMessage(value));
      });
    return () => {
      live = false;
    };
  }, [document.id, receive]);
  const running =
    !!job && ['queued', 'running', 'cancel-requested', 'submitting'].includes(job.state);
  const jobID = job?.id;
  useEffect(() => {
    if (!jobID || !running) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const reply = await window.viewer.reconstruction({ kind: 'get', id: jobID });
        if (live) receive(reply);
      } catch (value) {
        if (live) setError(errorMessage(value));
      }
      if (live) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [jobID, running, receive]);
  const run = async (work: () => Promise<ReconstructionReply | void>) => {
    setBusy(true);
    setError('');
    try {
      const reply = await work();
      if (reply) receive(reply);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="reconstruction-panel" aria-label="3D reconstruction">
      <header>
        <strong>Photo to 3D</strong>
        <button onClick={onClose} aria-label="Close 3D reconstruction">
          Close
        </button>
      </header>
      <p>Select one object with Meta SAM, then reconstruct it with SAM 3D Objects hosted by fal.</p>
      <label>
        Photo
        <ChoiceButton
          label="Source photo"
          value={assetID}
          choices={photos.map((asset) => ({ value: asset.id, label: asset.name }))}
          onChoose={setAssetID}
        />
      </label>
      {!photos.length && <p>Drop a photo on the canvas toolbar to attach it.</p>}
      <label>
        Selection model
        <ChoiceButton
          label="Selection model"
          value={providerID}
          choices={providers.map((provider) => ({ value: provider.id, label: provider.name }))}
          onChoose={setProviderID}
        />
      </label>
      <label>
        Object
        <input
          value={prompt}
          maxLength={300}
          placeholder="For example: the desk lamp"
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <button
        disabled={busy || running || !assetID || !providerID || !prompt.trim()}
        onClick={() =>
          void run(() =>
            window.viewer.reconstruction({
              kind: 'prepare',
              canvasID: document.id,
              assetID,
              providerID,
              prompt,
            }),
          )
        }
      >
        {busy ? 'Working…' : 'Find object'}
      </button>
      <button
        onClick={() =>
          void window.viewer
            .openSettings('settings.providers')
            .catch((value: unknown) => setError(errorMessage(value)))
        }
      >
        Model settings…
      </button>
      {!configured && <p>Add your separate fal key in Settings → Models → 3D reconstruction.</p>}
      {jobs.length > 1 && (
        <ChoiceButton
          label="Saved reconstructions"
          value={job?.id ?? ''}
          choices={jobs.map((item) => ({ value: item.id, label: item.prompt, detail: item.state }))}
          onChoose={(id) => void run(() => window.viewer.reconstruction({ kind: 'get', id }))}
        />
      )}
      {job && (
        <>
          <figure className="reconstruction-photo">
            <img src={job.image} alt="Source photo" />
            <img
              src={job.image}
              alt="Selected object"
              style={{ maskImage: `url("${job.mask}")`, maskMode: 'luminance' }}
            />
          </figure>
          <p role="status">
            {job.prompt} · {job.state}
          </p>
          {job.state === 'prepared' && (
            <button
              disabled={busy || !configured}
              onClick={() =>
                void run(() => window.viewer.reconstruction({ kind: 'start', id: job.id }))
              }
            >
              Generate 3D…
            </button>
          )}
          {running && (
            <button
              disabled={busy}
              onClick={() =>
                void run(() => window.viewer.reconstruction({ kind: 'cancel', id: job.id }))
              }
            >
              Request cancellation
            </button>
          )}
          {job.state === 'cancel-requested' && (
            <p>fal may still complete a request that is already running.</p>
          )}
          {job.state === 'succeeded' && job.assetID && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const latest = await window.viewer.canvas({ kind: 'read', id: document.id });
                  await window.viewer.canvas({
                    kind: 'model',
                    id: document.id,
                    assetID: job.assetID!,
                    revision: latest.document.revision,
                  });
                })
              }
            >
              Show model in canvas
            </button>
          )}
          {job.remoteID && <small>fal request {job.remoteID}</small>}
          {job.error && <p role="alert">{job.error}</p>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
