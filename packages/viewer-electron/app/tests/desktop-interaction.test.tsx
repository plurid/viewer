// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Dialog } from '../src/renderer/ui/primitives';
import { editable } from '../src/renderer/commands/editing';

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

it('leaves text movement and selection with all text entry variants', () => {
  for (const markup of [
    '<input>',
    '<textarea></textarea>',
    '<select></select>',
    '<div contenteditable="plaintext-only"><span>Text</span></div>',
    '<div role="textbox"><span>Text</span></div>',
  ]) {
    const host = document.createElement('div');
    host.innerHTML = markup;
    expect(editable(host.querySelector('span') ?? host.firstElementChild)).toBe(true);
  }
  const file = document.createElement('button');
  file.textContent = 'document.txt';
  expect(editable(file)).toBe(false);
});

it('returns dialog focus to its connected opener without taking focus from a replacement', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const first = render(
    <Dialog title="First" onClose={() => {}}>
      <button data-autofocus>Continue</button>
    </Dialog>,
  );
  first.unmount();
  await Promise.resolve();
  expect(document.activeElement).toBe(opener);
  const second = render(
    <Dialog title="Second" onClose={() => {}}>
      <button data-autofocus>Next</button>
    </Dialog>,
  );
  const third = render(
    <Dialog title="Replacement" onClose={() => {}}>
      <button data-autofocus>Finish</button>
    </Dialog>,
  );
  second.unmount();
  await Promise.resolve();
  expect(document.activeElement?.textContent).toBe('Finish');
  third.unmount();
});
