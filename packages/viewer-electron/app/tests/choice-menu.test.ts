// @vitest-environment jsdom
/**
 * CHOICES USE THE SEARCHABLE MENU (2026-10-23): a long native dropdown (the languages, 30 and more)
 * gave way to the context menu's keyboard-first search, the current choice checked.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { ChoiceButton } from '../src/renderer/ui/ChoiceMenu';

afterEach(cleanup);
const choices = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'plaintext', label: 'Plain text' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust', aliases: ['rs'] },
];
const button = (onChoose = vi.fn()) =>
  render(createElement(ChoiceButton, { label: 'Language', value: 'markdown', choices, onChoose }));

it('shows the current choice, and opens a searchable menu with it checked', async () => {
  const view = button();
  const trigger = view.getByRole('button', { name: 'Language' });
  expect(trigger.textContent).toContain('Markdown');
  fireEvent.click(trigger);
  const menu = await waitFor(() => view.getByRole('dialog', { name: 'Language' }));
  expect(menu.querySelectorAll('.command-result')).toHaveLength(4);
  expect(view.getByLabelText('Search Language')).toBe(document.activeElement);
  // only the current choice carries an icon, its check; the others keep its place blank
  const rows = [...menu.querySelectorAll('.command-result')];
  expect(rows.filter((row) => row.querySelector('svg')).map((row) => row.textContent)).toEqual([
    'Markdown',
  ]);
  expect(rows.filter((row) => row.querySelector('.command-icon-spacer'))).toHaveLength(3);
});
it('chooses what the search finds, by name or alias', async () => {
  const onChoose = vi.fn();
  const view = button(onChoose);
  fireEvent.click(view.getByRole('button', { name: 'Language' }));
  const search = await waitFor(() => view.getByLabelText('Search Language'));
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
  fireEvent.click(view.getByRole('button', { name: 'Language' }));
  const search = await waitFor(() => view.getByLabelText('Search Language'));
  fireEvent.keyDown(search, { key: 'Escape' });
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(onChoose).not.toHaveBeenCalled();
});
it('lines up with the end of its button, shows a short list, and no repeated heading', async () => {
  const view = button();
  const trigger = view.getByRole('button', { name: 'Language' });
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
  const trigger = view.getByRole('button', { name: 'Recipe' });
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
  fireEvent.click(view.getByRole('button', { name: 'Language' }));
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
  const opener = view.getByRole('button', { name: 'Language' });
  fireEvent.click(opener);
  const menu = await waitFor(() => view.getByRole('dialog', { name: 'Language' }));
  fireEvent.click(menu.querySelectorAll<HTMLElement>('.command-result')[2]!);
  await waitFor(() => expect(view.queryByRole('dialog', { name: 'Language' })).toBeNull());
  expect(onChoose).toHaveBeenCalledWith('python');
  expect(document.activeElement).toBe(opener);
});
