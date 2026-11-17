// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChoiceButton } from '../src/renderer/ui/ChoiceMenu';
import type { ResolvedCommand } from '../src/renderer/commands/registry';
import { ContextMenuResults } from '../src/renderer/ui/ContextMenuResults';
import { Popover } from '../src/renderer/ui/Popover';

const choices = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
];

/** Where a fixed layer's `left`, `top` and `bottom` count from: the window, or an offset box. */
interface Origin {
  x: number;
  y: number;
  bottom: number;
}

let triggerBox: DOMRect;
let menuHeight: number;
let origin: Origin;

beforeEach(() => {
  vi.stubGlobal('innerWidth', 800);
  vi.stubGlobal('innerHeight', 600);
  triggerBox = new DOMRect(400, 300, 120, 30);
  menuHeight = 590;
  origin = { x: 0, y: 0, bottom: 600 };
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.matches('dialog')) {
      return new DOMRect(180, 90, 500, 420);
    }
    if (this.matches('.choice-button')) {
      return triggerBox;
    }
    if (this.matches('.context-menu, .context-submenu, .popover')) {
      const maximum = Number.parseFloat(this.style.maxHeight);
      const height = Number.isFinite(maximum) ? Math.min(menuHeight, maximum) : menuHeight;
      // held by its bottom, as a layer above its anchor is
      const top =
        this.style.top === 'auto'
          ? origin.bottom - (Number.parseFloat(this.style.bottom) || 0) - height
          : origin.y + (Number.parseFloat(this.style.top) || 0);
      return new DOMRect(origin.x + (Number.parseFloat(this.style.left) || 0), top, 300, height);
    }
    return measure.call(this);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const surfaces = [
  { name: 'page', inDialog: false, offset: { x: 0, y: 0, bottom: 600 } },
  { name: 'offset dialog', inDialog: true, offset: { x: 0, y: 0, bottom: 600 } },
  // the dialog's box, 180, 90, 500 × 420, holds the layer
  { name: 'offset containing block', inDialog: true, offset: { x: 180, y: 90, bottom: 510 } },
];

function surface(content: ReactNode, inDialog: boolean) {
  return inDialog ? <dialog open>{content}</dialog> : content;
}

/** A menu that covers no part of its trigger: wholly below it or wholly above it. */
function expectClearOf(menu: HTMLElement) {
  const placed = menu.getBoundingClientRect();
  expect(placed.top >= triggerBox.bottom || placed.bottom <= triggerBox.top).toBe(true);
}

function PopoverButton() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={anchor} className="choice-button" onClick={() => setOpen((value) => !value)}>
        Details
      </button>
      {open && anchor.current && (
        <Popover label="Details" anchor={anchor.current} onClose={() => setOpen(false)}>
          Content
        </Popover>
      )}
    </>
  );
}

it.each(surfaces)(
  'opens a choice menu above when little room remains below on the $name',
  ({ inDialog, offset }) => {
    origin = offset;
    triggerBox = new DOMRect(400, 500, 120, 30);
    menuHeight = 200;
    const view = render(
      surface(
        <ChoiceButton label="Format" value="png" choices={choices} onChoose={vi.fn()} />,
        inDialog,
      ),
    );
    fireEvent.click(view.getByRole('button', { name: /^Format / }));
    const menu = view
      .getByRole('dialog', { name: 'Format' })
      .querySelector<HTMLElement>('.context-menu')!;

    expect(menu.getBoundingClientRect().bottom).toBe(triggerBox.top - 4);
    expect(menu.getBoundingClientRect().height).toBe(200);
    expectClearOf(menu);
  },
);

it.each(surfaces)(
  'shrinks below without covering its trigger when below has more room on the $name',
  ({ inDialog, offset }) => {
    origin = offset;
    triggerBox = new DOMRect(400, 200, 120, 30);
    const view = render(
      surface(
        <ChoiceButton label="Format" value="png" choices={choices} onChoose={vi.fn()} />,
        inDialog,
      ),
    );
    fireEvent.click(view.getByRole('button', { name: /^Format / }));
    const menu = view
      .getByRole('dialog', { name: 'Format' })
      .querySelector<HTMLElement>('.context-menu')!;

    expect(menu.getBoundingClientRect().top).toBe(triggerBox.bottom + 4);
    expect(menu.getBoundingClientRect().bottom).toBe(592);
    expect(menu.style.maxHeight).toBe('358px');
    expectClearOf(menu);
  },
);

it.each(surfaces)(
  'places a popover below its real DOMRect trigger on the $name',
  ({ inDialog, offset }) => {
    origin = offset;
    triggerBox = new DOMRect(400, 160, 120, 30);
    menuHeight = 200;
    const view = render(surface(<PopoverButton />, inDialog));
    fireEvent.click(view.getByRole('button', { name: 'Details' }));
    const popup = view
      .getByRole('dialog', { name: 'Details' })
      .querySelector<HTMLElement>('.popover')!;

    expect(popup.getBoundingClientRect().top).toBe(triggerBox.bottom + 4);
    expect(popup.getBoundingClientRect().right).toBe(triggerBox.right);
    // the room below is larger, but its stylesheet's limit still holds
    expect(popup.style.maxHeight).toBe('200px');
  },
);

