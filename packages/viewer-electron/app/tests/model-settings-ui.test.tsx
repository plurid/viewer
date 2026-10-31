// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ModelSettings } from '../src/renderer/ui/models/ModelSettings';
import { defaultSettings } from '../src/domain/services';
import type { SettingsSnapshot } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { newModelProvider } from '../src/domain/models/providers';
import type { SettingsChange } from '../src/renderer/ui/settings/settings-edits';

vi.mock('../src/renderer/ui/ChoiceMenu', () => ({
  ChoiceButton: ({
    label,
    value,
    choices,
    onChoose,
  }: {
    label: string;
    value: string;
    choices: { value: string; label: string }[];
    onChoose(value: string): void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChoose(event.target.value)}>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  ),
}));
afterEach(cleanup);

function setup() {
  const settings = defaultSettings('/fixtures');
  settings.providers = [
    { ...newModelProvider('gemini', 'one'), name: 'Research', model: 'a-complete-model-name' },
    { ...newModelProvider('local', 'two'), name: 'Local work', model: 'local-model' },
  ];
  settings.prompts.providerID = 'one';
  const snapshot: SettingsSnapshot = {
    revision: 1,
    settings,
    ui: normalizePreferences(),
    look: 'dark',
    credentials: ['one'],
  };
  const services = {
    providerModels: vi.fn(async () => ['discovered-model']),
    providerCredential: vi.fn(async () => {}),
    providerPermissionGet: vi.fn(async () => ({ level: 'names', agents: false })),
    providerPermissionAgents: vi.fn(async () => {}),
    onEvent: () => () => {},
  };
  Object.assign(window, { viewer: services });
  const save = vi.fn<(change: SettingsChange) => void>();
  const error = vi.fn();
  const view = render(<ModelSettings snapshot={snapshot} save={save} error={error} />);
  return { snapshot, services, save, error, view };
}

it('shows complete configured identities and the effective default without connecting on mount', async () => {
  const { services, save, snapshot } = setup();
  await within(document.querySelector('.settings-provider')! as HTMLElement).findByLabelText(
    'Allow agent-started actions to send the same data',
  );
  expect(screen.getByLabelText('Default model for Ask Viewer').textContent).toContain(
    'a-complete-model-name',
  );
  const entries = document.querySelectorAll('.model-summary');
  expect(entries[0]!.textContent).toContain('Researcha-complete-model-name');
  expect(entries[0]!.textContent).toContain('Configured · connection not checked');
  expect(entries[0]!.textContent).toContain('Default for Ask');
  expect(services.providerModels).not.toHaveBeenCalled();
  expect(services.providerCredential).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Default model for Ask Viewer'), {
    target: { value: 'two' },
  });
  expect(save.mock.calls[0]![0](snapshot)).toEqual([
    { path: 'settings.prompts', value: { providerID: 'two' } },
  ]);
});

