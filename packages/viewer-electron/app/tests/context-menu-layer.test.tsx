// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { flushState, initialize } from '../src/renderer/state/store';
import { ContextMenu } from '../src/renderer/ui/ContextMenu';
import type { LayerPoint } from '../src/renderer/ui/Popover';

let menuHeight: number;

beforeEach(() => {
  vi.stubGlobal('innerWidth', 800);
  vi.stubGlobal('innerHeight', 600);
  vi.stubGlobal('viewer', { save: vi.fn(async () => {}) });
  initialize({
    home: '/home/sample',
    platform: 'darwin',
    state: null,
    openPaths: [],
    locations: [],
  });
  menuHeight = 200;
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.matches('.context-menu')) {
      // in a dialog, the dialog's box, 180, 90, 500 × 420, holds the layer
      const dialog = this.closest('dialog');
      const maximum = Number.parseFloat(this.style.maxHeight);
      const height = Number.isFinite(maximum) ? Math.min(menuHeight, maximum) : menuHeight;
      const top =
        this.style.top === 'auto'
          ? (dialog ? 510 : innerHeight) - (Number.parseFloat(this.style.bottom) || 0) - height
          : (dialog ? 90 : 0) + (Number.parseFloat(this.style.top) || 0);
      return new DOMRect(
        (dialog ? 180 : 0) + (Number.parseFloat(this.style.left) || 0),
        top,
        300,
        height,
      );
    }
    return measure.call(this);
  });
});

afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Opener({
  inDialog,
  point,
  anchorMenu = false,
  workspaceSwitcher = false,
}: {
  inDialog: boolean;
  point: LayerPoint;
  anchorMenu?: boolean;
  workspaceSwitcher?: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [registry] = useState(() => {
    const registry = new CommandRegistry();
    registry.register('window', {
      context: () => ({
        scope: 'window',
        workspaceID: 'sample',
        selection: [],
        jobs: [],
        clipboard: null,
      }),
      definitions: () => [
        { id: 'info', label: 'Information', group: 'Files', when: () => true, run: () => {} },
      ],
    });
    return registry;
  });
  const content = (
    <CommandsContext.Provider value={registry}>
      <button ref={anchor} onClick={() => setOpen((value) => !value)}>
        Actions
      </button>
      {open && anchor.current && (
        <ContextMenu
          label="Actions"
          anchor={anchorMenu ? anchor.current : undefined}
          position={point}
          request={{ scope: 'window', ids: ['info'] }}
          workspaceSwitcher={workspaceSwitcher}
          onClose={() => setOpen(false)}
        />
      )}
    </CommandsContext.Provider>
  );
  return inDialog ? (
    <dialog open style={{ transform: 'translate(0)' }}>
      {content}
    </dialog>
  ) : (
    content
  );
}

const surfaces = [
  { name: 'page', inDialog: false },
  { name: 'dialog with an offset containing block', inDialog: true },
];

it.each(surfaces)(
  'keeps pointer placement and searchable keyboard behavior on the $name',
  ({ inDialog }) => {
    const view = render(<Opener inDialog={inDialog} point={{ x: 400, y: 160 }} />);
    const trigger = view.getByRole('button', { name: 'Actions' });
    trigger.getBoundingClientRect = () => new DOMRect(400, 160, 120, 30);
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const layer = view.getByRole('dialog', { name: 'Actions' });
    const menu = layer.querySelector<HTMLElement>('.context-menu')!;
    const search = view.getByRole('textbox', { name: 'Search actions' });

    expect(menu.getBoundingClientRect().left).toBe(400);
    expect(menu.getBoundingClientRect().top).toBe(160);
    expect(!!layer.closest('dialog')).toBe(inDialog);
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: 'Information' } });
    expect(view.getByRole('option', { name: /^Information/ })).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape' });

    expect(view.queryByRole('dialog', { name: 'Actions' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  },
);

it.each(surfaces)(
  'opens a button context menu above without covering its trigger on the $name',
  ({ inDialog }) => {
    const view = render(<Opener inDialog={inDialog} point={{ x: 400, y: 535 }} anchorMenu />);
    const trigger = view.getByRole('button', { name: 'Actions' });
    trigger.getBoundingClientRect = () => new DOMRect(400, 500, 120, 30);
    fireEvent.click(trigger);
    const menu = view
      .getByRole('dialog', { name: 'Actions' })
      .querySelector<HTMLElement>('.context-menu')!;

    expect(menu.getBoundingClientRect().left).toBe(400);
    expect(menu.getBoundingClientRect().bottom).toBe(496);
    fireEvent.pointerDown(trigger);
    expect(view.queryByRole('dialog', { name: 'Actions' })).not.toBeNull();
    fireEvent.click(trigger);
    expect(view.queryByRole('dialog', { name: 'Actions' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  },
);

it.each([
  {
    name: 'context menu at the pointer',
    anchorMenu: false,
    passes: true,
    outcome: 'lets the press go on to what it lands on',
  },
  {
    name: 'button menu',
    anchorMenu: true,
    passes: false,
    outcome: 'keeps the press, as on macOS',
  },
])('closes a $name on a press outside and $outcome', ({ anchorMenu, passes }) => {
  const view = render(
    <Opener inDialog={false} point={{ x: 400, y: 160 }} anchorMenu={anchorMenu} />,
  );
  const trigger = view.getByRole('button', { name: 'Actions' });
  trigger.getBoundingClientRect = () => new DOMRect(400, 130, 120, 30);
  fireEvent.click(trigger);
  const outside = document.createElement('button');
  view.container.append(outside);

  expect(fireEvent.pointerDown(outside)).toBe(passes);
  expect(view.queryByRole('dialog', { name: 'Actions' })).toBeNull();
});

it.each(surfaces)(
  'keeps pointer menus inside the window near its bottom right on the $name',
  ({ inDialog }) => {
    const view = render(<Opener inDialog={inDialog} point={{ x: 790, y: 590 }} />);
    fireEvent.click(view.getByRole('button', { name: 'Actions' }));
    const menu = view
      .getByRole('dialog', { name: 'Actions' })
      .querySelector<HTMLElement>('.context-menu')!;

    expect(menu.getBoundingClientRect().left).toBe(492);
    expect(menu.getBoundingClientRect().top).toBe(392);
    expect(menu.getBoundingClientRect().bottom).toBe(592);
  },
);

it.each(surfaces)(
  'measures a tall workspace menu with its requested height before clamping on the $name',
  ({ inDialog }) => {
    menuHeight = 700;
    const view = render(
      <Opener inDialog={inDialog} point={{ x: 100, y: 500 }} workspaceSwitcher />,
    );
    fireEvent.click(view.getByRole('button', { name: 'Actions' }));
    const menu = view
      .getByRole('dialog', { name: 'Actions' })
      .querySelector<HTMLElement>('.context-menu')!;

    expect(menu.getBoundingClientRect().top).toBe(8);
    expect(menu.getBoundingClientRect().height).toBe(584);
    expect(menu.getBoundingClientRect().bottom).toBe(592);
  },
);

it('opens the workspace menu under its switcher in a short window, and a second press closes it', () => {
  // As App wires the titlebar's switcher: its box as the anchor, a point under it, a toggle.
  vi.stubGlobal('innerHeight', 300);
  menuHeight = 700;
  const switcher = new DOMRect(80, 6, 140, 28);
  const view = render(
    <Opener
      inDialog={false}
      point={{ x: switcher.left, y: switcher.bottom + 6 }}
      anchorMenu
      workspaceSwitcher
    />,
  );
  const trigger = view.getByRole('button', { name: 'Actions' });
  trigger.getBoundingClientRect = () => switcher;
  fireEvent.click(trigger);
  const menu = view
    .getByRole('dialog', { name: 'Actions' })
    .querySelector<HTMLElement>('.context-menu')!;

  // a point alone was moved up to fit, over the switcher; its box keeps the menu under it
  expect(menu.getBoundingClientRect().top).toBe(switcher.bottom + 4);
  expect(menu.getBoundingClientRect().bottom).toBe(292);
  expect(menu.style.maxHeight).toBe('254px');
  expect(fireEvent.pointerDown(trigger)).toBe(true);
  fireEvent.click(trigger);
  expect(view.queryByRole('dialog', { name: 'Actions' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
