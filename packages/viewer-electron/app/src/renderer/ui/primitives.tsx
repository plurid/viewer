import {
  Component,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type KeyboardEventHandler,
} from 'react';
import { Icon, type IconName } from './Icon';
import { errorMessage } from '../../domain/errors';

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
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label}
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  className = '',
  onKeyDown,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDialogElement>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'wide-dialog' : ''} ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom)
        )
          onClose();
      }}
      aria-label={title}
      onKeyDown={onKeyDown}
    >
      <header>
        <strong>{title}</strong>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>
      {children}
    </dialog>
  );
}
export function NameDialog({
  title,
  initial = '',
  action,
  onSubmit,
  onClose,
  label = 'Name',
  maxLength = 255,
  secondaryAction,
}: {
  title: string;
  initial?: string;
  action: string;
  onSubmit: (name: string) => Promise<void> | void;
  onClose: () => void;
  label?: string;
  maxLength?: number;
  secondaryAction?: (busy: boolean) => ReactNode;
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
              const end = label === 'Name' ? initial.lastIndexOf('.') : -1;
              event.target.setSelectionRange(0, end > 0 ? end : initial.length);
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
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    const detail = `${error.stack ?? error.message}\n${info.componentStack ?? ''}`.slice(0, 8000);
    void window.viewer?.diagnosticReport?.(detail).catch(() => {});
  }
  render() {
    return this.state.error ? (
      <Empty icon="warning" title="This view could not load" detail={this.state.error}>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </Empty>
    ) : (
      this.props.children
    );
  }
}
