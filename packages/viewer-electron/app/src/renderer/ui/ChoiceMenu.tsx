import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ResolvedCommand } from '../commands/registry';
import type { IconName } from './Icon';
import { ContextMenuResults } from './ContextMenuResults';
import { Icon } from './Icon';
import { layerContainer, useAnchoredLayer } from './Popover';
import { watchFit } from './text-fit';

export interface Choice {
  value: string;
  label: string;
  detail?: string;
  /** Other words the search finds it by: an extension, an abbreviation. */
  aliases?: readonly string[];
}

/**
 * Choices share the context menu's list, the current value checked and active. Up to eight are
 * just the list, with type-ahead, as a native menu; more get a search field. Its end lines up
 * with the button's, below or above it, never over it, so a second press reaches the button.
 * Inside a modal dialog it opens in that dialog's top layer. Nothing here reaches the command
 * catalog or agents.
 */
export function ChoiceMenu({
  label,
  choices,
  value,
  anchor,
  container,
  onChoose,
  onClose,
}: {
  label: string;
  choices: readonly Choice[];
  value: string;
  /** The button it opens from: the menu's end lines up with the button's. */
  anchor: HTMLElement;
  /** Where it renders: the open dialog the button is in, or the page. */
  container: HTMLElement;
  onChoose(value: string): void;
  onClose(): void;
}) {
  // beside the button, under it or above it but never over it, its end lined up with the button's
  const layer = useAnchoredLayer({
    anchor,
    align: 'end',
    select: (root) => root.querySelector<HTMLElement>('.context-menu'),
    onClose,
  });
  const commands: ResolvedCommand[] = choices.map((choice) => ({
    id: 'choice:' + choice.value,
    label: choice.label,
    detail: choice.detail,
    // no group: the button already names the choice, a heading would repeat it
    group: '',
    icon: choice.value === value ? 'check' : undefined,
    aliases: [choice.value, ...(choice.aliases ?? [])],
    primary: false,
    source: 'choice',
    context: { scope: 'window', workspaceID: '', selection: [], jobs: [], clipboard: null },
  }));
  return createPortal(
    <div
      ref={layer.ref}
      className="context-menu-layer choice-menu"
      role="dialog"
      aria-label={label}
      data-plurid-overlay="context-menu"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        layer.onKeyDown(event);
        event.stopPropagation();
        if (event.key === 'Tab') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <ContextMenuResults
        commands={commands}
        recent={[]}
        focused
        blankIcons
        choiceList
        // a label lowered to read in a sentence mangles names (“python version”): the field says
        // only “Search”, and its accessible name gives the label as written
        searchLabel={label}
        listLabel={label}
        empty="No matching choices"
        none="No choices"
        // a list of actions, which has no current one, keeps plain menu items, not radio items
        currentID={choices.some((choice) => choice.value === value) ? 'choice:' + value : undefined}
        onClose={onClose}
        onSelect={(command) => {
          onClose();
          onChoose(command.id.slice('choice:'.length));
        }}
      />
    </div>,
    container,
  );
}

/** A button naming the current choice: a press opens its menu, the next press closes it. */
export function ChoiceButton({
  label,
  value,
  choices,
  onChoose,
  placeholder,
  disabled,
  className,
  icon,
}: {
  label: string;
  value: string;
  choices: readonly Choice[];
  onChoose(value: string): void;
  /** Shown while the value is none of the choices: “Choose an action”. */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  icon?: IconName;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = choices.find((choice) => choice.value === value);
  const shown = current?.label ?? placeholder ?? value;
  const cut = useCut(shown);
  const show = () => setOpen(true);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={'choice-button' + (className ? ' ' + className : '')}
        // Named by its label, then the choice it shows, “Image output format WebP”, so a voice
        // command can say the words it shows: naming itself first reads its `aria-label`.
        id={id}
        aria-labelledby={`${id} ${id}-value`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          // inside a settings row's label, a click would also reach the row
          event.preventDefault();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          // as a native dropdown opens on the arrow keys
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          }
        }}
      >
        {icon && <Icon name={icon} size={15} />}
        <span
          ref={cut.ref}
          id={`${id}-value`}
          className={current ? undefined : 'choice-placeholder'}
          // a value its button cuts short shows whole under the pointer
          title={cut.cut ? shown : undefined}
        >
          {shown}
        </span>
        <Icon name="down" size={10} />
      </button>
      {open && button.current && (
        <ChoiceMenu
          label={label}
          choices={choices}
          value={value}
          anchor={button.current}
          container={layerContainer(button.current)}
          onChoose={onChoose}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Whether `text` in the element is cut short by its box, kept true as the box resizes. */
function useCut(text: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const check = () => setCut(element.scrollWidth > element.clientWidth + 1);
    check();
    return watchFit(element, check);
  }, [text]);
  return { ref, cut };
}

/**
 * A MENU BUTTON: a fixed label that opens a menu of actions, such as an Office preview's More or a
 * tree's Tools. Unlike a ChoiceButton it shows no current value and checks no row; choosing a row
 * runs it.
 */
export function MenuButton({
  label,
  items,
  onChoose,
  disabled,
  className,
  icon,
}: {
  label: string;
  items: readonly Choice[];
  onChoose(value: string): void;
  disabled?: boolean;
  className?: string;
  icon?: IconName;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={'choice-button menu-button' + (className ? ' ' + className : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || !items.length}
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon && <Icon name={icon} size={15} />}
        <span>{label}</span>
        <Icon name="down" size={10} />
      </button>
      {open && button.current && (
        <ChoiceMenu
          label={label}
          choices={items}
          // no row is current: the rows are actions
          value=""
          anchor={button.current}
          container={layerContainer(button.current)}
          onChoose={onChoose}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * A SEGMENTED CONTROL for two to four choices that all fit, such as a sort's Name or Date: each
 * shows, the current one pressed, as a Mac's. ← → move between them.
 */
export function SegmentedControl({
  label,
  value,
  choices,
  onChoose,
  className,
}: {
  label: string;
  value: string;
  choices: readonly Choice[];
  onChoose(value: string): void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={'segmented-control' + (className ? ' ' + className : '')}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const index = choices.findIndex((choice) => choice.value === value);
        const next =
          choices[
            (index + (event.key === 'ArrowRight' ? 1 : -1) + choices.length) % choices.length
          ];
        if (next) onChoose(next.value);
      }}
    >
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={choice.value === value}
          tabIndex={choice.value === value ? 0 : -1}
          onClick={() => onChoose(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
