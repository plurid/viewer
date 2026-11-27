import {
  Children,
  Component,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type KeyboardEventHandler,
} from 'react';
import type { HTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import { PathLabel, usePathCopy } from './PathLabel';
import { FileName } from './FileName';
import type { PathLabelLayout } from './PathLabel';
import { errorMessage } from '../../domain/errors';
import { knownPreviewProblem } from '../../domain/previews/reader-problem';
import { diagnosticFailure } from '../../domain/diagnostics/failure';
import { boundedDiagnosticInput } from '../../domain/diagnostics/license-key';
import { getState, report } from '../state/core';
import { copyPaths, copyText } from '../state/ui';

export function IconButton({
  icon,
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}
/**
 * The button kinds (DESIGN.md): primary for the one main action of a context, secondary for a
 * visible text button, quiet for a ghost that shows only under the pointer, danger for an action
 * that removes or discards. A bare `<button>` is quiet, so IconButton needs no kind.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
/** Primary and danger keep the classes the stylesheets already style and exclude. */
const buttonClasses: Record<ButtonVariant, string> = {
  primary: 'primary',
  secondary: 'button-secondary',
  quiet: 'button-quiet',
  danger: 'danger',
};
export function Button({
  variant,
  icon,
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant: ButtonVariant; icon?: IconName }) {
  const classes = [buttonClasses[variant], icon && 'button-icon', className].filter(Boolean);
  return (
    <button type={type} className={classes.join(' ')} {...props}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
}
/** A row as a label, so a click on its text reaches its one control; a div for several. */
export type RowElement = 'label' | 'div';
/**
 * A setting-like row (base.css `.row`): a sentence label, an optional muted detail line, and the
 * control at the shared 180 px edge, stacked under the label in a narrow container.
 */
export function Row({
  label,
  detail,
  control,
  as: Element = 'label',
  compact = false,
  className = '',
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  label: ReactNode;
  detail?: ReactNode;
  control: ReactNode;
  as?: RowElement;
  compact?: boolean;
}) {
  const classes = ['row', compact && 'row-compact', className].filter(Boolean);
  return (
    <Element className={classes.join(' ')} {...props}>
      <span>
        {label}
        {detail && <small>{detail}</small>}
      </span>
      {control}
    </Element>
  );
}
export function Empty({
  icon = 'folder',
  title,
  detail,
  children,
}: {
  icon?: IconName;
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={42} />
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {children}
    </div>
  );
}
/** The one retry label, as macOS words it, wherever failed work can run again. */
export const tryAgainLabel = 'Try Again';
/**
 * Work that failed, in place of its content: what failed as the title, why and what to do next as
 * the detail, and the actions that recover it in one row, Try Again last.
 */
export function Failure({
  icon = 'warning',
  title,
  detail,
  onRetry,
  children,
}: {
  icon?: IconName;
  title: string;
  detail?: string;
  onRetry?(): void;
  children?: ReactNode;
}) {
  return (
    <Empty icon={icon} title={title} detail={detail}>
      {(Children.toArray(children).length > 0 || onRetry) && (
        <div className="empty-actions">
          {children}
          {onRetry && (
            <button type="button" onClick={onRetry}>
              {tryAgainLabel}
            </button>
          )}
        </div>
      )}
    </Empty>
  );
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label}
    </div>
  );
}
/**
 * A dialog's title, its quoted file name losing its middle as a file name does, so the title
 * keeps one line and the close button stays inside the dialog.
 */
function DialogTitle({ title }: { title: string }) {
  const quoted = /^(.*?)“([^”]+)”(.*)$/s.exec(title);
  if (!quoted) return <strong title={title}>{title}</strong>;
  const [, before, name, after] = quoted;
  return (
    <strong className="dialog-title-quoted" title={title}>
      {before && <span className="dialog-title-text">{before}</span>}
      <span className="dialog-title-text">“</span>
      <FileName name={name!} className="dialog-title-name" />
      <span className="dialog-title-text">”{after}</span>
    </strong>
  );
}
/** The control a dialog opens on when none asks for it: its default action, else the one that
 * keeps things as they are, never the close button in its title. */
function initialFocus(dialog: HTMLDialogElement): HTMLElement | null {
  const asked = dialog.querySelector<HTMLElement>('[data-autofocus]');
  if (asked) return asked;
  const actions = [...dialog.querySelectorAll<HTMLButtonElement>('footer button:not(:disabled)')];
  return (
    actions.find((button) => button.classList.contains('primary')) ??
    actions.find((button) => !button.classList.contains('danger')) ??
    actions[0] ??
    null
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  className = '',
  onKeyDown,
  closeOnBackdrop = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDialogElement>;
  /** A press on the dimmed space around closes it: for read-only information, never a form a
   * stray click would lose, as macOS sheets never close that way. */
  closeOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // where the press began: a drag that selects text and ends outside the dialog is not a press
  // outside it
  const pressedOutside = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    if (dialog) (initialFocus(dialog) ?? dialog).focus({ preventScroll: true });
    return () => {
      dialog?.close();
      queueMicrotask(() => {
        const top = [...document.querySelectorAll('dialog[open]')].at(-1);
        if (
          opener instanceof HTMLElement &&
          opener.isConnected &&
          !opener.matches(':disabled') &&
          !opener.closest('[hidden], [inert]') &&
          (!top || top.contains(opener))
        )
          opener.focus({ preventScroll: true });
      });
    };
  }, []);
  const outside = (event: MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    );
  };
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={`dialog ${wide ? 'wide-dialog' : ''} ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        pressedOutside.current = outside(event);
      }}
      onClick={(event) => {
        if (closeOnBackdrop && pressedOutside.current && outside(event)) onClose();
        pressedOutside.current = false;
      }}
      aria-label={title}
      data-plurid-overlay="dialog"
      onKeyDown={onKeyDown}
    >
      <header>
        <DialogTitle title={title} />
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>
      {children}
    </dialog>
  );
}
/** What a name field selects as it opens. */
export type NameSelection = 'all' | 'stem' | 'end';
export function NameDialog({
  title,
  initial = '',
  action,
  onSubmit,
  onClose,
  label = 'Name',
  maxLength = 255,
  secondaryAction,
  selection = 'all',
}: {
  title: string;
  initial?: string;
  action: string;
  onSubmit: (name: string) => Promise<void> | void;
  onClose: () => void;
  label?: string;
  maxLength?: number;
  secondaryAction?: (busy: boolean) => ReactNode;
  /** What the field selects as it opens: all of it, a file name's stem as Finder's Rename does,
   * or nothing with the caret at the end, as after a typed prefix such as `smb://`. */
  selection?: NameSelection;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // React autofocus runs before showModal(); focus after the dialog enters the top layer.
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <Dialog title={title} onClose={onClose} className="name-dialog">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await onSubmit(name);
            onClose();
          } catch (error) {
            setError(errorMessage(error));
            setBusy(false);
          }
        }}
      >
        <label className="field-label">
          {label}
          <input
            ref={input}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => {
              const stem = selection === 'stem' ? initial.lastIndexOf('.') : -1;
              if (selection === 'end')
                event.target.setSelectionRange(initial.length, initial.length);
              else event.target.setSelectionRange(0, stem > 0 ? stem : initial.length);
            }}
            required
            maxLength={maxLength}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer>
          {secondaryAction && (
            <div className="dialog-secondary-action">{secondaryAction(busy)}</div>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            {action}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
export class ErrorBoundary extends Component<{ children: ReactNode }, { detail: string | null }> {
  state = { detail: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { detail: knownPreviewProblem(error) ?? '' };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    const failure = diagnosticFailure(error);
    failure.detail = boundedDiagnosticInput(`${failure.detail}\n${info.componentStack ?? ''}`);
    void window.viewer?.diagnosticReport?.(failure).catch(() => {});
  }
  render() {
    return this.state.detail !== null ? (
      <Failure
        title="This view couldn't load"
        detail={this.state.detail}
        onRetry={() => this.setState({ detail: null })}
      />
    ) : (
      this.props.children
    );
  }
}
/** What a copy writes: paths, one per line, or text. */
export type CopyValue = { paths: readonly string[] } | { text: string };
/** An icon beside the value it copies, or a text button such as Copy output. */
export type CopyAppearance = 'icon' | 'text';
type CopyResult = { status: 'copied' } | { status: 'failed'; reason: string };
/** How long a copy button says Copied, or Not copied, before it returns. */
export const copyFeedbackDuration = 1500;
/** A workspace window shows the failure in its notice; Settings has none, and the button says it. */
function reportCopyFailure(error: unknown): void {
  if (getState()) report(error);
}
/**
 * Copies paths and text through the desktop pasteboard, then says Copied
 * for a moment, announced politely. A failure says Not copied, with its reason, and is reported.
 */
export function CopyButton({
  copy,
  label,
  appearance = 'icon',
  disabled,
  className = '',
  describedBy,
  onError = reportCopyFailure,
}: {
  copy: CopyValue;
  label: string;
  appearance?: CopyAppearance;
  disabled?: boolean;
  className?: string;
  describedBy?: string;
  onError?(error: unknown): void;
}) {
  const [result, setResult] = useState<CopyResult>();
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = async () => {
    window.clearTimeout(timer.current);
    try {
      await ('paths' in copy ? copyPaths(copy.paths) : copyText(copy.text));
      setResult({ status: 'copied' });
    } catch (error) {
      setResult({ status: 'failed', reason: errorMessage(error) });
      onError(error);
    }
    timer.current = window.setTimeout(() => setResult(undefined), copyFeedbackDuration);
  };
  const copied = result?.status === 'copied';
  const shown = !result ? label : copied ? 'Copied' : 'Not copied';
  const said = !result || copied ? shown : `Not copied. ${result.reason}`;
  const icon = appearance === 'icon';
  return (
    <>
      <button
        type="button"
        className={`copy-button ${icon ? 'icon-button' : ''} ${className}`}
        data-copied={result?.status}
        aria-label={icon ? label : undefined}
        aria-describedby={describedBy}
        title={icon ? said : undefined}
        disabled={disabled}
        onClick={() => void run()}
      >
        {icon ? <Icon name={!result ? 'copy' : copied ? 'check' : 'warning'} /> : shown}
      </button>
      {/* a live region without the status role: a dialog's own status stays the one it has */}
      <span className="visually-hidden" aria-live="polite">
        {result ? said : ''}
      </span>
    </>
  );
}
/**
 * A path wraps under a long name, or keeps to one line shortened from its start, showing all of
 * it on hover.
 */
export type PathLayout = PathLabelLayout;
/**
 * A read-only path (DESIGN.md: paths are selectable). One click selects all of it, ready for ⌘C,
 * which copies the whole path, and its button copies it as text. It shows as a path label: home
 * as `~`, its own name kept.
 */
export function PathField({
  path,
  layout = 'wrap',
  label = 'Copy path',
  className = '',
  onError,
}: {
  path: string;
  layout?: PathLayout;
  label?: string;
  className?: string;
  onError?(error: unknown): void;
}) {
  const id = useId();
  const copy = usePathCopy(path);
  return (
    <span className={`path-field ${className}`} data-layout={layout}>
      <PathLabel id={id} className="path-text" path={path} layout={layout} onClick={selectWhole} />
      <CopyButton copy={copy} label={label} describedBy={id} onError={onError} />
    </span>
  );
}
/** `user-select: all` keeps a path whole when dragged; a click selects it whole too. */
function selectWhole(event: MouseEvent<HTMLElement>) {
  window.getSelection()?.selectAllChildren(event.currentTarget);
}
