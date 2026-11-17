import {
  Children,
  Fragment,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PreviewCommand, PreviewContext } from './contracts';
import type { HeaderLead, HeaderRank } from '../workspace/header-overflow';
import type { Choice } from '../ui/ChoiceMenu';
import type { IconName } from '../ui/Icon';
import { ChoiceMenu } from '../ui/ChoiceMenu';
import { Icon } from '../ui/Icon';
import { layerContainer } from '../ui/Popover';
import { headerItem, spillMenu, useHeaderOverflow } from '../workspace/header-overflow';
import { report } from '../state/store';

/**
 * A PREVIEW'S TOOLBAR (DESIGN.md, the Preview Bar Rule): one line of one height, in its plane's
 * header or where the preview stands, as in a Columns preview, Quick Preview or the Trash. A
 * labelled action shows as its icon before anything gives way; then items give way by rank into
 * "…", measured by `header-overflow.ts`. Controls that act as one, such as a zoom and its level,
 * give way together. A read-only fact, such as an image's dimensions, is no toolbar item: it goes
 * to the footer's details.
 */

/** The commands a preview's modules registered, which its own "…" names and runs. */
export class PreviewCommandList {
  private sets = new Set<readonly PreviewCommand[]>();
  private listeners = new Set<() => void>();
  private current: readonly PreviewCommand[] = [];
  add(commands: readonly PreviewCommand[]): () => void {
    this.sets.add(commands);
    this.publish();
    return () => {
      this.sets.delete(commands);
      this.publish();
    };
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = (): readonly PreviewCommand[] => this.current;
  private publish() {
    this.current = [...this.sets].flat();
    for (const listener of this.listeners) listener();
  }
}

/** What a preview host offers the toolbars inside it. */
export interface PreviewFrame {
  /** Shows a toolbar's facts in the footer; what it returns takes them away. */
  details(id: string, values: readonly string[]): () => void;
  commands?: PreviewCommandList;
}
const noFrame: PreviewFrame = { details: () => () => {} };
export const PreviewFrameContext = createContext<PreviewFrame>(noFrame);

type ToolProps = Record<string, unknown> & { children?: ReactNode; className?: string };
type Tool = ReactElement<ToolProps>;

/** Labelled actions that can show as their icon alone, by their header item. */
const actionIcons: Record<string, IconName> = {
  optimize: 'sliders',
  'image-tools': 'image',
  'pdf-tools': 'pdf',
  'edit-media': 'video',
  wireframe: 'wireframe',
  edit: 'pencil',
};
/** Header items that act as one control, which give way together. */
const together: readonly (readonly string[])[] = [
  ['zoom-out', 'zoom', 'zoom-in'],
  ['smaller', 'size', 'larger'],
  ['rotate-left', 'rotate-right'],
];

const itemOf = (tool: Tool) => String(tool.props['data-header-item'] ?? '');
const commandsOf = (tool: Tool) => String(tool.props['data-header-commands'] ?? '');
const rankOf = (tool: Tool) => Number(tool.props['data-header-rank'] ?? 9);
/** A read-only fact: a detail, other than a zoom level, which belongs beside its zoom. */
const isFact = (tool: Tool) =>
  tool.props['data-header-detail'] !== undefined && itemOf(tool) !== 'zoom';

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : '';
    })
    .join('');
}

/** The toolbar's elements, out of their fragments, each keyed where it stood. */
function tools(children: ReactNode, prefix = ''): Tool[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<ToolProps>(child)) return [];
    const key = `${prefix}${child.key}`;
    return child.type === Fragment
      ? tools(child.props.children, `${key}/`)
      : [cloneElement(child, { key })];
  });
}

/**
 * One control as a toolbar item. Where the toolbar stands by itself, a plain action with no item
 * of its own still gives way, into its own "…", which presses it; a plane's header keeps such a
 * control, which has no command there. A labelled action learns its icon.
 */
