import { useEffect, useState } from 'react';
import type {
  DefinitionCatalog,
  ProjectManagerState,
  WorkspaceDefinitionFileRequest,
} from '../../../domain/workspaces/definitions/schema';
import { errorMessage } from '../../../domain/errors';
import { Button, PathField, Row } from '../primitives';
import { projectManagerConsentText } from '../workspace/ProjectManagerOffer';
import { Disclosure } from '../Disclosure';

function sourceStatus(source: ProjectManagerState): string {
  if (source.state === 'undecided') return 'The project list has not been read.';
  if (source.state === 'absent') return "VS Code Project Manager's list was not found.";
  if (source.state === 'off') return 'VS Code Project Manager is off.';
  if (source.state === 'needs-access')
    return "Allow access to read VS Code Project Manager's list.";
  const counts =
    [
      `${source.projects} VS Code ${source.projects === 1 ? 'project' : 'projects'}`,
      ...(source.missing
        ? [`${source.missing} ${source.missing === 1 ? 'folder' : 'folders'} missing`]
        : []),
      ...(source.disabled ? [`${source.disabled} disabled`] : []),
      ...(source.remote ? [`${source.remote} remote`] : []),
      ...(source.duplicateKeys
        ? [`${source.duplicateKeys} duplicate ${source.duplicateKeys === 1 ? 'key' : 'keys'}`]
        : []),
    ].join(', ') + '.';
  if (source.state === 'unreadable')
    return (
      "VS Code Project Manager's list could not be read." +
      (source.projects ? ` The last valid list remains in effect. ${counts}` : '')
    );
  return counts;
}

export function WorkspaceDefinitionsSettings() {
  const [catalog, setCatalog] = useState<DefinitionCatalog>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const accept = (next: DefinitionCatalog) => {
      if (live)
        setCatalog((current) => (!current || next.revision >= current.revision ? next : current));
    };
    void window.viewer
      .workspaceDefinitionFile({ kind: 'catalog' })
      .then(accept)
      .catch((error) => {
        if (live) setMessage(errorMessage(error));
      });
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'workspace-definitions') accept(event.catalog);
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  const run = async (request: WorkspaceDefinitionFileRequest) => {
    setBusy(true);
    setMessage('');
    try {
      const next = await window.viewer.workspaceDefinitionFile(request);
      setCatalog(next);
      if (request.kind === 'validate') {
        const errors = next.diagnostics.filter((issue) => issue.level === 'error').length;
        setMessage(
          errors
            ? `${errors} ${errors === 1 ? 'error remains' : 'errors remain'}. Fix the diagnostics below.`
            : 'No errors found.',
        );
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2>Workspace definitions</h2>
      <p className="settings-note">
        Search definitions by name in Change workspace. Only opened workspaces join your workspace
        list.
      </p>
      {catalog && (
        <PathField
          className="configuration-path"
          path={catalog.file.path}
          onError={(error) => setMessage(errorMessage(error))}
        />
      )}
      <div className="settings-action-row">
        <Button variant="secondary" disabled={busy} onClick={() => void run({ kind: 'edit' })}>
          Open workspaces.jsonc
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void run({ kind: 'validate' })}>
          Validate
        </Button>
      </div>
      {catalog?.file.state === 'last-valid' && (
        <p className="settings-error" role="status">
          The last valid definitions remain in effect until workspaces.jsonc is fixed.
        </p>
      )}
      {catalog && (
        <>
          <h3>VS Code Project Manager</h3>
          {(catalog.projectManager.enabled !== undefined ||
            catalog.projectManager.state !== 'absent') && (
            <Row
              label="Use VS Code Project Manager projects"
              detail={
                catalog.projectManager.state === 'undecided'
                  ? projectManagerConsentText
                  : 'Viewer reads the list and never changes it.'
              }
              control={
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Use VS Code Project Manager projects"
                  checked={catalog.projectManager.enabled === true}
                  disabled={busy}
                  onChange={(event) =>
                    void run({ kind: 'project-manager', enabled: event.target.checked })
                  }
                />
              }
            />
          )}
          <PathField
            path={catalog.projectManager.path}
            onError={(error) => setMessage(errorMessage(error))}
          />
          <p className="settings-note">{sourceStatus(catalog.projectManager)}</p>
          {catalog.projectManager.state === 'needs-access' && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void run({ kind: 'allow-source' })}
            >
              Allow access…
            </Button>
          )}
          {!!catalog.diagnostics.length && (
            <Disclosure variant="compact" summary={`Diagnostics (${catalog.diagnostics.length})`}>
              <ul className="settings-warnings">
                {catalog.diagnostics.map((problem, index) => (
                  <li key={index}>
                    {problem.source}
                    {problem.line ? `:${problem.line}` : ''}
                    {problem.key ? ` (${problem.key})` : ''}: {problem.message}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </>
  );
}
