// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SpeechReply, SpeechRequest, SpeechStatus } from '../src/domain/speech/recognition';
import type { DesktopEvent } from '../src/domain/contracts';
import { DictationButton } from '../src/renderer/speech/DictationButton';
import { DictationDialog } from '../src/renderer/speech/DictationDialog';
import { SpeechSettings } from '../src/renderer/speech/SpeechSettings';

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