function single(tool: Tool, inline: boolean): Tool {
  if (inline && !itemOf(tool) && typeof tool.props.onClick === 'function')
    tool = cloneElement(tool, headerItem(`tool:${tool.key}`, 6, [`toolbar:${tool.key}`]));
  const icon = actionIcons[itemOf(tool)];
  if (tool.type !== 'button' || !icon || typeof tool.props.children !== 'string') return tool;
  const label = String(tool.props['aria-label'] ?? tool.props.children);
  return cloneElement(tool, {
    'data-header-collapse': '',
    'aria-label': label,
    title: tool.props.title ?? label,
    className: [tool.props.className, 'preview-toolbar-action'].filter(Boolean).join(' '),
    children: (
      <>
        <Icon name={icon} />
        <span className="preview-toolbar-label">{tool.props.children}</span>
      </>
    ),
  });
}

/** Controls that act as one, as one item: it stays as long as the most important of them. */
function group(members: readonly Tool[]): Tool {
  const commands = [...new Set(members.flatMap((tool) => commandsOf(tool).split(' ')))].filter(
    Boolean,
  );
  const rank = Math.min(...members.map(rankOf)) as HeaderRank;
  return (
    <span
      key={`group:${members[0]!.key}`}
      className="preview-toolbar-group"
      {...headerItem(`group:${itemOf(members[0]!)}`, rank, commands)}
    >
      {members.map((tool) =>
        cloneElement(tool, {
          key: tool.key,
          'data-header-item': undefined,
          'data-header-rank': undefined,
          'data-header-commands': undefined,
          'data-header-detail': undefined,
          // what "…" presses for each of the group's commands
          'data-preview-commands': commandsOf(tool) || undefined,
        }),
      )}
    </span>
  );
}

/** The toolbar's items: singles, and runs of controls that act as one. */
function arrange(items: readonly Tool[], inline: boolean): Tool[] {
  const arranged: Tool[] = [];
  for (let index = 0; index < items.length;) {
    const first = items[index]!;
    const sequence = together.find((ids) => ids.includes(itemOf(first)));
    const commands = commandsOf(first);
    let end = index + 1;
    while (
      end < items.length &&
      (sequence
        ? sequence.includes(itemOf(items[end]!))
        : !!commands && commandsOf(items[end]!) === commands)
    )
      end++;
    arranged.push(end - index > 1 ? group(items.slice(index, end)) : single(first, inline));
    index = end;
  }
  return arranged;
}

/** The control that stands for a command: a group's own member, or the item itself. */
function controlFor(toolbar: HTMLElement, id: string): HTMLButtonElement | undefined {
  const holds = (value: string | undefined) => !!value?.split(' ').includes(id);
  const owner =
    [...toolbar.querySelectorAll<HTMLElement>('[data-preview-commands]')].find((element) =>
      holds(element.dataset.previewCommands),
    ) ??
    [...toolbar.querySelectorAll<HTMLElement>('[data-header-commands]')].find((element) =>
      holds(element.dataset.headerCommands),
    );
  if (!owner) return undefined;
  return owner instanceof HTMLButtonElement
    ? owner
    : (owner.querySelector<HTMLButtonElement>('button') ?? undefined);
}

/** What gave way, as choices: the module's own commands, else a press of the control for each. */
function overflowChoices(
  toolbar: HTMLElement,
  lead: HeaderLead,
  registered: readonly PreviewCommand[],
): { choices: Choice[]; run(id: string): void } {
  const runs = new Map<string, () => void>();
  const choices = [...new Set(lead.flat())].flatMap((id): Choice[] => {
    const definition = registered.find((command) => `preview.${command.id}` === id);
    const control = controlFor(toolbar, id);
    // a control that opens a menu of its own cannot open it from a hidden place
    const pressable = control && !control.disabled && !control.hasAttribute('aria-haspopup');
    if (definition ? definition.available === false : !pressable) return [];
    runs.set(id, () => {
      if (definition)
        void Promise.resolve()
          .then(() => definition.run())
          .catch(report);
      else control?.click();
    });
    const label =
      definition?.label ??
      control?.getAttribute('aria-label') ??
      control?.textContent?.trim() ??
      id;
    return [{ value: id, label, aliases: definition?.aliases }];
  });
  return { choices, run: (id) => runs.get(id)?.() };
}