it('provides an explicit Add model setup flow without changing existing provider IDs', () => {
  const { snapshot, save, services } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
  fireEvent.change(screen.getByLabelText('New model provider'), { target: { value: 'local' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set up model' }));
  const patch = save.mock.calls[0]![0](snapshot)[0]!;
  expect(patch.path).toBe('settings.providers');
  expect(patch.value).toEqual([
    ...snapshot.settings.providers,
    expect.objectContaining({ kind: 'local' }),
  ]);
  expect(services.providerModels).not.toHaveBeenCalled();
});

it('reports an explicit connection result and ignores a completion for a replaced model', async () => {
  const { snapshot, save, services, view, error } = setup();
  const first = document.querySelector('.settings-provider')! as HTMLElement;
  fireEvent.click(within(first).getByRole('button', { name: 'Connect and load models' }));
  await within(first).findByText('Connected · 1 model IDs available');
  let finish!: (values: string[]) => void;
  services.providerModels.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(within(first).getByRole('button', { name: 'Connect and load models' }));
  const changed = {
    ...snapshot,
    settings: {
      ...snapshot.settings,
      providers: snapshot.settings.providers.map((provider) => ({
        ...provider,
        model: 'replacement',
      })),
    },
  };
  view.rerender(<ModelSettings snapshot={changed} save={save} error={error} />);
  await act(async () => finish(['old-model']));
  expect(first.querySelector('.model-summary')!.textContent).toContain('connection not checked');
  expect(first.querySelector('.model-summary')!.textContent).not.toContain('Connected');
  expect(error).toHaveBeenLastCalledWith('');
});

it('keeps the agent permission checkbox labeled and sends only an explicit change', async () => {
  const { services } = setup();
  const checkbox = await within(
    document.querySelector('.settings-provider')! as HTMLElement,
  ).findByLabelText('Allow agent-started actions to send the same data');
  expect(services.providerPermissionAgents).not.toHaveBeenCalled();
  fireEvent.click(checkbox);
  expect(services.providerPermissionAgents).toHaveBeenCalledExactlyOnceWith(
    'one',
    expect.any(String),
    true,
  );
});

it('offers a reasoning effort only for a provider that takes one, and leaves it out for the default', () => {
  const settings = defaultSettings('/fixtures');
  const meta = { ...newModelProvider('meta', 'meta'), effort: 'minimal' as const };
  settings.providers = [meta, { ...newModelProvider('gemini', 'gemini'), model: 'gemini-model' }];
  const snapshot: SettingsSnapshot = {
    revision: 1,
    settings,
    ui: normalizePreferences(),
    look: 'dark',
    credentials: [],
  };
  Object.assign(window, {
    viewer: {
      providerPermissionGet: vi.fn(async () => null),
      onEvent: () => () => {},
    },
  });
  const save = vi.fn<(change: SettingsChange) => void>();
  render(<ModelSettings snapshot={snapshot} save={save} error={vi.fn()} />);
  const efforts = screen.getAllByLabelText('Reasoning effort');
  // only the Meta provider's editor offers it
  expect(efforts).toHaveLength(1);
  const effort = efforts[0] as HTMLSelectElement;
  expect(effort.value).toBe('minimal');
  expect([...effort.options].map((option) => option.textContent)).toEqual([
    'Provider default',
    'Minimal: fastest answers',
    'Low',
  ]);
  fireEvent.change(effort, { target: { value: 'low' } });
  expect(save.mock.calls[0]![0](snapshot)[0]!.value).toEqual([
    { ...meta, effort: 'low' },
    settings.providers[1],
  ]);
  fireEvent.change(effort, { target: { value: '' } });
  const [cleared] = save.mock.calls[1]![0](snapshot)[0]!.value as (typeof meta)[];
  expect(cleared).not.toHaveProperty('effort');
});

it('names the SAM model only for a local server, and leaves it out when cleared', () => {
  const settings = defaultSettings('/fixtures');
  const local = { ...newModelProvider('local', 'local'), model: 'muse-spark-1.3' };
  settings.providers = [local, { ...newModelProvider('meta', 'meta') }];
  const snapshot: SettingsSnapshot = {
    revision: 1,
    settings,
    ui: normalizePreferences(),
    look: 'dark',
    credentials: [],
  };
  Object.assign(window, {
    viewer: {
      providerPermissionGet: vi.fn(async () => null),
      onEvent: () => () => {},
    },
  });
  const save = vi.fn<(change: SettingsChange) => void>();
  const view = render(<ModelSettings snapshot={snapshot} save={save} error={vi.fn()} />);
  // only the local provider's editor asks; Meta outlines with SAM 3.1 itself
  const fields = screen.getAllByLabelText('Outlines with SAM');
  expect(fields).toHaveLength(1);
  const field = fields[0] as HTMLInputElement;
  expect(field.value).toBe('');
  fireEvent.change(field, { target: { value: ' sam-3.1 ' } });
  fireEvent.blur(field);
  const [named] = save.mock.calls[0]![0](snapshot)[0]!.value as (typeof local)[];
  expect(named).toEqual({ ...local, segmentation: 'sam-3.1' });
  const saved = { ...snapshot, settings: { ...settings, providers: [named!] } };
  view.rerender(<ModelSettings snapshot={saved} save={save} error={vi.fn()} />);
  expect(field.value).toBe('sam-3.1');
  fireEvent.change(field, { target: { value: '' } });
  fireEvent.blur(field);
  const [cleared] = save.mock.calls[1]![0](saved)[0]!.value as (typeof local)[];
  expect(cleared).not.toHaveProperty('segmentation');
});
