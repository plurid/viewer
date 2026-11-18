// @vitest-environment jsdom
/**
 * Choices use the searchable menu: a long native dropdown (the languages, 30 and more)
 * gave way to the context menu's keyboard-first search, the current choice checked.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { Choice } from '../src/renderer/ui/ChoiceMenu';
import { ChoiceButton } from '../src/renderer/ui/ChoiceMenu';
import { FormField } from '../src/renderer/ui/FormField';
import { Row } from '../src/renderer/ui/primitives';
import { choiceLabel } from './support/choice-button';

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
  const trigger = view.getByRole('button', { name: choiceLabel('Language') });
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
    fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
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

it('moves by type-ahead only to the start of a name, and not on Command, Control or Option', () => {
  const view = button();
  fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
  const list = view.getByRole('menu', { name: 'Language' });
  const active = () => document.getElementById(list.getAttribute('aria-activedescendant')!);

  // a shortcut is not a letter typed: “Rust” stays where it is
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) {
    fireEvent.keyDown(list, { key: 'r', [modifier]: true });
    expect(active()?.textContent).toContain('Markdown');
  }
  // “Python” has a y, but no name starts with one
  fireEvent.keyDown(list, { key: 'y' });
  expect(active()?.textContent).toContain('Markdown');
});

it('takes a Space typed within a name as part of it, not as choosing', () => {
  const onChoose = vi.fn();
  const view = button(onChoose);
  fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
  const list = view.getByRole('menu', { name: 'Language' });
  for (const key of 'plain t') fireEvent.keyDown(list, { key });

  expect(onChoose).not.toHaveBeenCalled();
  expect(document.getElementById(list.getAttribute('aria-activedescendant')!)?.textContent).toBe(
    'Plain text',
  );
});

it('finds a name by type-ahead however its accents are stored', () => {
  const view = render(
    createElement(ChoiceButton, {
      label: 'Font',
      value: 'arial',
      choices: [
        { value: 'arial', label: 'Arial' },
        { value: 'ecole', label: 'École'.normalize('NFD') },
      ],
      onChoose: vi.fn(),
    }),
  );
  fireEvent.click(view.getByRole('button', { name: choiceLabel('Font') }));
  const list = view.getByRole('menu', { name: 'Font' });
  fireEvent.keyDown(list, { key: 'é' });

  expect(list.getAttribute('aria-activedescendant')).toBe(
    view.getByRole('menuitemradio', { name: 'École'.normalize('NFD') }).id,
  );
});

it('opens with the up arrow as with the down arrow', () => {
  const view = button();
  fireEvent.keyDown(view.getByRole('button', { name: choiceLabel('Language') }), {
    key: 'ArrowUp',
  });
  expect(view.getByRole('menu', { name: 'Language' })).toBeTruthy();
});

it('names its button by its label and the choice it shows, and checks that choice', () => {
  const view = button();
  const trigger = view.getByRole('button', { name: 'Language Markdown' });
  // the bare label stays an attribute that scripts find the button by
  expect(trigger.getAttribute('aria-label')).toBe('Language');
  fireEvent.click(trigger);

  const rows = view.getAllByRole('menuitemradio');
  expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual([
    'true',
    'false',
    'false',
    'false',
  ]);
});

it('says when it has no choices', () => {
  const view = render(
    createElement(ChoiceButton, { label: 'Language', value: '', choices: [], onChoose: vi.fn() }),
  );
  fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
  expect(view.getByRole('status').textContent).toBe('No choices');
});

it.each(['Python version', 'PDF zoom'])(
  'shows “Search” in its search field and names it with the label as written: %s',
  (label) => {
    const view = render(
      createElement(ChoiceButton, {
        label,
        value: 'markdown',
        choices: longChoices,
        onChoose: vi.fn(),
      }),
    );
    fireEvent.click(view.getByRole('button', { name: choiceLabel(label) }));
    const search = view.getByRole('textbox', { name: 'Search ' + label });
    expect(search.getAttribute('placeholder')).toBe('Search');
  },
);

it('opens a long list with its current choice in view', () => {
  const languages = Array.from({ length: 40 }, (_, index) => ({
    value: 'l' + index,
    label: 'Language ' + index,
  }));
  const measure = HTMLElement.prototype.getBoundingClientRect;
  // the list shows 100 to 300; the current row lies far below, at 1222 to 1256
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.matches('.context-menu > .command-results')) return new DOMRect(0, 100, 300, 200);
    if (this.dataset.menuId === 'choice:l33') return new DOMRect(0, 1222, 300, 34);
    return measure.call(this);
  });
  try {
    const view = render(
      createElement(ChoiceButton, {
        label: 'Language',
        value: 'l33',
        choices: languages,
        onChoose: vi.fn(),
      }),
    );
    fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
    const current = view.getByRole('menuitemradio', { name: 'Language 33' });

    expect(current.getAttribute('data-active')).toBe('true');
    expect(current.closest<HTMLElement>('.command-results')!.scrollTop).toBe(1256 - 300);
  } finally {
    spy.mockRestore();
  }
});

const formats = [
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'png', label: 'PNG' },
];
type Wrap = (control: ReactElement) => ReactElement;
it.each<{ name: string; wrap: Wrap }>([
  { name: 'form field', wrap: (control) => createElement(FormField, { label: 'Format' }, control) },
  { name: 'Settings row', wrap: (control) => createElement(Row, { label: 'Format', control }) },
])('closes on a press on its $name label, which does not open it again', ({ wrap }) => {
  const view = render(
    wrap(
      createElement(ChoiceButton, {
        label: 'Image output format',
        value: 'webp',
        choices: formats,
        onChoose: vi.fn(),
      }),
    ),
  );
  const trigger = view.getByRole('button', { name: 'Image output format WebP' });
  fireEvent.click(trigger);
  const text = view.getByText('Format');
  const phases = [trigger.getAttribute('aria-expanded')];
  fireEvent.pointerDown(text);
  phases.push(trigger.getAttribute('aria-expanded'));
  fireEvent.click(text);
  phases.push(trigger.getAttribute('aria-expanded'));

  expect(phases).toEqual(['true', 'true', 'false']);
  expect(document.activeElement).toBe(trigger);
  // as a press on the button does, a press on the label opens it again
  fireEvent.pointerDown(text);
  fireEvent.click(text);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
});

/** A press as the browser delivers it: down, up and a click counting one, in one task. */
const press = (element: HTMLElement) => {
  fireEvent.pointerDown(element);
  fireEvent.pointerUp(element);
  fireEvent.click(element, { detail: 1 });
};

