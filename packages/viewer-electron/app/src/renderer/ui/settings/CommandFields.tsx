import type { CustomAction, ActionInput, WorkflowStep } from '../../../domain/automation/actions';
import { Field } from './SettingField';
import { ChoiceButton } from '../ChoiceMenu';

export function CommandFields({
  action,
  actions,
  change,
}: {
  action: CustomAction;
  actions: CustomAction[];
  change(patch: Partial<CustomAction>): void;
}) {
  const update = (index: number, patch: Partial<ActionInput>) =>
    change({
      inputs: action.inputs!.map((input, row) => (row === index ? { ...input, ...patch } : input)),
    });
  return (
    <>
      <label className="settings-row">
        <span>
          Palette folder<small>Separate nested folders with /.</small>
        </span>
        <Field
          label="Palette folder"
          value={action.folder?.join(' / ') ?? ''}
          placeholder="Development / Checks"
          save={(value) =>
            change({
              folder: value
                .split('/')
                .map((part) => part.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label className="settings-row">
        <span>
          Only in folders
          <small>One absolute path per line; includes subfolders. Empty means everywhere.</small>
        </span>
        <Field
          label="Command folders"
          multiline
          value={action.when.directories?.join('\n') ?? ''}
          save={(value) =>
            change({
              when: {
                ...action.when,
                directories: value
                  .split('\n')
                  .map((path) => path.trim().replace(/\/$/, '') || '/')
                  .filter((path, index) => !!value.split('\n')[index]?.trim()),
              },
            })
          }
        />
      </label>
      {['executable', 'shell', 'workflow'].includes(action.executor.kind) && (
        <section className="command-input-editor">
          <h3>Parameters</h3>
          <p className="settings-note">
            Executable arguments use {'{input:name}'}. Shell scripts read $VIEWER_INPUT_NAME. Values
            stay literal.
          </p>
          {action.inputs?.map((input, index) => (
            <fieldset key={index}>
              <legend>Parameter {index + 1}</legend>
              <label>
                Name
                <Field
                  label={`Parameter ${index + 1} name`}
                  value={input.name}
                  save={(name) => update(index, { name })}
                />
              </label>
              <label>
                Label
                <Field
                  label={`Parameter ${index + 1} label`}
                  value={input.label}
                  save={(label) => update(index, { label })}
                />
              </label>
              <label>
                Type
                <ChoiceButton
                  label={`Parameter ${index + 1} type`}
                  value={input.kind}
                  onChoose={(kind) =>
                    update(index, {
                      kind: kind as ActionInput['kind'],
                      ...(kind === 'choice' ? { choices: input.choices ?? ['value'] } : {}),
                      ...(kind === 'boolean' ? { initial: 'false' } : {}),
                    })
                  }
                  choices={[
                    { value: 'text', label: 'Text' },
                    { value: 'number', label: 'Number' },
                    { value: 'choice', label: 'Choice' },
                    { value: 'boolean', label: 'Checkbox' },
                  ]}
                />
              </label>
              <label>
                Default
                <Field
                  label={`Parameter ${index + 1} default`}
                  value={input.initial ?? ''}
                  save={(initial) => update(index, { initial })}
                />
              </label>
              {input.kind === 'choice' && (
                <label>
                  Choices
                  <Field
                    label={`Parameter ${index + 1} choices`}
                    value={input.choices?.join('\n') ?? ''}
                    multiline
                    save={(value) => update(index, { choices: value.split('\n').filter(Boolean) })}
                  />
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={input.required}
                  onChange={(event) => update(index, { required: event.target.checked })}
                />{' '}
                Required
              </label>
              <button
                onClick={() => change({ inputs: action.inputs!.filter((_, row) => row !== index) })}
              >
                Remove parameter {index + 1}
              </button>
            </fieldset>
          ))}
          <button
            disabled={(action.inputs?.length ?? 0) >= 20}
            onClick={() =>
              change({
                inputs: [
                  ...(action.inputs ?? []),
                  {
                    name: 'value' + ((action.inputs?.length ?? 0) + 1),
                    label: 'Value',
                    kind: 'text',
                    required: true,
                  },
                ],
              })
            }
          >
            Add parameter
          </button>
        </section>
      )}
      {action.executor.kind === 'workflow' && (
        <WorkflowFields
          action={action}
          actions={actions}
          change={(steps) => change({ executor: { kind: 'workflow', steps } })}
        />
      )}
    </>
  );
}
function WorkflowFields({
  action,
  actions,
  change,
}: {
  action: CustomAction;
  actions: CustomAction[];
  change(steps: WorkflowStep[]): void;
}) {
  if (action.executor.kind !== 'workflow') return null;
  const steps = action.executor.steps;
  const programs = actions.filter(
    (item) => item.id !== action.id && ['shell', 'executable'].includes(item.executor.kind),
  );
  const replace = (index: number, step: WorkflowStep) =>
    change(steps.map((old, row) => (row === index ? step : old)));
  return (
    <section className="command-workflow-editor">
      <h3>Workflow steps</h3>
      <p className="settings-note">
        Steps run in order. A failed or stopped process ends the workflow. Built-in command lines
        can navigate or operate on files; dialogs still need your input.
      </p>
      {steps.map((step, index) => (
        <fieldset key={index}>
          <legend>Step {index + 1}</legend>
          {step.kind === 'action' ? (
            <label>
              Command
              <ChoiceButton
                label={`Workflow step ${index + 1}`}
                value={step.actionID}
                placeholder="Choose a command…"
                onChoose={(actionID) => replace(index, { kind: 'action', actionID })}
                choices={programs.map((item) => ({ value: item.id, label: item.name }))}
              />
            </label>
          ) : (
            <label>
              Built-in command line
              <Field
                label={`Workflow line ${index + 1}`}
                value={step.line}
                save={(line) => replace(index, { kind: 'command', line })}
              />
            </label>
          )}
          <div className="settings-actions">
            <button
              disabled={!index}
              onClick={() => {
                const next = [...steps];
                [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                change(next);
              }}
            >
              Move step {index + 1} up
            </button>
            <button
              disabled={index === steps.length - 1}
              onClick={() => {
                const next = [...steps];
                [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                change(next);
              }}
            >
              Move step {index + 1} down
            </button>
            <button
              disabled={steps.length === 1}
              onClick={() => change(steps.filter((_, row) => row !== index))}
            >
              Remove step {index + 1}
            </button>
          </div>
        </fieldset>
      ))}
      <div className="settings-actions">
        <button
          disabled={!programs.length || steps.length >= 20}
          onClick={() => change([...steps, { kind: 'action', actionID: programs[0]!.id }])}
        >
          Add command step
        </button>
        <button
          disabled={steps.length >= 20}
          onClick={() => change([...steps, { kind: 'command', line: 'refresh' }])}
        >
          Add built-in step
        </button>
      </div>
    </section>
  );
}
