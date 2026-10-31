import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ResolvedCommand } from '../commands/registry';
import { ContextMenuResults } from './ContextMenuResults';
import { Icon, type IconName } from './Icon';
import { layerContainer, useAnchoredLayer } from './Popover';

export interface Choice {
  value: string;
  label: string;
  detail?: string;
  /** Other words the search finds it by: an extension, an abbreviation. */
  aliases?: readonly string[];
}

/**
 * Choices use the searchable menu: the context menu's keyboard-first search over a
 * list of values, the current one checked, in place of a native dropdown. Its end lines up with
 * the button's, it shows about five rows and scrolls the rest, and inside a modal dialog it opens
 * in that dialog's top layer. Not a command: nothing here reaches the command catalog or agents.
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
  // under the button, its end lined up with the button's, or above it when the window ends first
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
    // no group: the search field already names the choice, a heading would repeat it
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
        if (event.key === 'Tab') onClose();
      }}
    >
      <ContextMenuResults
        commands={commands}
        recent={[]}
        focused
        blankIcons
        searchLabel={label}
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

/** A button naming the current choice, which opens its searchable menu below it. */
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
  const current = choices.find((choice) => choice.value === value);
  const show = () => setOpen(true);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={'choice-button' + (className ? ' ' + className : '')}
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
        <span className={current ? undefined : 'choice-placeholder'}>
          {current?.label ?? placeholder ?? value}
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