it('only closes on a press outside: the button it lands on does not run', async () => {
  const onExport = vi.fn();
  const view = render(
    createElement(
      'div',
      null,
      createElement(ChoiceButton, {
        label: 'Format',
        value: 'webp',
        choices: formats,
        onChoose: vi.fn(),
      }),
      createElement('button', { onClick: onExport }, 'Export Image'),
    ),
  );
  const trigger = view.getByRole('button', { name: choiceLabel('Format') });
  fireEvent.click(trigger);
  const exportButton = view.getByRole('button', { name: 'Export Image' });
  press(exportButton);

  expect(view.queryByRole('dialog', { name: 'Format' })).toBeNull();
  expect(onExport).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  press(exportButton);
  expect(onExport).toHaveBeenCalledTimes(1);
});

it('closes on a press on another dropdown, which that press does not open, as on macOS', () => {
  const view = render(
    createElement(
      'div',
      null,
      createElement(ChoiceButton, {
        label: 'Format',
        value: 'png',
        choices: formats,
        onChoose: vi.fn(),
      }),
      createElement(ChoiceButton, {
        label: 'Resize',
        value: 'webp',
        choices: formats,
        onChoose: vi.fn(),
      }),
    ),
  );
  const format = view.getByRole('button', { name: choiceLabel('Format') });
  const resize = view.getByRole('button', { name: choiceLabel('Resize') });
  fireEvent.click(format);
  press(resize);
  expect([format, resize].map((button) => button.getAttribute('aria-expanded'))).toEqual([
    'false',
    'false',
  ]);
});

it('closes on a press on another field’s label, which that press then does not reach', () => {
  const view = render(
    createElement(
      'div',
      null,
      createElement(
        FormField,
        { label: 'Format' },
        createElement(ChoiceButton, {
          label: 'Image output format',
          value: 'webp',
          choices: formats,
          onChoose: vi.fn(),
        }),
      ),
      createElement(FormField, { label: 'Quality' }, createElement('input', { type: 'number' })),
    ),
  );
  const trigger = view.getByRole('button', { name: choiceLabel('Image output format') });
  fireEvent.click(trigger);
  press(view.getByText('Quality'));

  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  // the label did not hand its press to its field
  expect(document.activeElement).toBe(trigger);
});

