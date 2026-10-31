import { useId } from 'react';
import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from './Icon';
import { IconButton } from './primitives';
import './panel.css';

/**
 * A PANEL beside the work: a title bar, a body that scrolls and an optional footer (panel.css).
 * It never places itself and never uses a fixed position: what holds it does, such as the
 * space's overlay grid or a plane, so it also works inside a transformed plane. Give it a width.
 *
 * With `onCollapsedChange`, its title collapses it to the title bar and `status`, and the panel
 * carries `data-collapsed`. Its parts carry `panel-*` classes and, with a `className`, that name
 * too: `check-panel` gives `check-panel-toggle`, `check-panel-title`, `check-panel-status` and
 * `check-panel-body`.
 */
export function Panel({
  label,
  title,
  status,
  collapsed = false,
  onCollapsedChange,
  actions,
  onClose,
  closeLabel = 'Close',
  footer,
  className = '',
  children,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  ref?: Ref<HTMLElement>;
  /** What the panel is called aloud. */
  label: string;
  title: ReactNode;
  /** A short state after the title: while collapsed, or always when it cannot collapse. */
  status?: ReactNode;
  collapsed?: boolean;
  onCollapsedChange?(collapsed: boolean): void;
  /** Controls in the title bar, before Close. */
  actions?: ReactNode;
  onClose?(): void;
  closeLabel?: string;
  footer?: ReactNode;
}) {
  const body = useId();
  const name = className.split(' ')[0];
  const part = (piece: string) => `panel-${piece}${name ? ` ${name}-${piece}` : ''}`;
  const shownStatus = (collapsed || !onCollapsedChange) && status !== undefined && (
    <span className={part('status')}>
      {' · '}
      {status}
    </span>
  );
  const heading = (
    <>
      <span className={part('title')}>{title}</span>
      {shownStatus}
    </>
  );
  return (
    <aside
      className={`panel ${className}`.trim()}
      aria-label={label}
      data-collapsed={collapsed || undefined}
      {...props}
    >
      <header className="panel-header">
        <h2 className="panel-heading">
          {onCollapsedChange ? (
            <button
              type="button"
              className={part('toggle')}
              aria-expanded={!collapsed}
              aria-controls={body}
              title={collapsed ? 'Show the whole panel' : 'Show only the title'}
              onClick={() => onCollapsedChange(!collapsed)}
            >
              <Icon name={collapsed ? 'right' : 'down'} size={12} />
              {heading}
            </button>
          ) : (
            heading
          )}
        </h2>
        {actions && <div className="panel-actions">{actions}</div>}
        {onClose && <IconButton icon="close" label={closeLabel} onClick={onClose} />}
      </header>
      <div id={body} className={part('body')} hidden={collapsed}>
        {children}
      </div>
      {footer && !collapsed && <footer className={part('footer')}>{footer}</footer>}
    </aside>
  );
}

/**
 * A part of a panel's body, with a heading and a short `meta` beside it. `label` names it aloud
 * when it differs from the heading, or when it has none.
 */
export function PanelSection({
  title,
  label,
  meta,
  className = '',
  children,
}: {
  title?: ReactNode;
  label?: string;
  meta?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`panel-section ${className}`.trim()}
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
    >
      {title !== undefined && (
        <div className="panel-section-heading">
          <h3>{title}</h3>
          {meta !== undefined && <span className="panel-section-meta">{meta}</span>}
        </div>
      )}
      {children}
    </section>
  );
}
