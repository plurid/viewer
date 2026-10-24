import { useEffect, useState } from 'react';
import { parse, type ParseError } from 'jsonc-parser';
import {
  workflowDefinitionSchema,
  workflowUsesSelection,
  type WorkflowDocument,
  type WorkflowReply,
  type WorkflowRun,
} from '../../../domain/automation/workflows';
import type { ActionContext } from '../../../domain/services';
import type { CommandContext } from '../../commands/registry';
import { activeWorkspace } from '../../state/store';
import { useWorkspace } from '../../workspace/context';
import { Dialog, Loading } from '../primitives';
import { reviewOperationPlan } from '../operations/OperationReview';
import { WorkflowArtifact } from './WorkflowArtifact';
import { WatchRuleControls } from './WatchRules';
import { ChoiceButton } from '../ChoiceMenu';
import type { WatchRule } from '../../../domain/automation/watch-rules';
const statusLabel: Record<WorkflowRun['status'] | WorkflowRun['steps'][number]['status'], string> =
  {
    running: 'Running',
    paused: 'Paused',
    pending: 'Pending',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    'waiting-review': 'Needs review',
  };

function documentReply(reply: WorkflowReply): WorkflowDocument {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply) || !('root' in reply))
    throw new Error('The workflow definition could not be opened.');
  return reply;
}
function runReply(reply: WorkflowReply): WorkflowRun {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply) || !('status' in reply))
    throw new Error('The workflow run could not be opened.');
  return reply;
}
export function WorkflowControls() {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [document, setDocument] = useState<WorkflowDocument>(),
    [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selected, setSelected] = useState<string>(),
    [run, setRun] = useState<WorkflowRun>();
  const [bindings, setBindings] = useState<Record<string, string>>({}),
    [editor, setEditor] = useState<string>();
  const [template, setTemplate] = useState<
    'inspect' | 'compare' | 'copy' | 'inspect-selection' | 'copy-selection'
  >('inspect');
  const [context, setContext] = useState<ActionContext>();
  const [notice, setNotice] = useState<WatchRule>();
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (
        event as CustomEvent<{ file?: string; runID?: string; context?: CommandContext }>
      ).detail;
      const space = activeWorkspace();
      setContext({
        workspaceID: space.id,
        paneID: detail?.context?.paneID ?? 'workflow',
        rootID: detail?.context?.paneID
          ? (workspace.rootID(detail.context.paneID) ?? 'workflow')
          : 'workflow',
        actor: 'user',
        sources: detail?.context?.selection.map((file) => file.path) ?? [],
      });
      setOpen(true);
      setError('');
      if (detail?.runID) setSelected(detail.runID);
      if (detail?.file)
        void window.viewer
          .workflow({ kind: 'read', file: detail.file })
          .then((reply) => {
            setDocument(documentReply(reply));
            setBindings({});
            setEditor(undefined);
            setSelected(undefined);
          })
          .catch((error) => setError(error.message));
    };
    window.addEventListener('viewer:workflows', show);
    return () => window.removeEventListener('viewer:workflows', show);
  }, [workspace]);
  useEffect(
    () =>
      window.viewer.onEvent((event) => {
        if (
          event.type === 'watch-rule' &&
          (!event.rule.enabled || event.rule.runStatus === 'waiting-review')
        )
          setNotice(event.rule);
      }),
    [],
  );
  useEffect(() => {
    if (!open) return;
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const list = await window.viewer.workflow({ kind: 'list' });
        if (!Array.isArray(list)) throw new Error('Workflow history is unavailable.');
        if (alive) setRuns(list);
        if (selected) {
          const result = runReply(await window.viewer.workflow({ kind: 'get', id: selected }));
          if (alive) setRun(result);
        }
      } catch (error) {
        if (alive) setError((error as Error).message);
      }
      if (alive) timer = setTimeout(() => void refresh(), 1500);
    };
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, selected]);
  const select = (id?: string) => {
    setSelected(id);
    setRun(undefined);
  };
  if (!open)
    return notice ? (
      <div className="project-file-notice watch-rule-notice" role="status">
        <span>
          {notice.name} · {notice.enabled ? 'Changes ready for review' : 'Watch rule paused'}
        </span>
        <button
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('viewer:workflows', { detail: { runID: notice.runID } }),
            );
            setNotice(undefined);
          }}
        >
          Review
        </button>
        <button onClick={() => setNotice(undefined)}>Dismiss</button>
      </div>
    ) : null;
  const current = run && run.id === selected ? run : undefined;
  const read = async (file: string) => {
    setDocument(documentReply(await window.viewer.workflow({ kind: 'read', file })));
    setBindings({});
    setEditor(undefined);
    select();
  };
  const choose = async (mode: 'open' | 'create') => {
    const file = await window.viewer.workflow({ kind: 'choose', mode });
    if (typeof file !== 'string') return;
    if (mode === 'open') {
      await read(file);
      return;
    }
    const inspect = template === 'inspect' || template === 'inspect-selection';
    const selection = template.endsWith('-selection');
    const definition = workflowDefinitionSchema.parse({
      version: 1,
      id: crypto.randomUUID(),
      name: inspect
        ? selection
          ? 'Inspect selection'
          : 'Inspect files'
        : template === 'compare'
          ? 'Compare folders'
          : selection
            ? 'Inspect and copy selection'
            : 'Inspect and copy',
      bindings: inspect ? [] : [{ name: 'destination', label: 'Destination folder' }],
      inputs: {
        source: { path: '.' },
        ...(inspect ? {} : { destination: { binding: 'destination', path: '.' } }),
      },
      steps:
        template === 'compare'
          ? [
              {
                id: 'compare',
                kind: 'compare',
                left: { kind: 'input', name: 'source' },
                right: { kind: 'input', name: 'destination' },
              },
            ]
          : [
              {
                id: 'inspect',
                kind: 'inspect',
                sources: [selection ? { kind: 'selection' } : { kind: 'input', name: 'source' }],
              },
              ...(template === 'copy' || template === 'copy-selection'
                ? [
                    {
                      id: 'copy',
                      kind: 'copy',
                      needs: ['inspect'],
                      sources: [{ kind: 'step', id: 'inspect' }],
                      destination: { kind: 'input', name: 'destination' },
                    },
                  ]
                : []),
            ],
    });
    setDocument(
      documentReply(await window.viewer.workflow({ kind: 'save', file, revision: '', definition })),
    );
    setBindings({});
    setEditor(undefined);
    select();
  };
  return (
    <Dialog
      wide
      title="Workflows"
      className="workflow-dialog"
      onClose={() => !busy && setOpen(false)}
    >
      <div className="dialog-body workflow-body">
        <div className="settings-actions">
          <button disabled={busy} onClick={() => void perform(() => choose('open'))}>
            Open workflow…
          </button>
          <label>
            New workflow
            <ChoiceButton
              label="New workflow"
              value={template}
              disabled={busy}
              choices={[
                { value: 'inspect', label: 'Inspect files' },
                { value: 'compare', label: 'Compare folders' },
                { value: 'copy', label: 'Inspect and copy' },
                { value: 'inspect-selection', label: 'Inspect selection' },
                { value: 'copy-selection', label: 'Inspect and copy selection' },
              ]}
              onChoose={(value) => setTemplate(value as typeof template)}
            />
          </label>
          <button disabled={busy} onClick={() => void perform(() => choose('create'))}>
            Create…
          </button>
        </div>
        {document && (
          <details
            className="workflow-definition"
            aria-label="Workflow definition"
            open={!selected}
          >
            <summary className="project-control-row">
              <strong>{document.definition.name}</strong>
              <span className="muted">{document.file}</span>
            </summary>
            <div className="workflow-definition-content">
              <ol className="workflow-steps">
                {document.definition.steps.map((step) => (
                  <li key={step.id}>
                    <strong>{step.id}</strong>
                    <span>
                      {step.kind}
                      {step.needs.length ? ' · after ' + step.needs.join(', ') : ''}
                    </span>
                  </li>
                ))}
              </ol>
              {workflowUsesSelection(document.definition) && (
                <p className="muted">
                  {context?.sources.length
                    ? context.sources.length + ' selected files'
                    : 'Select files in a folder, then open Workflows to run this selection manually.'}
                </p>
              )}
              {document.definition.bindings.map((binding) => (
                <div className="project-control-row" key={binding.name}>
                  <span>
                    {binding.label}
                    <small className="muted">
                      {bindings[binding.name] ?? 'Choose a folder on this Mac'}
                    </small>
                  </span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const folder = await window.viewer.chooseFolder();
                        if (folder) setBindings((old) => ({ ...old, [binding.name]: folder }));
                      })
                    }
                  >
                    Choose folder…
                  </button>
                </div>
              ))}
              <div className="settings-actions">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    editor !== undefined ||
                    (workflowUsesSelection(document.definition) && !context?.sources.length) ||
                    document.definition.bindings.some((binding) => !bindings[binding.name])
                  }
                  onClick={() =>
                    void perform(async () => {
                      if (!context) throw new Error('Open Workflows from the active workspace.');
                      const started = runReply(
                        await window.viewer.workflow({
                          kind: 'start',
                          file: document.file,
                          revision: document.revision,
                          bindings,
                          context,
                        }),
                      );
                      select(started.id);
                      setRun(started);
                    })
                  }
                >
                  Run workflow
                </button>
                <button
                  disabled={busy}
                  onClick={() => setEditor(JSON.stringify(document.definition, null, 2))}
                >
                  Edit definition
                </button>
                <button disabled={busy} onClick={() => void perform(() => read(document.file))}>
                  Reload file
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const folder = await window.viewer.chooseFolder(document.root);
                      if (folder !== document.root && folder)
                        throw new Error('Choose the workflow folder: ' + document.root);
                    })
                  }
                >
                  Allow workflow folder…
                </button>
              </div>
              {editor !== undefined && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(async () => {
                      const errors: ParseError[] = [];
                      const value = parse(editor, errors, {
                        allowTrailingComma: true,
                        disallowComments: false,
                      });
                      if (errors.length) throw new Error('Fix the JSONC syntax before saving.');
                      const definition = workflowDefinitionSchema.parse(value);
                      setDocument(
                        documentReply(
                          await window.viewer.workflow({
                            kind: 'save',
                            file: document.file,
                            revision: document.revision,
                            definition,
                          }),
                        ),
                      );
                      setEditor(undefined);
                      select();
                    });
                  }}
                >
                  <label className="field-label">
                    Workflow JSONC
                    <textarea
                      className="workflow-editor"
                      spellCheck={false}
                      rows={14}
                      value={editor}
                      onChange={(event) => setEditor(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <div className="settings-actions">
                    <button type="button" disabled={busy} onClick={() => setEditor(undefined)}>
                      Cancel editing
                    </button>
                    <button type="submit" disabled={busy}>
                      Save definition
                    </button>
                  </div>
                </form>
              )}
            </div>
          </details>
        )}
        <WatchRuleControls
          document={document}
          bindings={bindings}
          disabled={busy || editor !== undefined}
          openRun={select}
          reviewDefinition={async (rule) => {
            await read(rule.scope.file);
            setBindings(rule.scope.bindings);
          }}
        />
        <section aria-label="Workflow runs">
          <h3>Runs</h3>
          {!runs.length && <p className="muted">No workflow runs yet.</p>}
          {runs.map((item) => (
            <button
              className="workflow-run-choice"
              key={item.id}
              aria-pressed={selected === item.id}
              onClick={() => select(item.id)}
            >
              <strong>{item.definition.name}</strong>
              <span>
                {statusLabel[item.status]} · {new Date(item.created).toLocaleString()}
              </span>
            </button>
          ))}
        </section>
        {selected && !current && <Loading label="Opening run…" />}
        {current && (
          <section aria-label="Selected run" className="workflow-run">
            <h3>
              {current.definition.name} · {statusLabel[current.status]}
            </h3>
            <ol className="workflow-steps">
              {current.steps.map((record) => (
                <li key={record.id}>
                  <div className="project-control-row">
                    <strong>{record.id}</strong>
                    <span>{statusLabel[record.status]}</span>
                  </div>
                  {record.error && (
                    <p className="error" role="alert">
                      {record.error}
                    </p>
                  )}
                  {record.status === 'waiting-review' && record.taskID && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          if (record.kind === 'copy') {
                            const plan = await window.viewer.operationPlan({
                              kind: 'get',
                              id: record.taskID!,
                            });
                            if (Array.isArray(plan)) throw new Error('The task is unavailable.');
                            reviewOperationPlan(plan);
                          } else
                            window.dispatchEvent(
                              new CustomEvent('viewer:tasks', { detail: record.taskID }),
                            );
                          setOpen(false);
                        })
                      }
                    >
                      Review {record.kind === 'copy' ? 'copy' : 'recipe'}…
                    </button>
                  )}
                  {record.artifact !== undefined && <WorkflowArtifact value={record.artifact} />}
                  {record.outputs.length > 0 && (
                    <small className="muted">
                      {record.outputs.length} output{' '}
                      {record.outputs.length === 1 ? 'reference' : 'references'}
                    </small>
                  )}
                </li>
              ))}
            </ol>
            <div className="settings-actions">
              <button
                disabled={busy || !['waiting-review', 'paused'].includes(current.status)}
                onClick={() =>
                  void perform(async () =>
                    setRun(
                      runReply(await window.viewer.workflow({ kind: 'resume', id: current.id })),
                    ),
                  )
                }
              >
                Resume workflow
              </button>
              <button
                disabled={busy || !['running', 'waiting-review', 'paused'].includes(current.status)}
                onClick={() =>
                  void perform(async () =>
                    setRun(
                      runReply(await window.viewer.workflow({ kind: 'cancel', id: current.id })),
                    ),
                  )
                }
              >
                Cancel run
              </button>
              <button
                disabled={busy || !['completed', 'failed', 'cancelled'].includes(current.status)}
                onClick={() =>
                  void perform(async () => {
                    await window.viewer.workflow({ kind: 'remove', id: current.id });
                    select();
                  })
                }
              >
                Remove run history
              </button>
            </div>
          </section>
        )}
        {busy && <Loading label="Updating workflow…" />}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