it('keeps the active row in view as the keyboard moves it back up', () => {
  const languages = Array.from({ length: 40 }, (_, index) => ({
    value: 'l' + index,
    label: 'Language ' + index,
  }));
  const measure = HTMLElement.prototype.getBoundingClientRect;
  // the list shows 100 to 300; its rows are 34 px each, moved up as it scrolls
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const list = this.closest<HTMLElement>('.command-results');
    if (this.matches('.context-menu > .command-results')) return new DOMRect(0, 100, 300, 200);
    if (this.matches('.command-result') && list) {
      const index = [...list.querySelectorAll('.command-result')].indexOf(this);
      return new DOMRect(0, 100 + index * 34 - list.scrollTop, 300, 34);
    }
    return measure.call(this);
  });
  try {
    const view = render(
      createElement(ChoiceButton, {
        label: 'Language',
        value: 'l33',
        choices: languages,
        onChoose: vi.fn(),
      }),
    );
    fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
    const list = view.getByRole('menu', { name: 'Language' });
    expect(list.scrollTop).toBe(100 + 34 * 34 - 300);
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Home' });
    expect(list.scrollTop).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

it('lists what a search finds as options, none of them a checked radio item', () => {
  const view = button(vi.fn(), longChoices);
  fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'P' } });
  const options = view.getAllByRole('option');

  expect(options.length).toBeGreaterThan(0);
  expect(options.filter((option) => option.hasAttribute('aria-checked'))).toEqual([]);
});

it('lists plain items, not radio items, when none of them is the current value', () => {
  const view = render(
    createElement(ChoiceButton, {
      label: 'Recipe',
      value: '',
      placeholder: 'Choose an action',
      choices,
      onChoose: vi.fn(),
    }),
  );
  fireEvent.click(view.getByRole('button', { name: choiceLabel('Recipe') }));
  expect(view.getAllByRole('menuitem')).toHaveLength(4);
  expect(view.queryAllByRole('menuitemradio')).toEqual([]);
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
    const trigger = view.getByRole('button', { name: choiceLabel('Language') });
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const holder = document.activeElement!;
    const list = view.getByRole('menu', { name: 'Language' });
    const owner =
      options.length > 8 ? view.getByRole('textbox', { name: 'Search Language' }) : list;

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
  const trigger = view.getByRole('button', { name: choiceLabel('Language') });
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
  fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
  const search = await waitFor(() => view.getByLabelText('Search Language'));
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
  fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
  const list = await waitFor(() => view.getByRole('menu', { name: 'Language' }));
  fireEvent.keyDown(list, { key: 'Escape' });
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(onChoose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(view.getByRole('button', { name: choiceLabel('Language') }));
  expect(
    view.getByRole('button', { name: choiceLabel('Language') }).getAttribute('aria-expanded'),
  ).toBe('false');
});

it.each([8, 9])('shows search only above eight choices, with %i choices', (count) => {
  const view = button(vi.fn(), longChoices.slice(0, count));
  fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
  expect(!!view.queryByRole('textbox', { name: 'Search Language' })).toBe(count > 8);
});

it('keeps the full short list and keyboard focus when an open list loses its search field', () => {
  const onChoose = vi.fn();
  const view = button(onChoose, longChoices);
  fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
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
  const trigger = view.getByRole('button', { name: choiceLabel('Language') });
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
  const trigger = view.getByRole('button', { name: choiceLabel('Language') });
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
    const trigger = view.getByRole('button', { name: choiceLabel('Language') });
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
    const trigger = view.getByRole('button', { name: choiceLabel('Language') });
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
    const trigger = view.getByRole('button', { name: choiceLabel('Language') });
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
  const trigger = view.getByRole('button', { name: choiceLabel('Language') });
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
  const trigger = view.getByRole('button', { name: choiceLabel('Recipe') });
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
  fireEvent.click(view.getByRole('button', { name: choiceLabel('Language') }));
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
  const opener = view.getByRole('button', { name: choiceLabel('Language') });
  fireEvent.click(opener);
  const menu = await waitFor(() => view.getByRole('dialog', { name: 'Language' }));
  fireEvent.click(menu.querySelectorAll<HTMLElement>('.command-result')[2]!);
  await waitFor(() => expect(view.queryByRole('dialog', { name: 'Language' })).toBeNull());
  expect(onChoose).toHaveBeenCalledWith('python');
  expect(document.activeElement).toBe(opener);
});
