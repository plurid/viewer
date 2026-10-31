import { useEffect, useRef, useState } from 'react';
import type { DetailsHTMLAttributes, ReactNode, SyntheticEvent } from 'react';
import './disclosure.css';

/**
 * How a disclosure sits: a settings row with its detail at the end, a secondary part of a form or
 * dialog, or a few words inside a status line.
 */
export type DisclosureVariant = 'row' | 'compact' | 'inline';

/**
 * A DISCLOSURE: a native `<details>` with the one summary look (base.css), keeping the caller's
 * class. It is uncontrolled with `defaultOpen`, or controlled with `open` and `onOpenChange`.
 *
 * - `meta`: a short muted detail after the summary, such as a count; the summary holds only
 *   `summary` and `meta`, so its text is what the caller passes.
 * - `group`: the `name` that makes disclosures exclusive, opening one closing the others.
 * - `closeOnEscape`: Escape closes it first, before the dialog around it, or within it outside a
 *   dialog, unless something inside already took the key.
 */
export function Disclosure({
  summary,
  meta,
  open,
  defaultOpen = false,
  onOpenChange,
  group,
  closeOnEscape = false,
  variant,
  className = '',
  summaryClassName,
  children,
  ...props
}: Omit<DetailsHTMLAttributes<HTMLElement>, 'open' | 'name' | 'onToggle'> & {
  summary: ReactNode;
  meta?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?(open: boolean): void;
  group?: string;
  closeOnEscape?: boolean;
  variant: DisclosureVariant;
  summaryClassName?: string;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [initiallyOpen] = useState(defaultOpen);
  useEffect(() => {
    const element = details.current;
    if (!closeOnEscape || !element) return;
    const page = element.ownerDocument;
    // On the document, the key arrives after the page's own handlers, which can claim it first;
    // preventing it here keeps the dialog from closing with it.
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !element.open) return;
      const scope = element.closest('dialog') ?? element;
      if (!(event.target instanceof Node) || !scope.contains(event.target)) return;
      event.preventDefault();
      // focus inside would be left on hidden content: the summary keeps the keyboard's place
      const inside = element.contains(page.activeElement);
      element.open = false;
      if (inside) element.querySelector<HTMLElement>(':scope > summary')?.focus();
    };
    page.addEventListener('keydown', close);
    return () => page.removeEventListener('keydown', close);
  }, [closeOnEscape]);
  const toggled = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const element = event.currentTarget;
    if (element.open && group) closeGroup(element, group);
    onOpenChange?.(element.open);
  };
  return (
    <details
      {...props}
      ref={details}
      className={`disclosure disclosure-${variant} ${className}`}
      name={group}
      open={open ?? initiallyOpen}
      onToggle={toggled}
    >
      <summary className={summaryClassName}>
        {summary}
        {(meta || meta === 0) && <span className="disclosure-meta">{meta}</span>}
      </summary>
      {children}
    </details>
  );
}

/**
 * Chromium closes the rest of a `name` group itself; this keeps a group exclusive in an engine
 * that does not, such as jsdom.
 */
function closeGroup(opened: HTMLDetailsElement, group: string) {
  for (const other of opened.ownerDocument.querySelectorAll<HTMLDetailsElement>('details[name]'))
    if (other !== opened && other.open && other.getAttribute('name') === group) other.open = false;
}
