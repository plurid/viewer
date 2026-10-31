import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useCommands, useCommandRevision } from '../commands/context';
import { ContextMenuResults } from './ContextMenuResults';
import { type CommandRequest, type ResolvedCommand } from '../commands/registry';
import { report, useViewer } from '../state/store';
import { layerContainer, useAnchoredLayer } from './Popover';
import { suggestionsFor } from '../commands/suggestions';
import { toolFiles } from '../commands/target';
import type { HeaderLead } from '../workspace/header-overflow';

/** Outside transformed planes, with a fixed target and keyboard-first search. */
export function ContextMenu({
  position,
  request,
  onClose,
  label = 'Actions',
  anchor,
  lead,
}: {
  position: { x: number; y: number };
  request: CommandRequest;
  onClose(): void;
  label?: string;
  anchor?: HTMLElement;
  /** The commands of what the plane header could not show: first, in the header's order. */
  lead?: HeaderLead;
}) {
  const registry = useCommands();
  useCommandRevision();
  const recent = useViewer((state) => state.saved.ui.recentCommands);
  // at the pointer, inside the window and at most 540 px tall; focus goes back to what had it
  const menu = useAnchoredLayer({
    anchor,
    point: position,
    fit: 540,
    select: (root) => root.querySelector<HTMLElement>('.context-menu'),
    onClose,
  });
  const [container] = useState(() => layerContainer(anchor ?? document.activeElement));
  const select = (command: ResolvedCommand) => {
    onClose();
    // Commit closure/focus restoration before a handler opens a protected dialog.
    requestAnimationFrame(() => {
      void registry.run(command).catch(report);
    });
  };
  const available = registry.list(request);
  // a view or column picker is already scoped; a file menu offers what fits its selection, and a
  // preview's what fits its file
  const suggested = request.ids
    ? []
    : suggestionsFor(
        available,
        toolFiles({
          selection: request.context?.selection ?? [],
          subject: request.context?.subject,
        }),
      );
  return createPortal(
    <div
      className="context-menu-layer"
      ref={menu.ref}
      style={
        { '--menu-left': `${position.x}px`, '--menu-top': `${position.y}px` } as React.CSSProperties
      }
      role="dialog"
      aria-label={label}
      data-plurid-overlay="context-menu"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        menu.onKeyDown(event);
        if (event.key === 'Tab') onClose();
      }}
    >
      <ContextMenuResults
        commands={available}
        onSelect={select}
        onClose={onClose}
        recent={recent}
        focused={!!request.ids}
        suggested={suggested}
        lead={lead}
      />
    </div>,
    container,
  );
}
