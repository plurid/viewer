import { useEffect, useState } from 'react';
import { baseName } from '../../../domain/workspaces/planes';
import { useConfirmation } from '../settings/ConfirmAction';
import { latestReplies } from '../../state/requests';
import { errorMessage } from '../../../domain/errors';
import type { ExecutionGrant } from '../../../domain/agents/requests';
import { terminalReadCharacters } from '../../../domain/agents/requests';
import type { ApplicationSettings } from '../../../domain/services';
import { sharedClientID } from '../../../domain/agents/clients';
import { ChoiceButton } from '../ChoiceMenu';
import { Disclosure } from '../Disclosure';
import { PathLabel, useHome } from '../PathLabel';
import { pathText } from '../../../domain/files/path-label';
import { capabilityLabel } from '../status-labels';
export function AgentGrants({
  settings,
  clientID = sharedClientID,
  roots = settings.agents.roots,
}: {
  settings: ApplicationSettings;
  clientID?: string;
  roots?: string[];
}) {
  const [grants, setGrants] = useState<ExecutionGrant[]>([]);
  const [root, setRoot] = useState(roots[0] || '');
  const [error, setError] = useState('');
  const home = useHome();
  const confirmation = useConfirmation();
  useEffect(() => {
    if (!roots.includes(root)) setRoot(roots[0] || '');
  }, [roots, root]);
  // the first read must not undo a grant saved while it was loading
  const [request] = useState(latestReplies);
  useEffect(() => {
    request(window.viewer.agentGrants(), setGrants, (error) => setError(errorMessage(error)));
  }, [request]);
  const save = (id: string, capability: ExecutionGrant['capability'], allow: boolean) => {
    request(
      window.viewer
        .agentGrant(id, root, capability, allow, clientID)
        .then(() => window.viewer.agentGrants()),
      setGrants,
      (error) => setError(errorMessage(error)),
    );
  };
  const allowed = (id: string, capability: ExecutionGrant['capability']) =>
    grants.some(
      (grant) =>
        (grant.clientID ?? sharedClientID) === clientID &&
        grant.actionID === id &&
        // A grant stores the resolved folder; a configured link or alias matches what was chosen.
        (grant.root === root || grant.chosen === root) &&
        grant.capability === capability,
    );
  return (
    <>
      <h2>Agent permissions</h2>
      <p className="settings-note">
        Viewer asks you before every agent command, and removed files go to the Trash. Agents can’t
        run scripts, programs or apps, or type into a terminal.
      </p>
      <div className="settings-row settings-wide-field">
        <span>Grant for folder</span>
        <ChoiceButton
          label="Grant for folder"
          value={root}
          // the folder's own name, as Finder names a place; its path shows once, under the row
          choices={roots.map((root) => ({
            value: root,
            label: baseName(root) || root,
            detail: pathText(root, home),
          }))}
          placeholder="Choose an authorized folder"
          disabled={!roots.length}
          onChoose={setRoot}
        />
      </div>
      {!roots.length && <p className="settings-field-detail">Add a folder above first.</p>}
      {root && (
        <p className="settings-field-detail">
          <PathLabel path={root} />
        </p>
      )}
      {root && (
        <>
          <label className="settings-row">
            <span>
              Read terminal output
              <small>
                Covers terminals started in this folder, including the last{' '}
                {terminalReadCharacters.toLocaleString('en-US')} characters each one showed, even
                after changing to another folder. Separate from file and metadata access.
              </small>
            </span>
            <input
              type="checkbox"
              checked={allowed('*', 'terminal-read')}
              onChange={(event) => save('*', 'terminal-read', event.target.checked)}
            />
          </label>
        </>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {grants.some((grant) => (grant.clientID ?? sharedClientID) === clientID) && (
        <Disclosure variant="compact" summary="Existing grants">
          {grants
            .filter((grant) => (grant.clientID ?? sharedClientID) === clientID)
            .map((grant) => (
              <div className="settings-grant" key={grant.id}>
                <span title={grant.root}>
                  {capabilityLabel(grant.capability)}
                  {grant.actionID !== '*' && ` for “${grant.actionID}”`} in{' '}
                  {pathText(grant.root, home)}
                  {grant.capability !== 'terminal-read' && ' · Not used: Viewer asks each time'}
                </span>
                <button
                  className="danger"
                  onClick={() =>
                    confirmation.ask({
                      title: 'Revoke this grant?',
                      detail: `${capabilityLabel(grant.capability)} in ${pathText(grant.root, home)}: the agent asks again next time.`,
                      action: 'Revoke',
                      run: () =>
                        void window.viewer
                          .agentGrant(grant.actionID, grant.root, grant.capability, false, clientID)
                          .then(() => window.viewer.agentGrants())
                          .then(setGrants)
                          .catch((error: Error) => setError(error.message)),
                    })
                  }
                >
                  Revoke
                </button>
              </div>
            ))}
        </Disclosure>
      )}
      {confirmation.dialog}
    </>
  );
}
