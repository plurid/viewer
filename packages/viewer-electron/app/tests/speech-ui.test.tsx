// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SpeechReply, SpeechRequest, SpeechStatus } from '../src/domain/speech/recognition';
import type { DesktopEvent } from '../src/domain/contracts';
import { DictationButton } from '../src/renderer/speech/DictationButton';
import { DictationDialog } from '../src/renderer/speech/DictationDialog';
import { SpeechSettings } from '../src/renderer/speech/SpeechSettings';
import { HostedSpeechSettings } from '../src/renderer/speech/HostedSpeechSettings';
import { newSpeechProvider, speechProviderSchema } from '../src/domain/speech/providers';

const audio = vi.hoisted(() => ({ capture: vi.fn(), finish: vi.fn(), cancel: vi.fn() }));
vi.mock('../src/renderer/speech/capture', () => ({ captureAudio: audio.capture }));
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
      {choices.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));
const status: SpeechStatus = {
  models: {
    selected: 'whisper-base',
    runtime: { name: 'whisper.cpp', recognitionAvailable: true, reason: 'Local' },
    models: [],
    records: [],
  },
  preferences: { language: 'auto', microphone: '' },
  microphone: 'granted',
  setup: [],
};
let events: ((event: DesktopEvent) => void)[];
const request = vi.fn<(request: SpeechRequest) => Promise<SpeechReply>>();
beforeEach(() => {
  events = [];
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  audio.finish.mockReset().mockResolvedValue(new Uint8Array(32000));
  audio.cancel.mockReset();
  audio.capture.mockReset().mockResolvedValue({ finish: audio.finish, cancel: audio.cancel });
  request.mockReset().mockImplementation(async (value) =>
    value.kind === 'status'
      ? status
      : value.kind === 'transcribe'
        ? {
            text: 'Open Documents',
            language: 'en',
            seconds: 1,
            milliseconds: 10,
            model: 'whisper-base',
          }
        : value.kind === 'begin'
          ? { id: value.id, preferences: status.preferences }
          : null,
  );
  Object.assign(window, {
    viewer: {
      speech: request,
      onEvent: (listener: (event: DesktopEvent) => void) => {
        events.push(listener);
        return () => {
          events = events.filter((item) => item !== listener);
        };
      },
      openSettings: vi.fn(),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('keeps connection checks separate from recording consent and shows advisory failures', async () => {
  const provider = {
    ...newSpeechProvider('meta', crypto.randomUUID()),
    hasKey: true,
    allowed: false,
  };
  const send = vi.fn<(request: SpeechRequest) => Promise<boolean>>(async () => true);
  const props = {
    snapshot: { providers: [provider] },
    selectedID: provider.id,
    busy: false,
    select: vi.fn(),
    request: send,
  };
  const view = render(<HostedSpeechSettings {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check connection and model' }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledExactlyOnceWith({ kind: 'provider-check', id: provider.id }),
  );
  expect(screen.getByRole('button', { name: 'Allow recordings…' })).toBeTruthy();
  view.rerender(
    <HostedSpeechSettings
      {...props}
      snapshot={{
        providers: [
          {
            ...provider,
            check: {
              outcome: 'model-unavailable',
              detail: 'Edit the model ID, then retry.',
              checkedAt: 1,
            },
          },
        ],
      }}
    />,
  );
  expect(screen.getByText('Edit the model ID, then retry.')).toBeTruthy();
});
it('keeps failed provider setup editable, saves only configuration fields and never reuses a key for another provider', async () => {
  const provider = {
    ...newSpeechProvider('openai', crypto.randomUUID()),
    hasKey: true,
    allowed: true,
  };
  const other = {
    ...newSpeechProvider('deepgram', crypto.randomUUID()),
    hasKey: false,
    allowed: false,
  };
  const send = vi.fn<(request: SpeechRequest) => Promise<boolean>>(async () => false),
    select = vi.fn();
  const props = {
    snapshot: { providers: [provider, other] },
    selectedID: provider.id,
    busy: false,
    select,
    request: send,
  };
  const view = render(<HostedSpeechSettings {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit provider' }));
  fireEvent.change(screen.getByLabelText('Speech provider model'), {
    target: { value: 'edited-model' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(screen.getByRole('form', { name: 'Speech provider setup' })).toBeTruthy();
  const first = send.mock.calls[0]!;
  expect(first[0].kind).toBe('provider-save');
  if (first[0].kind === 'provider-save')
    expect(speechProviderSchema.safeParse(first[0].provider).success).toBe(true);
  send.mockResolvedValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
  await waitFor(() => expect(select).toHaveBeenCalledWith(provider.id));
  fireEvent.change(screen.getByLabelText('Speech provider API key'), {
    target: { value: 'GENERATED_SECRET' },
  });
  view.rerender(<HostedSpeechSettings {...props} selectedID={other.id} />);
  expect(screen.getByLabelText('Speech provider API key')).toHaveProperty('value', '');
  expect(screen.getByRole('button', { name: 'Save key' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Allow recordings…' })).toHaveProperty(
    'disabled',
    true,
  );
});
it('names the hosted processor and keeps its transcript editable before insertion', async () => {
  const use = vi.fn();
  request.mockImplementation(async (value) =>
    value.kind === 'begin'
      ? {
          id: value.id,
          preferences: {
            ...status.preferences,
            backend: 'hosted',
            providerID: crypto.randomUUID(),
          },
          processing: {
            kind: 'hosted',
            providerID: crypto.randomUUID(),
            providerName: 'Generated speech service',
            endpoint: 'https://speech.example.test/v1',
            model: 'test-model',
          },
        }
      : value.kind === 'transcribe'
        ? {
            text: 'Generated words',
            language: 'en',
            seconds: 1,
            milliseconds: 10,
            model: 'test-model',
          }
        : null,
  );
  render(<DictationDialog destination="Note draft" onClose={() => {}} onUse={use} />);
  await screen.findByRole('button', { name: 'Finish and transcribe' });
  expect(screen.getByText(/speech.example.test/).textContent).toContain('test-model');
  expect(screen.queryByText(/stays on this device/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Finish and transcribe' }));
  const transcript = await screen.findByRole('textbox', { name: 'Transcript' });
  expect(use).not.toHaveBeenCalled();
  fireEvent.change(transcript, { target: { value: 'Edited words' } });
  fireEvent.click(screen.getByRole('button', { name: 'Insert text' }));
  expect(use).toHaveBeenCalledWith('Edited words');
});
it('reviews editable words and inserts only after the person chooses Insert text', async () => {
  const use = vi.fn(),
    parentKey = vi.fn();
  render(
    <div onKeyDown={parentKey}>
      <DictationButton target="note-1" destination="Note draft" onUse={use} />
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
  await screen.findByRole('button', { name: 'Finish recording' });
  fireEvent.click(screen.getByRole('button', { name: 'Finish recording' }));
  const transcript = await screen.findByRole('textbox', { name: 'Transcript' });
  expect(use).not.toHaveBeenCalled();
  fireEvent.change(transcript, { target: { value: 'Open my Documents' } });
  fireEvent.keyDown(transcript, { key: 'Enter', ctrlKey: true });
  expect(parentKey).not.toHaveBeenCalled();
  expect(use).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Insert text' }));
  expect(use).toHaveBeenCalledWith('Open my Documents');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('cancels during permission setup and never starts audio after a late response', async () => {
  let allow!: (value: SpeechReply) => void;
  request.mockImplementation(async (value) =>
    value.kind === 'status'
      ? status
      : value.kind === 'begin'
        ? new Promise((resolve) => {
            allow = resolve;
          })
        : null,
  );
  const view = render(
    <DictationDialog destination="Ask Viewer" onClose={() => {}} onUse={() => {}} />,
  );
  await waitFor(() =>
    expect(request.mock.calls.some(([item]) => item.kind === 'begin')).toBe(true),
  );
  view.unmount();
  await act(async () => allow({ id: 'generated' }));
  expect(audio.capture).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([item]) => item.kind === 'cancel')).toBe(true);
});
it('stops a recording when the destination changes and cannot insert into the replacement', async () => {
  const use = vi.fn(),
    view = render(<DictationButton target="note-1" destination="First note" onUse={use} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
  await screen.findByRole('button', { name: 'Finish recording' });
  view.rerender(<DictationButton target="note-2" destination="Other note" onUse={use} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(audio.cancel).toHaveBeenCalledOnce();
  expect(use).not.toHaveBeenCalled();
});
it('handles focus loss, native cancellation and microphone errors without retaining a live stream', async () => {
  render(<DictationDialog destination="Ask Viewer" onClose={() => {}} onUse={() => {}} />);
  await screen.findByRole('button', { name: 'Finish recording' });
  fireEvent(window, new Event('blur'));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('lost focus'),
  );
  expect(audio.cancel).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  await screen.findByRole('button', { name: 'Finish recording' });
  const begin = request.mock.calls.filter(([item]) => item.kind === 'begin').at(-1)![0];
  if (begin.kind !== 'begin') throw new Error('Expected recording');
  act(() =>
    events.forEach((listener) =>
      listener({ type: 'speech', event: { id: begin.id, state: 'cancelled' } }),
    ),
  );
  expect(screen.getByRole('alert').textContent).toContain('Recording stopped');
  expect(audio.cancel).toHaveBeenCalledTimes(2);
});
it('releasing push-to-talk while preparing cancels instead of making a late recording', async () => {
  let ready!: (value: SpeechReply) => void;
  request.mockImplementation(async (value) =>
    value.kind === 'begin'
      ? new Promise((resolve) => {
          ready = resolve;
        })
      : null,
  );
  const props = { destination: 'Ask Viewer', onClose: () => {}, onUse: () => {} };
  const view = render(<DictationDialog {...props} held />);
  view.rerender(<DictationDialog {...props} held={false} />);
  await act(async () => ready({ id: 'generated', preferences: status.preferences }));
  expect(request.mock.calls.some(([item]) => item.kind === 'cancel')).toBe(true);
  expect(audio.capture).not.toHaveBeenCalled();
});
it('Settings stays read-only until a person changes a choice or starts a test', async () => {
  render(<SpeechSettings />);
  await screen.findByRole('combobox', { name: 'Speech language' });
  expect(request.mock.calls.map(([item]) => item.kind)).toEqual(['status']);
  expect(audio.capture).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Speech language' }), {
    target: { value: 'ro' },
  });
  await waitFor(() =>
    expect(
      request.mock.calls.some(
        ([item]) => item.kind === 'preferences' && item.preferences.language === 'ro',
      ),
    ).toBe(true),
  );
});
