// @vitest-environment jsdom
/**
 * Choices use the searchable menu: a long native dropdown (the languages, 30 and more)
 * gave way to the context menu's keyboard-first search, the current choice checked.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { Choice } from '../src/renderer/ui/ChoiceMenu';
import { ChoiceButton } from '../src/renderer/ui/ChoiceMenu';

afterEach(cleanup);
HTMLElement.prototype.scrollIntoView ??= function () {};
const choices = [
  { value: 'markdown', label: 'Markdown', detail: 'Formatted text with headings and links.' },
  { value: 'plaintext', label: 'Plain text' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust', aliases: ['rs'] },
];
const longChoices = [
  ...choices,
  ...Array.from({ length: 8 }, (_, index) => ({
    value: `other-${index}`,
    label: `Other ${index}`,
  })),
];
const choiceLists = [
  { name: 'short list', choices },
  { name: 'searchable list', choices: longChoices },
];
const button = (onChoose = vi.fn(), options: readonly Choice[] = choices) =>
  render(
    createElement(ChoiceButton, {
      label: 'Language',
      value: 'markdown',
      choices: options,
      onChoose,
    }),
  );

it('uses a list without search for four choices, with type-to-select, arrows and Enter', () => {
  const onChoose = vi.fn();
  const view = button(onChoose);
  const trigger = view.getByRole('button', { name: /^Language / });
  fireEvent.click(trigger);

  expect(view.queryByRole('textbox')).toBeNull();
  const list = view.getByRole('menu', { name: 'Language' });
  expect(document.activeElement).toBe(list);
  fireEvent.keyDown(list, { key: 'p' });
  expect(list.getAttribute('aria-activedescendant')).toBe(
    view.getByRole('menuitemradio', { name: 'Plain text' }).id,
  );
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  expect(list.getAttribute('aria-activedescendant')).toBe(
    view.getByRole('menuitemradio', { name: 'Python' }).id,
  );
  fireEvent.keyDown(list, { key: 'Enter' });

  expect(onChoose).toHaveBeenCalledWith('python');
  expect(view.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('moves by type-ahead as a native menu: letters typed together, or one letter again', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const view = button();
    fireEvent.click(view.getByRole('button', { name: /^Language / }));
    const list = view.getByRole('menu', { name: 'Language' });
    const active = () => document.getElementById(list.getAttribute('aria-activedescendant')!);
    const type = (...keys: string[]) => {
      for (const key of keys) fireEvent.keyDown(list, { key });
    };

    type('p', 'y');
    expect(active()?.textContent).toBe('Python');
    vi.setSystemTime(Date.now() + 1000);
    type('p');
    expect(active()?.textContent).toBe('Plain text');
    type('p');
    expect(active()?.textContent).toBe('Python');
    type('p');
    expect(active()?.textContent).toBe('Plain text');
    vi.setSystemTime(Date.now() + 1000);
    type('r', 'z');
    expect(active()?.textContent).toBe('Rust');
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  { key: ' ', name: 'short list', choices },
  { key: 'Enter', name: 'short list', choices },
  { key: 'Enter', name: 'searchable list', choices: longChoices },
])(
  'opens a $name on the current choice, so $key keeps it and gives the keyboard back',
  ({ key, choices: options }) => {
    const onChoose = vi.fn();
    const view = render(
      createElement(ChoiceButton, {
        label: 'Language',
        value: 'python',
        choices: options,
        onChoose,
      }),
    );
    const trigger = view.getByRole('button', { name: /^Language / });
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const holder = document.activeElement!;
    const list = view.getByRole('menu', { name: 'Language' });
    const owner =
      options.length > 8 ? view.getByRole('textbox', { name: 'Search language' }) : list;

    expect(holder).toBe(owner);
    expect(owner.getAttribute('aria-activedescendant')).toBe(
      view.getByRole('menuitemradio', { name: 'Python' }).id,
    );
    fireEvent.keyDown(holder, { key });
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('python');
    expect(view.queryByRole('dialog')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  },
);

it('shows the current choice checked in a short list without a repeated heading', async () => {
  const view = button();
  const trigger = view.getByRole('button', { name: /^Language / });
  expect(trigger.textContent).toContain('Markdown');
  fireEvent.click(trigger);
  const menu = await waitFor(() => view.getByRole('dialog', { name: 'Language' }));
  expect(menu.querySelectorAll('.command-result')).toHaveLength(4);
  expect(view.getByRole('menu', { name: 'Language' })).toBe(document.activeElement);
  // only the current choice carries an icon, its check; the others keep its place blank
  const rows = [...menu.querySelectorAll('.command-result')];
  expect(rows.filter((row) => row.querySelector('svg')).map((row) => row.textContent)).toEqual([
    'MarkdownFormatted text with headings and links.',
  ]);
  expect(rows[0]!.querySelector('small')?.textContent).toBe(
    'Formatted text with headings and links.',
  );
  expect(rows.filter((row) => row.querySelector('.command-icon-spacer'))).toHaveLength(3);
});
it('chooses what the search finds, by name or alias', async () => {
  const onChoose = vi.fn();
  const view = button(onChoose, longChoices);
  fireEvent.click(view.getByRole('button', { name: /^Language / }));
  const search = await waitFor(() => view.getByLabelText('Search language'));
  expect(view.getAllByRole('menuitemradio')).toHaveLength(12);
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: 'rs' } });
  await waitFor(() =>
    expect(view.getByRole('dialog').querySelectorAll('.command-result')).toHaveLength(1),
  );
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(onChoose).toHaveBeenCalledWith('rust'));
  expect(view.queryByRole('dialog')).toBeNull();
});
it('closes on Escape without choosing', async () => {
  const onChoose = vi.fn();
  const view = button(onChoose);
  fireEvent.click(view.getByRole('button', { name: /^Language / }));
  const list = await waitFor(() => view.getByRole('menu', { name: 'Language' }));
  fireEvent.keyDown(list, { key: 'Escape' });
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(onChoose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(view.getByRole('button', { name: /^Language / }));
  expect(view.getByRole('button', { name: /^Language / }).getAttribute('aria-expanded')).toBe(
    'false',
  );
});

it.each([8, 9])('shows search only above eight choices, with %i choices', (count) => {
  const view = button(vi.fn(), longChoices.slice(0, count));
  fireEvent.click(view.getByRole('button', { name: /^Language / }));
  expect(!!view.queryByRole('textbox', { name: 'Search language' })).toBe(count > 8);
});

it('keeps the full short list and keyboard focus when an open list loses its search field', () => {
  const onChoose = vi.fn();
  const view = button(onChoose, longChoices);
  fireEvent.click(view.getByRole('button', { name: /^Language / }));
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'rs' } });
  view.rerender(
    createElement(ChoiceButton, { label: 'Language', value: 'markdown', choices, onChoose }),
  );
  const list = view.getByRole('menu', { name: 'Language' });

  expect(view.queryByRole('textbox')).toBeNull();
  expect(view.getAllByRole('menuitemradio')).toHaveLength(4);
  expect(document.activeElement).toBe(list);
  fireEvent.keyDown(list, { key: 'P' });
  fireEvent.keyDown(list, { key: 'Enter' });
  expect(onChoose).toHaveBeenCalledExactlyOnceWith('plaintext');
});

it('closes when its button is pressed again without treating that press as outside', () => {
  const onChoose = vi.fn();
  const view = button(onChoose);
  const trigger = view.getByRole('button', { name: /^Language / });
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  fireEvent.pointerDown(trigger);
  expect(view.queryByRole('dialog')).not.toBeNull();
  fireEvent.click(trigger);

  expect(view.queryByRole('dialog')).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  expect(onChoose).not.toHaveBeenCalled();
});

it.each(['Enter', ' '])('toggles on repeated keyboard activation with %j', (key) => {
  const onChoose = vi.fn();
  const view = button(onChoose);
  const trigger = view.getByRole('button', { name: /^Language / });
  const activate = () => {
    act(() => trigger.focus());
    const activateDefault = fireEvent.keyDown(trigger, { key });
    fireEvent.keyUp(trigger, { key });
    // jsdom does not synthesize the native button click for keyboard activation.
    if (activateDefault) fireEvent.click(trigger, { detail: 0 });
  };
  activate();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  activate();

  expect(view.queryByRole('dialog')).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  expect(onChoose).not.toHaveBeenCalled();
});

it.each(choiceLists)(
  'closes after choosing the current item and returns focus in a $name',
  ({ choices: options }) => {
    const onChoose = vi.fn();
    const view = button(onChoose, options);
    const trigger = view.getByRole('button', { name: /^Language / });
    fireEvent.click(trigger);
    fireEvent.click(view.getAllByRole('menuitemradio')[0]!);

    expect(onChoose).toHaveBeenCalledExactlyOnceWith('markdown');
    expect(view.queryByRole('dialog')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  },
);

it.each(choiceLists)(
  'closes on an outside press and returns focus in a $name',
  ({ choices: options }) => {
    const onChoose = vi.fn();
    const view = button(onChoose, options);
    const trigger = view.getByRole('button', { name: /^Language / });
    fireEvent.click(trigger);
    const outside = document.createElement('button');
    outside.textContent = 'Elsewhere';
    view.container.append(outside);
    const focusOutside = fireEvent.pointerDown(outside, { cancelable: true });
    // A pointer press normally focuses its target after the handler returns.
    if (focusOutside) act(() => outside.focus());

    expect(view.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(onChoose).not.toHaveBeenCalled();
  },
);

it.each(choiceLists)(
  'closes on Tab and returns focus without moving it away again in a $name',
  ({ choices: options }) => {
    const onChoose = vi.fn();
    const view = button(onChoose, options);
    const trigger = view.getByRole('button', { name: /^Language / });
    fireEvent.click(trigger);
    const target = document.activeElement!;
    expect(fireEvent.keyDown(target, { key: 'Tab' })).toBe(false);

    expect(view.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(onChoose).not.toHaveBeenCalled();
  },
);
it('lines up with the end of its button, shows a short list, and no repeated heading', async () => {
  const view = button();
  const trigger = view.getByRole('button', { name: /^Language / });
  trigger.getBoundingClientRect = () =>
    ({ left: 300, right: 420, top: 20, bottom: 50, width: 120, height: 30 }) as DOMRect;
  const measure = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains('context-menu')
      ? ({ left: 0, top: 0, right: 304, bottom: 200, width: 304, height: 200 } as DOMRect)
      : measure.call(this);
  };
  try {
    fireEvent.click(trigger);
    const menu = await waitFor(() => view.getByRole('dialog', { name: 'Language' }));
    expect(menu.classList.contains('choice-menu')).toBe(true);
    expect(menu.querySelector<HTMLElement>('.context-menu')?.style.left).toBe(`${420 - 304}px`);
    expect(menu.querySelector('.command-group')).toBeNull();
  } finally {
    HTMLElement.prototype.getBoundingClientRect = measure;
  }
});
it('names a value no choice has by its placeholder, and opens with the down arrow', async () => {
  const view = render(
    createElement(ChoiceButton, {
      label: 'Recipe',
      value: '',
      placeholder: 'Choose an action',
      choices,
      onChoose: vi.fn(),
    }),
  );
  const trigger = view.getByRole('button', { name: /^Recipe / });
  expect(trigger.textContent).toContain('Choose an action');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await waitFor(() => expect(view.getByRole('dialog', { name: 'Recipe' })).toBeTruthy());
});
it('opens inside the dialog it is in, above which a page-level menu would not show', async () => {
  const view = render(
    createElement(
      'dialog',
      { open: true },
      createElement(ChoiceButton, {
        label: 'Language',
        value: 'markdown',
        choices,
        onChoose: vi.fn(),
      }),
    ),
  );
  fireEvent.click(view.getByRole('button', { name: /^Language / }));
  const menu = await waitFor(() => view.getByRole('dialog', { name: 'Language' }));
  expect(menu.closest('dialog[open]')).not.toBeNull();
});
it('gives the keyboard back to its button once chosen, inside a dialog too', async () => {
  const onChoose = vi.fn();
  const view = render(
    createElement(
      'dialog',
      { open: true },
      createElement(ChoiceButton, { label: 'Language', value: 'markdown', choices, onChoose }),
    ),
  );
  const opener = view.getByRole('button', { name: /^Language / });
  fireEvent.click(opener);
  const menu = await waitFor(() => view.getByRole('dialog', { name: 'Language' }));
  fireEvent.click(menu.querySelectorAll<HTMLElement>('.command-result')[2]!);
  await waitFor(() => expect(view.queryByRole('dialog', { name: 'Language' })).toBeNull());
  expect(onChoose).toHaveBeenCalledWith('python');
  expect(document.activeElement).toBe(opener);
});