it.each(surfaces)(
  'bounds a tall popover above without covering its trigger on the $name',
  ({ inDialog, offset }) => {
    origin = offset;
    const view = render(surface(<PopoverButton />, inDialog));
    fireEvent.click(view.getByRole('button', { name: 'Details' }));
    const popup = view
      .getByRole('dialog', { name: 'Details' })
      .querySelector<HTMLElement>('.popover')!;

    expect(popup.getBoundingClientRect().top).toBe(8);
    expect(popup.getBoundingClientRect().bottom).toBe(triggerBox.top - 4);
    expect(popup.style.maxHeight).toBe('288px');
    expectClearOf(popup);
  },
);

it('opens below its button in a dialog offset in the window, so a second press closes it', () => {
  // The Image tools Format button: a DOMRect has x and y, which once placed the menu on the
  // button's corner as if it were a pointer, so the second press landed in the menu.
  triggerBox = new DOMRect(244, 170, 280, 30);
  menuHeight = 4 * 34 + 10;
  const onChoose = vi.fn();
  const view = render(
    <dialog open>
      <ChoiceButton label="Format" value="webp" choices={choices} onChoose={onChoose} />
    </dialog>,
  );
  const trigger = view.getByRole('button', { name: /^Format / });
  fireEvent.click(trigger);
  const menu = view
    .getByRole('dialog', { name: 'Format' })
    .querySelector<HTMLElement>('.context-menu')!;

  expect(menu.getBoundingClientRect().top).toBe(triggerBox.bottom + 4);
  expect(menu.getBoundingClientRect().right).toBe(triggerBox.right);
  expectClearOf(menu);
  expect(fireEvent.pointerDown(trigger)).toBe(true);
  fireEvent.click(trigger);
  expect(view.queryByRole('dialog', { name: 'Format' })).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  expect(onChoose).not.toHaveBeenCalled();
});

it('uses the fixed layer containing block when it has an offset from the window', () => {
  origin = { x: 180, y: 90, bottom: 510 };
  triggerBox = new DOMRect(400, 160, 120, 30);
  menuHeight = 200;
  const view = render(
    <dialog open style={{ transform: 'translate(0)' }}>
      <ChoiceButton label="Format" value="png" choices={choices} onChoose={vi.fn()} />
    </dialog>,
  );
  fireEvent.click(view.getByRole('button', { name: /^Format / }));
  const menu = view
    .getByRole('dialog', { name: 'Format' })
    .querySelector<HTMLElement>('.context-menu')!;

  expect(menu.getBoundingClientRect().top).toBe(triggerBox.bottom + 4);
  expect(menu.getBoundingClientRect().right).toBe(triggerBox.right);
});

it('shrinks a choice menu above its trigger when neither side fits inside an offset dialog', () => {
  const view = render(
    <dialog open>
      <ChoiceButton label="Format" value="png" choices={choices} onChoose={vi.fn()} />
    </dialog>,
  );
  fireEvent.click(view.getByRole('button', { name: /^Format / }));
  const layer = view.getByRole('dialog', { name: 'Format' });
  const menu = layer.querySelector<HTMLElement>('.context-menu')!;
  const placed = menu.getBoundingClientRect();

  expect(layer.closest('dialog')).not.toBeNull();
  expect(placed.bottom).toBeLessThanOrEqual(triggerBox.top - 4);
  expect(placed.top).toBe(8);
  expect(menu.style.maxHeight).toBe('288px');
});

it('places context flyouts beside their parent in an offset fixed containing block', () => {
  origin = { x: 180, y: 90, bottom: 510 };
  menuHeight = 200;
  const command: ResolvedCommand = {
    id: 'view-list',
    label: 'List',
    group: 'View',
    aliases: [],
    primary: false,
    source: 'window',
    context: { scope: 'window', workspaceID: '', selection: [], jobs: [], clipboard: null },
  };
  const view = render(
    <dialog open style={{ transform: 'translate(0)' }}>
      <ContextMenuResults
        commands={[command]}
        recent={[]}
        focused={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    </dialog>,
  );
  const branch = view.getByRole('menuitem', { name: 'View' });
  branch.getBoundingClientRect = () => new DOMRect(190, 130, 280, 34);
  fireEvent.click(branch);
  const parent = view.getByRole('menu', { name: 'Actions' }).closest('.context-menu')!;
  const flyout = view.getByRole('menu', { name: 'View' });

  expect(flyout.getBoundingClientRect().left).toBe(parent.getBoundingClientRect().right - 2);
  expect(flyout.getBoundingClientRect().top).toBe(124);
});
