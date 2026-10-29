import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ActionContext, ActionPlan, ActionRequest, ActionRecipe } from '../../domain/services';
import { activeWorkspace, report, useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { Dialog, Empty, IconButton, Loading, NameDialog } from '../ui/primitives';
import { useModelPermission } from '../ui/models/ModelDataPermission';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { modelDataLabels, modelPermissionCovers } from '../../domain/models/permissions';
import type { CheckpointEstimate } from '../../domain/operations/change-plan';
import { formatBytes } from '../../domain/files/entries';
import { baseName } from '../../domain/workspaces/planes';
import { planOrigin } from './commands';
import { errorMessage } from '../../domain/errors';
import { onWindowEvent } from '../app/window-events';
const busy = (plan: ActionPlan) => ['planning', 'applying'].includes(plan.status);
const name = (path: string) => baseName(path);
function destinationParts(path: string) {
  const separator = path.startsWith('/') ? '/' : path.includes('\\') ? '\\' : '/';
  const index = path.lastIndexOf(separator);
  return {
    separator,
    prefix: path.slice(0, index + 1),
    directory: path.slice(0, index) || separator,
    filename: path.slice(index + 1),
  };
}
export function ActionHub() {
  const workspace = useWorkspace();
  const [plans, setPlans] = useState<ActionPlan[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [request, setRequest] = useState<{ recipeID: string; context: ActionContext }>();
  const merge = (plan: ActionPlan) =>
    setPlans((old) => {
      const previous = old.find((item) => item.id === plan.id);
      return previous && previous.revision >= plan.revision
        ? old
        : [plan, ...old.filter((item) => item.id !== plan.id)];
    });
  useEffect(() => {
    let alive = true;
    const remove = window.viewer.onEvent((event) => {
      if (event.type === 'action') merge(event.plan);
    });
    void window.viewer
      .actionList()
      .then((value) => {
        if (alive) for (const plan of value) merge(plan);
      })
      .catch(report);
    const stopRequests = onWindowEvent('viewer:action-request', ({ recipeID, context }) => {
      if (!context.paneID || context.workspaceID !== activeWorkspace().id) return;
      const rootID = workspace.rootID(context.paneID);
      if (!rootID) {
        report(new Error('The originating plane is unavailable.'));
        return;
      }
      setRequest({
        recipeID,
        context: {
          workspaceID: context.workspaceID,
          paneID: context.paneID,
          rootID,
          actor: 'user',
          sources: context.selection.map((file) => file.path),
        },
      });
    });
    const stopTasks = onWindowEvent('viewer:tasks', (id) => {
      setOpen(true);
      setSelected(id);
    });
    return () => {
      alive = false;
      remove();
      stopRequests();
      stopTasks();
    };
  }, [workspace]);
  const pending = plans.filter((plan) =>
    ['planning', 'review', 'applying', 'partial', 'recovery'].includes(plan.status),
  ).length;
  const plan = plans.find((plan) => plan.id === selected);
  return (
    <>
      {pending > 0 && (
        <button className="tasks-button" aria-label="Action tasks" onClick={() => setOpen(true)}>
          <span>{plans.some(busy) ? 'Tasks' : 'Review'}</span>
          <span className="count-badge">{pending}</span>
        </button>
      )}
      {createPortal(
        <>
          {request && (
            <ConfigureTask
              {...request}
              onClose={() => setRequest(undefined)}
              onStart={(id) => {
                setRequest(undefined);
                setOpen(true);
                setSelected(id);
                void window.viewer.actionGet(id).then(merge).catch(report);
              }}
            />
          )}
          {open && !request && (
            <Dialog
              title={plan?.title || 'Action tasks'}
              wide
              className="task-dialog"
              onClose={() => setOpen(false)}
            >
              {selected && !plan ? (
                <Loading label="Preparing task…" />
              ) : plan ? (
                <>
                  <div className="task-context">
                    <button onClick={() => setSelected(undefined)}>All tasks</button>
                    <span>
                      {plan.context.sources.length} selected · {planOrigin(plan.context)}
                    </span>
                    <span>{plan.status}</span>
                  </div>
                  <TaskReview key={plan.id + ':' + plan.revision} plan={plan} />
                </>
              ) : (
                <div className="task-list">
                  {!plans.length ? (
                    <Empty
                      icon="command"
                      title="No action tasks"
                      detail="Select files, then choose an action from the context menu or Commands."
                    />
                  ) : (
                    plans.map((item) => (
                      <button key={item.id} onClick={() => setSelected(item.id)}>
                        <strong>{item.title}</strong>
                        <span>
                          {item.rows.length
                            ? `${item.rows.length} ${item.rows.length === 1 ? 'change' : 'changes'}`
                            : `${item.context.sources.length} selected`}
                        </span>
                        <span>{item.status}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </Dialog>
          )}
        </>,
        document.body,
      )}
    </>
  );
}
function ConfigureTask({
  recipeID,
  context,
  onClose,
  onStart,
}: {
  recipeID: string;
  context: ActionContext;
  onClose(): void;
  onStart(id: string): void;
}) {
  const settings = useViewer((state) => state.settings.settings);
  const [chosen, setChosen] = useState(recipeID);
  const recipe: ActionRecipe | undefined = settings.recipes.find((recipe) => recipe.id === chosen);
  const [instructions, setInstructions] = useState('');
  const [recursive, setRecursive] = useState(recipe?.recursive || false);
  const [options, setOptions] = useState<NonNullable<ActionRequest['options']>>({
    template: recipe?.template,
  });
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const provider = settings.providers.find((provider) => provider.id === recipe?.providerID);
  const remote = recipe?.kind !== 'batch-rename' ? provider : undefined;
  const permission = useModelPermission(remote);
  const [approval, setApproval] = useState('');
  const approvalKey = remote && recipe ? `${remote.id}:${remote.endpoint}:${recipe.data}` : '';
  const approved =
    remote && recipe && modelPermissionCovers(permission.permission, remote, recipe.data);
  const action = useRef<HTMLLabelElement>(null);
  // in place of data-autofocus: the dialog, a child, has opened in its effect, which runs first
  useEffect(() => {
    action.current?.querySelector('button')?.focus({ preventScroll: true });
  }, []);
  return (
    <Dialog title="Run action" onClose={onClose} className="action-config">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!recipe || starting || (remote && !approved && approval !== approvalKey)) return;
          setStarting(true);
          try {
            if (remote && !approved)
              await window.viewer.providerPermissionSet(remote.id, remote.endpoint, recipe.data);
            const id = await window.viewer.actionStart({
              recipeID: recipe.id,
              context: { ...context, recursive },
              instructions,
              options,
            });
            onStart(id);
          } catch (error) {
            setError(errorMessage(error));
            setStarting(false);
          }
        }}
      >
        <label className="field-label" ref={action}>
          Action
          <ChoiceButton
            label="Action"
            value={chosen}
            choices={settings.recipes.map((recipe) => ({ value: recipe.id, label: recipe.name }))}
            placeholder="Choose an action"
            onChoose={(id) => {
              setChosen(id);
              const next = settings.recipes.find((recipe) => recipe.id === id);
              setRecursive(next?.recursive || false);
              setOptions({ template: next?.template });
            }}
          />
        </label>
        {!recipe && (
          <p className="error" role="alert">
            The recipe “{chosen}” no longer exists. Choose another action.
          </p>
        )}
        <p className="muted">
          {context.sources.length} selected · {context.sources.slice(0, 2).map(name).join(', ')}
          {context.sources.length > 2 && ', …'}
        </p>
        {recipe?.kind === 'batch-rename' ? (
          <div className="batch-fields">
            {(['template', 'prefix', 'suffix', 'find', 'replace'] as const).map((key) => (
              <label className="field-label" key={key}>
                {
                  {
                    template: 'Filename template',
                    prefix: 'Prefix',
                    suffix: 'Suffix',
                    find: 'Find text',
                    replace: 'Replace with',
                  }[key]
                }
                <input
                  value={options[key] || ''}
                  onChange={(event) => setOptions({ ...options, [key]: event.target.value })}
                />
              </label>
            ))}
            <p className="muted">Template fields: {'{name} {extension} {number}'}</p>
            <label className="field-label">
              Letter case
              <ChoiceButton
                label="Letter case"
                value={options.case || 'keep'}
                choices={[
                  { value: 'keep', label: 'Keep' },
                  { value: 'lower', label: 'lowercase' },
                  { value: 'upper', label: 'UPPERCASE' },
                  { value: 'title', label: 'Title Case' },
                ]}
                onChoose={(value) =>
                  setOptions({
                    ...options,
                    case: value as NonNullable<ActionRequest['options']>['case'],
                  })
                }
              />
            </label>
            <label className="field-label">
              Number padding
              <input
                type="number"
                min={0}
                max={12}
                value={options.padding ?? 0}
                onChange={(event) =>
                  setOptions({ ...options, padding: Number(event.target.value) })
                }
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={!!options.regex}
                onChange={(event) => setOptions({ ...options, regex: event.target.checked })}
              />{' '}
              Find with regular expression
            </label>
            {options.regex && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={!!options.ignoreCase}
                  onChange={(event) => setOptions({ ...options, ignoreCase: event.target.checked })}
                />{' '}
                Ignore case
              </label>
            )}
            <label className="check-row">
              <input
                type="checkbox"
                checked={!!options.metadata}
                onChange={(event) => setOptions({ ...options, metadata: event.target.checked })}
              />{' '}
              Read document metadata for template fields
            </label>
            <label className="field-label">
              Start numbering at
              <input
                type="number"
                min={0}
                value={options.start ?? 1}
                onChange={(event) => setOptions({ ...options, start: Number(event.target.value) })}
              />
            </label>
          </div>
        ) : (
          <>
            <label className="field-label">
              Additional instructions
              <textarea
                rows={4}
                placeholder={recipe?.instructions}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                maxLength={12000}
              />
            </label>
            <p className="muted">
              {provider
                ? `${provider.name} · ${provider.model} · ${recipe?.data === 'names' ? 'filenames only' : 'local text extraction sent to this provider'}`
                : recipe?.kind === 'book-name'
                  ? 'Local publication metadata. Missing fields remain unresolved.'
                  : 'Choose a model for this action in Settings.'}
            </p>
          </>
        )}
        {remote && recipe && (
          <div className="model-data-permission">
            <p className="muted">
              This action sends your instructions and {modelDataLabels[recipe.data]} to{' '}
              <span className="model-endpoint">{remote.endpoint}</span>.
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={!!approved || approval === approvalKey}
                disabled={starting || permission.loading || !!approved || !!permission.error}
                onChange={(event) => setApproval(event.target.checked ? approvalKey : '')}
              />
              {approved
                ? 'Data access approved'
                : 'Allow this data for actions using this provider'}
            </label>
            <p className="muted">
              You can revoke access in Settings → Models. Revoking stops running requests.
            </p>
            {permission.loading && (
              <p role="status" className="muted">
                Checking permission…
              </p>
            )}
            {permission.error && (
              <p role="alert" className="error">
                {permission.error}
              </p>
            )}
          </div>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(event) => setRecursive(event.target.checked)}
          />
          Include subfolders
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              starting ||
              !recipe ||
              (!!remote &&
                (permission.loading ||
                  !!permission.error ||
                  (!approved && approval !== approvalKey)))
            }
          >
            {starting ? 'Preparing…' : 'Create proposal'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function TaskReview({ plan }: { plan: ActionPlan }) {
  const [checkpoint, setCheckpoint] = useState(false);
  const [estimate, setEstimate] = useState<CheckpointEstimate>();
  const [checkpointError, setCheckpointError] = useState('');
  const [edits, setEdits] = useState(() =>
    plan.rows.map((row) => ({ id: row.id, destination: row.destination, approved: row.approved })),
  );
  const [inspect, setInspect] = useState<string>();
  const [editingPath, setEditingPath] = useState<string>();
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [exportAt, setExportAt] = useState<string>();
  const viewport = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: plan.rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 112,
    overscan: 4,
  });
  const review = plan.status === 'review';
  const selected = edits.filter((edit) => edit.approved).length;
  const checkpointPaths = [
    ...new Set(
      edits
        .filter((edit) => edit.approved)
        .flatMap((edit) => plan.rows.find((row) => row.id === edit.id)?.source?.path || []),
    ),
  ];
  const checkpointKey = JSON.stringify(checkpointPaths);
  useEffect(() => {
    // The serialized key keeps an unchanged selection from re-estimating every render.
    const paths = JSON.parse(checkpointKey) as string[];
    if (!checkpoint || !paths.length) {
      setEstimate(undefined);
      return;
    }
    let live = true;
    setEstimate(undefined);
    setCheckpointError('');
    void window.viewer
      .checkpoints({ kind: 'estimate', paths })
      .then((value) => {
        if (live && value && 'supported' in value) setEstimate(value);
      })
      .catch((error: Error) => {
        if (live) setCheckpointError(error.message);
      });
    return () => {
      live = false;
    };
  }, [checkpoint, checkpointKey]);
  const act = async (run: () => Promise<void>) => {
    setWorking(true);
    setError('');
    try {
      await run();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setWorking(false);
    }
  };
  const inspected = plan.rows.find((row) => row.id === inspect);
  return (
    <>
      {plan.error && (
        <p className="inline-warning" role="alert">
          {plan.error}
        </p>
      )}
      {busy(plan) && (
        <Loading
          label={plan.status === 'planning' ? 'Building proposal…' : 'Applying approved changes…'}
        />
      )}
      {!!plan.summary && <pre className="task-summary">{plan.summary}</pre>}
      {!!plan.rows.length && (
        <>
          <div className="task-selection">
            <label>
              <input
                type="checkbox"
                checked={selected > 0 && selected === edits.length}
                disabled={!review}
                onChange={(event) =>
                  setEdits(
                    edits.map((edit) => ({
                      ...edit,
                      approved:
                        event.target.checked && !plan.rows.find((row) => row.id === edit.id)?.issue,
                    })),
                  )
                }
              />
              Select available changes
            </label>
            <span>
              {selected} of {plan.rows.length} selected
            </span>
          </div>
          <div ref={viewport} className="task-rows">
            <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
              {rows.getVirtualItems().map((virtual) => {
                const row = plan.rows[virtual.index],
                  edit = edits[virtual.index];
                if (!row || !edit) return null;
                const issue = edit.destination === row.destination ? row.issue : undefined;
                const destination = destinationParts(edit.destination);
                const fullPath = editingPath === row.id;
                return (
                  <div
                    key={row.id}
                    className="task-row"
                    style={{
                      position: 'absolute',
                      width: '100%',
                      height: virtual.size,
                      transform: `translateY(${virtual.start}px)`,
                    }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Approve ${row.source?.name || row.kind}`}
                      checked={edit.approved}
                      disabled={!review || !!issue}
                      onChange={(event) =>
                        setEdits(
                          edits.map((value) =>
                            value.id === edit.id
                              ? { ...value, approved: event.target.checked }
                              : value,
                          ),
                        )
                      }
                    />
                    <div>
                      <div className="task-source" title={row.source?.path}>
                        {row.source?.name || 'Summary export'}
                        <span>{row.completed ? 'Completed' : issue || row.error}</span>
                      </div>
                      <label className="task-destination">
                        <span>{fullPath ? 'Path' : 'Name'}</span>
                        <input
                          aria-label={`Destination for ${row.source?.name || row.kind}`}
                          disabled={!review}
                          value={fullPath ? edit.destination : destination.filename}
                          title={edit.destination}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (
                              !fullPath &&
                              (value.includes('/') ||
                                (destination.separator === '\\' && value.includes('\\')))
                            ) {
                              setError('Use Edit path to change the destination folder.');
                              return;
                            }
                            setError('');
                            setEdits(
                              edits.map((value) =>
                                value.id === edit.id
                                  ? {
                                      ...value,
                                      destination: fullPath
                                        ? event.target.value
                                        : destination.prefix + event.target.value,
                                    }
                                  : value,
                              ),
                            );
                          }}
                        />
                      </label>
                      <div className="task-location">
                        <span title={destination.directory}>In {destination.directory}</span>
                        {review && (
                          <button
                            aria-label={`${fullPath ? 'Edit filename' : 'Edit path'} for ${row.source?.name || row.kind}`}
                            onClick={() => setEditingPath(fullPath ? undefined : row.id)}
                          >
                            {fullPath ? 'Edit filename' : 'Edit path'}
                          </button>
                        )}
                      </div>
                    </div>
                    <IconButton
                      icon="info"
                      label={`Evidence for ${row.source?.name || row.kind}`}
                      onClick={() => setInspect(inspect === row.id ? undefined : row.id)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {inspected && (
        <aside className="task-evidence">
          <strong>{inspected.source?.name} · evidence</strong>
          {inspected.evidence.length ? (
            inspected.evidence.map((source, index) => (
              <p key={index}>
                <span>{source.source}</span>
                <q>{source.text}</q>
              </p>
            ))
          ) : (
            <p>No document evidence was used.</p>
          )}
        </aside>
      )}
      {error && (
        <p className="inline-warning" role="alert">
          {error}
        </p>
      )}
      <footer>
        {review && checkpointPaths.length > 0 && (
          <div className="checkpoint-choice">
            <label className="check-row">
              <input
                type="checkbox"
                checked={checkpoint}
                disabled={working}
                onChange={(event) => setCheckpoint(event.target.checked)}
              />
              Keep a content checkpoint
            </label>
            {checkpoint && (
              <span className="muted">
                {estimate
                  ? formatBytes(estimate.bytes) +
                    ' · ' +
                    formatBytes(estimate.availableBytes) +
                    ' available'
                  : checkpointError || 'Estimating…'}
              </span>
            )}
            {checkpoint && (
              <span className="muted">
                File contents and mode. Finder tags and ACLs are not included.
              </span>
            )}
            {checkpoint &&
              estimate?.issues.map((issue) => (
                <span className="error" key={issue}>
                  {issue}
                </span>
              ))}
          </div>
        )}
        {busy(plan) && (
          <button
            disabled={working}
            onClick={() => void act(() => window.viewer.actionCancel(plan.id))}
          >
            Cancel task
          </button>
        )}
        {['partial', 'recovery'].includes(plan.status) && (
          <button
            disabled={working}
            onClick={() => void act(() => window.viewer.actionRecover(plan.id))}
          >
            Review recovery
          </button>
        )}
        {plan.undoable && (
          <button
            disabled={working}
            onClick={() => void act(() => window.viewer.actionUndo(plan.id))}
          >
            Undo changes
          </button>
        )}
        {plan.summary && review && !plan.rows.length && (
          <button
            disabled={working}
            onClick={() =>
              void act(async () => {
                const folder = await window.viewer.chooseFolder();
                if (folder) setExportAt(folder);
              })
            }
          >
            Export summary…
          </button>
        )}
        {review && !!plan.rows.length && (
          <button
            className="primary"
            disabled={
              working || !selected || (checkpoint && (!estimate?.supported || !!checkpointError))
            }
            onClick={() =>
              void act(() =>
                window.viewer.actionApply({
                  id: plan.id,
                  revision: plan.revision,
                  rows: edits,
                  checkpoint,
                }),
              )
            }
          >
            {working ? 'Applying…' : `Apply ${selected} ${selected === 1 ? 'change' : 'changes'}`}
          </button>
        )}
        {!busy(plan) && !plan.rows.length && !plan.summary && (
          <span className="muted">No file changes</span>
        )}
      </footer>
      {exportAt && (
        <NameDialog
          title="Export summary"
          initial="Summary.md"
          action="Review export"
          onClose={() => setExportAt(undefined)}
          onSubmit={(filename) =>
            window.viewer.actionExportSummary(plan.id, exportAt + '/' + filename)
          }
        />
      )}
    </>
  );
}
