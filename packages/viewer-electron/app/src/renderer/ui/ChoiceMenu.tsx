import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ResolvedCommand } from '../commands/registry';
import type { IconName } from './Icon';
import { ContextMenuResults } from './ContextMenuResults';
import { Icon } from './Icon';
import { layerContainer, useAnchoredLayer } from './Popover';

export interface Choice {
  value: string;
  label: string;
  detail?: string;
  /** Other words the search finds it by: an extension, an abbreviation. */
  aliases?: readonly string[];
}

/** A label as it reads inside a sentence: “Speech language” becomes “speech language”; “PDF zoom” stays. */
const inSentence = (label: string) =>
  /^\p{Lu}\p{Lu}/u.test(label) ? label : label.charAt(0).toLocaleLowerCase() + label.slice(1);

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
        searchable={choices.length > 8}
        searchLabel={inSentence(label)}
        listLabel={label}
        empty="No matching choices"
        none="No choices"
        currentID={'choice:' + value}
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
        <span id={`${id}-value`} className={current ? undefined : 'choice-placeholder'}>
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
