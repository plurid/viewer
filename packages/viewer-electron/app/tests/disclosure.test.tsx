// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Disclosure } from '../src/renderer/ui/Disclosure';
import { Dialog } from '../src/renderer/ui/primitives';

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};
afterEach(cleanup);

const details = (summary: string) =>
  screen.getByText(summary, { selector: 'summary' }).parentElement as HTMLDetailsElement;

/** Toggle events arrive as a task after the change, as in a browser. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/** Escape as the browser handles it in a modal dialog: unless a handler prevents the key, the
 * dialog gets `cancel`. */
function escape(target: Element) {
  const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(key);
  if (!key.defaultPrevented)
    target.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));
}

it('keeps the caller’s class and summary text, adding only the meta it is given', () => {
  render(
    <Disclosure variant="row" className="settings-recipe" summary="Folder views" meta="3 folders">
      <p>Overrides</p>
    </Disclosure>,
  );
  const element = details('Folder views');
  expect(element.className).toContain('settings-recipe');
  expect(element.className).toContain('disclosure-row');
  expect(element.open).toBe(false);
  const summary = element.querySelector(':scope > summary')!;
  expect(summary.textContent).toBe('Folder views3 folders');
  expect(summary.querySelector('.disclosure-meta')!.textContent).toBe('3 folders');
  render(<Disclosure variant="compact" summary="Shared connection" />);
  expect(details('Shared connection').querySelector('summary')!.textContent).toBe(
    'Shared connection',
  );
});

it('opens by itself when uncontrolled, and reports each change', async () => {
  const changed = vi.fn();
  render(
    <Disclosure variant="compact" summary="Definition" defaultOpen onOpenChange={changed}>
      <pre>CREATE TABLE</pre>
    </Disclosure>,
  );
  const element = details('Definition');
  expect(element.open).toBe(true);
  fireEvent.click(element.querySelector('summary')!);
  await settle();
  expect(element.open).toBe(false);
  expect(changed).toHaveBeenLastCalledWith(false);
});

it('follows `open` when controlled', async () => {
  function Controlled() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Show</button>
        <Disclosure variant="compact" summary="Quality" open={open} onOpenChange={setOpen}>
          {open && <p>Fields</p>}
        </Disclosure>
      </>
    );
  }
  render(<Controlled />);
  expect(screen.queryByText('Fields')).toBeNull();
  fireEvent.click(screen.getByText('Show'));
  expect(details('Quality').open).toBe(true);
  expect(screen.getByText('Fields')).toBeTruthy();
  fireEvent.click(details('Quality').querySelector('summary')!);
  await settle();
  expect(screen.queryByText('Fields')).toBeNull();
});

it('keeps a group exclusive: opening one closes the other', async () => {
  render(
    <>
      <Disclosure variant="compact" group="sections" summary="Pinned">
        <p>Pins</p>
      </Disclosure>
      <Disclosure variant="compact" group="sections" summary="Keys">
        <p>Help</p>
      </Disclosure>
      <Disclosure variant="compact" summary="Elsewhere" defaultOpen>
        <p>Other</p>
      </Disclosure>
    </>,
  );
  fireEvent.click(details('Pinned').querySelector('summary')!);
  await settle();
  expect(details('Pinned').open).toBe(true);
  expect(details('Pinned').getAttribute('name')).toBe('sections');
  fireEvent.click(details('Keys').querySelector('summary')!);
  await settle();
  expect(details('Keys').open).toBe(true);
  expect(details('Pinned').open).toBe(false);
  expect(details('Elsewhere').open).toBe(true);
});

it('closes on Escape before the dialog around it, unless a control inside took the key', async () => {
  const onClose = vi.fn();
  render(
    <Dialog title="What can I do here?" onClose={onClose}>
      <input aria-label="Find an action" />
      <input
        aria-label="Own Escape"
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.preventDefault();
        }}
      />
      <Disclosure variant="compact" summary="Keyboard and mouse" closeOnEscape defaultOpen>
        <button>Show configured key sequences</button>
      </Disclosure>
    </Dialog>,
  );
  const help = details('Keyboard and mouse');
  escape(screen.getByLabelText('Own Escape'));
  expect(help.open).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  const inside = screen.getByText('Show configured key sequences');
  inside.focus();
  escape(inside);
  await settle();
  expect(help.open).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  // the keyboard's place moves to the summary rather than staying on hidden content
  expect(document.activeElement).toBe(help.querySelector('summary'));
  escape(screen.getByLabelText('Find an action'));
  expect(onClose).toHaveBeenCalledTimes(1);
});
