import { useEffect, useState } from 'react';
import { workflowUsesSelection, type WorkflowDocument } from '../../../domain/automation/workflows';
import type { WatchRule } from '../../../domain/automation/watch-rules';
import { ChoiceButton } from '../ChoiceMenu';
import { errorMessage } from '../../../domain/errors';

export function WatchRuleControls({
  document,
  bindings,
  disabled,
  openRun,
  reviewDefinition,
}: {
  document?: WorkflowDocument;
  bindings: Record<string, string>;
  disabled: boolean;
  openRun(id: string): void;
  reviewDefinition(rule: WatchRule): Promise<void>;
}) {
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [editing, setEditing] = useState<WatchRule>();
  const [expanded, setExpanded] = useState(false);
  const [root, setRoot] = useState('');
  const [extensions, setExtensions] = useState('');
  const [recursive, setRecursive] = useState(false),
    [content, setContent] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      window.viewer
        .watchRules({ kind: 'list' })
        .then((reply) => {
          if (alive && Array.isArray(reply)) setRules(reply);
        })
        .catch((error) => {
          if (alive) setError(error.message);
        });
    void refresh();
    const remove = window.viewer.onEvent((event) => {
      if (event.type === 'watch-rule') void refresh();
    });
    return () => {
      alive = false;
      remove();
    };
  }, []);
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      const reply = await window.viewer.watchRules({ kind: 'list' });
      if (Array.isArray(reply)) setRules(reply);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const blocked = disabled || busy;
  const bound = document?.definition.bindings.every((binding) => !!bindings[binding.name]);
  const matching = !editing || editing.scope.file === document?.file;
  return (
    <section aria-label="Watch rules" className="watch-rules">
      <h3>Watch rules</h3>
      {!rules.length && <p className="muted">No folders watched.</p>}
      {rules.map((rule) => (
        <div className="watch-rule-row" key={rule.id}>
          <div className="project-control-row">
            <div>
              <strong>{rule.name}</strong>
              <small className="muted">{rule.scope.root}</small>
            </div>
            <span>
              {!rule.enabled
                ? 'Paused'
                : rule.runStatus === 'waiting-review'
                  ? 'Needs review'
                  : rule.runStatus === 'running'
                    ? 'Running'
                    : 'Watching'}
            </span>
          </div>
          {rule.reason && <p className="muted">{rule.reason}</p>}
          <div className="settings-actions">
            {rule.runID && (
              <button disabled={blocked} onClick={() => openRun(rule.runID!)}>
                Open run
              </button>
            )}
            {rule.enabled ? (
              <button
                disabled={blocked}
                onClick={() =>
                  void perform(async () => {
                    await window.viewer.watchRules({
                      kind: 'pause',
                      id: rule.id,
                      revision: rule.revision,
                    });
                  })
                }
              >
                Pause
              </button>
            ) : (
              <button
                disabled={blocked}
                onClick={() =>
                  void perform(async () => {
                    await reviewDefinition(rule);
                    setEditing(rule);
                    setRoot(rule.scope.root);
                    setExtensions(rule.scope.extensions.join(', '));
                    setRecursive(rule.scope.recursive);
                    setContent(rule.scope.allowContent);
                    setCooldown(rule.scope.cooldownSeconds);
                    setExpanded(true);
                  })
                }
              >
                Review and enable…
              </button>
            )}
            {!rule.enabled && (
              <button
                disabled={blocked}
                onClick={() =>
                  void perform(async () => {
                    await window.viewer.watchRules({
                      kind: 'remove',
                      id: rule.id,
                      revision: rule.revision,
                    });
                    if (editing?.id === rule.id) {
                      setEditing(undefined);
                      setExpanded(false);
                    }
                  })
                }
              >
                Remove rule
              </button>
            )}
          </div>
        </div>
      ))}
      {document && (
        <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>{editing ? 'Review watch rule' : 'Watch a folder…'}</summary>
          <form
            className="watch-rule-form"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                await window.viewer.watchRules({
                  kind: 'approve',
                  ...(editing ? { id: editing.id, revision: editing.revision } : {}),
                  scope: {
                    file: document.file,
                    fileRevision: document.revision,
                    root,
                    bindings,
                    extensions: extensions
                      .split(/[\s,]+/)
                      .filter(Boolean)
                      .map((value) => value.replace(/^\./, '').toLowerCase()),
                    recursive,
                    allowContent: content,
                    cooldownSeconds: cooldown,
                  },
                });
                setExpanded(false);
                setEditing(undefined);
              });
            }}
          >
            <p>
              <strong>{document.definition.name}</strong> will use new or changed files in the
              chosen folder. Existing files are skipped when you enable the rule. Copies and renames
              wait for your review.
            </p>
            {!workflowUsesSelection(document.definition) && (
              <p className="error">
                This workflow needs a selection reference. Choose an “Inspect selection” template or
                edit its sources.
              </p>
            )}
            <div className="project-control-row">
              <span>
                Watched folder<small className="muted">{root || 'Choose a folder'}</small>
              </span>
              <button
                type="button"
                disabled={blocked}
                onClick={() =>
                  void perform(async () => {
                    const folder = await window.viewer.chooseFolder(root || document.root);
                    if (folder) setRoot(folder);
                  })
                }
              >
                Choose folder…
              </button>
            </div>
            <label className="field-label">
              File extensions
              <input
                placeholder="All files, or pdf, dxf, csv…"
                value={extensions}
                disabled={blocked}
                onChange={(event) => setExtensions(event.target.value)}
              />
            </label>
            <label className="review-checkpoint">
              <input
                type="checkbox"
                checked={recursive}
                disabled={blocked}
                onChange={(event) => setRecursive(event.target.checked)}
              />
              <span>Include subfolders</span>
            </label>
            <label className="review-checkpoint">
              <input
                type="checkbox"
                checked={content}
                disabled={blocked}
                onChange={(event) => setContent(event.target.checked)}
              />
              <span>
                Allow local content inspection
                <small>
                  For this workflow’s inputs and outputs. May download cloud files. Model recipes
                  run manually.
                </small>
              </span>
            </label>
            <label className="field-label">
              Minimum time between runs
              <ChoiceButton
                label="Minimum time between runs"
                value={String(cooldown)}
                disabled={blocked}
                choices={[
                  { value: '30', label: '30 seconds' },
                  { value: '60', label: '1 minute' },
                  { value: '300', label: '5 minutes' },
                ]}
                // a configured rule may keep another interval
                placeholder={`${cooldown} seconds`}
                onChoose={(value) => setCooldown(Number(value))}
              />
            </label>
            {!bound && <p className="muted">Choose the workflow’s folder bindings above first.</p>}
            {!matching && (
              <p className="muted">Reopen the rule’s workflow to review this approval.</p>
            )}
            <div className="settings-actions">
              <button
                type="button"
                disabled={blocked}
                onClick={() => {
                  setExpanded(false);
                  setEditing(undefined);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary"
                disabled={
                  blocked ||
                  !root ||
                  !bound ||
                  !matching ||
                  !workflowUsesSelection(document.definition)
                }
              >
                Enable watch rule
              </button>
            </div>
          </form>
        </details>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
