import { useEffect, useState } from 'react';
import type { InspectionResult } from '../../domain/inspection';
import { activeWorkspace, previewValues, report, savePreviewValue } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { Dialog, Loading } from './primitives';
export function InspectionControls() {
  const workspace = useWorkspace();
  const [file, setFile] = useState<string>();
  const [result, setResult] = useState<InspectionResult>();
  const [content, setContent] = useState(false);
  const [ocr, setOCR] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState<{
    paneID: string;
    owner: string;
    text: string;
    error?: string;
  }>();
  useEffect(() => {
    const inspect = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      setResult(undefined);
      setError('');
      setContent(false);
      setOCR(false);
      setFile(path);
    };
    const notes = (event: Event) => {
      const paneID = (event as CustomEvent<string>).detail;
      setNote({
        paneID,
        owner: activeWorkspace().id,
        text: String(previewValues(paneID)['notes.text'] || ''),
      });
    };
    window.addEventListener('viewer:inspect', inspect);
    window.addEventListener('viewer:notes', notes);
    return () => {
      window.removeEventListener('viewer:inspect', inspect);
      window.removeEventListener('viewer:notes', notes);
    };
  }, []);
  useEffect(() => {
    if (!file) return;
    let live = true;
    setResult(undefined);
    setError('');
    void window.viewer
      .inspect(file, content, ocr)
      .then((value) => {
        if (live) setResult(value);
      })
      .catch((error: Error) => {
        if (live) setError(error.message);
      });
    return () => {
      live = false;
    };
  }, [file, content, ocr]);
  if (note)
    return (
      <Dialog title="Plane notes" onClose={() => setNote(undefined)}>
        <div className="dialog-body">
          <textarea
            className="plane-notes"
            data-autofocus
            aria-label="Notes"
            value={note.text}
            maxLength={100000}
            onChange={(event) => setNote({ ...note, text: event.target.value, error: undefined })}
          />
          {note.error && <p role="alert">{note.error}</p>}
        </div>
        <footer>
          <button onClick={() => setNote(undefined)}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              if (savePreviewValue(note.paneID, 'notes.text', note.text, note.owner))
                setNote(undefined);
              else
                setNote({
                  ...note,
                  error:
                    'These notes were not saved: this plane’s saved state would exceed its size limit, or the plane was closed. Shorten the notes or copy them elsewhere.',
                });
            }}
          >
            Save notes
          </button>
        </footer>
      </Dialog>
    );
  if (!file) return null;
  return (
    <Dialog title="Inspect file" onClose={() => setFile(undefined)}>
      <div className="dialog-body inspection-details">
        <p className="muted inspection-path">{file}</p>
        <label>
          <input
            type="checkbox"
            checked={content}
            onChange={(event) => setContent(event.target.checked)}
          />{' '}
          Read file contents
        </label>
        {content && /\.pdf$/i.test(file) && (
          <label>
            <input
              type="checkbox"
              checked={ocr}
              onChange={(event) => setOCR(event.target.checked)}
            />{' '}
            Recognize scanned text on this Mac
          </label>
        )}
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : !result ? (
          <Loading label="Inspecting…" />
        ) : (
          <>
            <dl className="inspection-facts">
              {Object.entries(result.facts).map(([key, fact]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>
                    {String(fact.value)}
                    {fact.unit ? ' ' + fact.unit : ''}
                  </dd>
                </div>
              ))}
            </dl>
            {result.coverage.reason && <p className="muted">{result.coverage.reason}</p>}
            {result.evidence
              .filter((evidence) => evidence.anchor)
              .slice(0, 20)
              .map((evidence, index) => (
                <button
                  className="inspection-passage"
                  key={index}
                  onClick={() => {
                    void workspace
                      .openEvidence({
                        path: file,
                        version: result.version,
                        anchor: evidence.anchor!,
                        quote: evidence.text.slice(0, 1000),
                      })
                      .then(() => setFile(undefined))
                      .catch(report);
                  }}
                >
                  <strong>{evidence.source}</strong>
                  <span>{evidence.text.slice(0, 250)}</span>
                </button>
              ))}
          </>
        )}
      </div>
      <footer>
        <button onClick={() => setFile(undefined)}>Done</button>
      </footer>
    </Dialog>
  );
}
