// @vitest-environment jsdom
/**
 * A Settings removal or reset asks first: a sheet that names what changes, Cancel as its default,
 * and the action in the danger ink.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { useConfirmation } from '../src/renderer/ui/settings/ConfirmAction';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);

function Theme({ remove }: { remove(): void }) {
  const confirmation = useConfirmation();
  return (
    <>
      <button
        className="danger"
        onClick={() =>
          confirmation.ask({
            title: 'Remove the theme “Dusk”?',
            detail: 'A look that uses it goes back to the built-in theme.',
            action: 'Remove',
            run: remove,
          })
        }
      >
        Remove
      </button>
      {confirmation.dialog}
    </>
  );
}

it('asks, opens on Cancel, and removes only on the danger button', () => {
  const remove = vi.fn();
  render(<Theme remove={remove} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  const dialog = screen.getByRole('dialog', { name: 'Remove the theme “Dusk”?' });
  expect(dialog.textContent).toContain('goes back to the built-in theme');
  expect(document.activeElement?.textContent).toBe('Cancel');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(remove).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  const confirm = screen
    .getAllByRole('button', { name: 'Remove' })
    .find((button) => button.closest('dialog'))!;
  expect(confirm.classList.contains('danger')).toBe(true);
  fireEvent.click(confirm);
  expect(remove).toHaveBeenCalledOnce();
});