/** The toolbar's "…": the shared button menu, so it opens and closes as every other one does. */
function PreviewOverflow({
  anchor,
  toolbar,
  lead,
  registered,
  close,
}: {
  anchor: HTMLElement;
  toolbar: HTMLElement;
  lead: HeaderLead;
  registered: readonly PreviewCommand[];
  close(): void;
}) {
  const { choices, run } = overflowChoices(toolbar, lead, registered);
  return (
    <ChoiceMenu
      label="More preview actions"
      choices={choices}
      value=""
      anchor={anchor}
      container={layerContainer(anchor)}
      onClose={close}
      // after the menu has closed and given focus back, so a dialog an action opens keeps it
      onChoose={(id) => requestAnimationFrame(() => run(id))}
    />
  );
}

const slots = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
const noCommands: readonly PreviewCommand[] = [];
const unsubscribed = () => () => {};
const none = () => noCommands;

export function setPreviewControlsSlot(id: string, element: HTMLElement | null): void {
  if (element) slots.set(id, element);
  else slots.delete(id);
  for (const listener of listeners) listener();
}
export function usePreviewControlsSlot(id?: string): HTMLElement | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (id ? slots.get(id) : undefined),
  );
}

export function PreviewToolbar({
  context,
  children,
}: {
  context: PreviewContext;
  children: ReactNode;
}) {
  const header = context.commands?.header;
  // in a plane's header, the header measures it and its "…" holds what gives way
  const inline = !header;
  const toolbar = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const frame = useContext(PreviewFrameContext);
  const factsID = useId();
  const items = tools(children);
  const facts = JSON.stringify(
    items
      .filter(isFact)
      .map((tool) => textOf(tool.props.children).trim())
      .filter(Boolean),
  );
  const { details } = frame;
  useEffect(() => details(factsID, JSON.parse(facts) as string[]), [details, factsID, facts]);
  const lead = useHeaderOverflow(toolbar, inline);
  const registered = useSyncExternalStore(
    frame.commands?.subscribe ?? unsubscribed,
    frame.commands?.snapshot ?? none,
  );
  const spilled = inline && lead.length > 0;
  // nothing gave way: a menu left open would come back by itself the next time something does
  useEffect(() => {
    if (!spilled) setOpen(false);
  }, [spilled]);
  const content = (
    <div className="preview-toolbar" ref={toolbar}>
      {arrange(
        items.filter((tool) => !isFact(tool)),
        inline,
      )}
      {spilled && (
        <button
          ref={menu}
          type="button"
          className="icon-button"
          {...spillMenu}
          title="More preview actions"
          aria-label="More preview actions"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="more" />
        </button>
      )}
      {spilled && open && menu.current && toolbar.current && (
        <PreviewOverflow
          anchor={menu.current}
          toolbar={toolbar.current}
          lead={lead}
          registered={registered}
          close={() => setOpen(false)}
        />
      )}
    </div>
  );
  return header ? createPortal(content, header) : content;
}

/**
 * Registers a preview's commands: with its plane, where it has one, and with its host, whose
 * toolbar names and runs them from its own "…".
 */
export function usePreviewCommands(
  context: PreviewContext,
  commands: readonly PreviewCommand[],
): void {
  const list = useContext(PreviewFrameContext).commands;
  useEffect(() => context.commands?.register(commands), [context.commands, commands]);
  useEffect(() => list?.add(commands), [list, commands]);
}
