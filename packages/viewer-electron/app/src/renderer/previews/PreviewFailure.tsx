import type { ReactNode } from 'react';
import type { IconName } from '../ui/Icon';
import { Failure } from '../ui/primitives';
import type { PreviewContext } from './contracts';

/**
 * A preview that could not show its file, with the ways on: the file's own app, its bytes, and
 * Try Again. Each action shows only where the host offers it.
 */
export function PreviewFailure({
  context,
  icon,
  title,
  detail,
  onRetry,
  children,
}: {
  context: Pick<PreviewContext, 'showHex' | 'retry' | 'openInApp'>;
  icon?: IconName;
  title: string;
  detail?: string;
  /** The module's own Try Again, where it reads again without its host. */
  onRetry?(): void;
  /** The format's own ways on, before the standard ones, such as First Worksheet. */
  children?: ReactNode;
}) {
  const { retry, showHex, openInApp } = context;
  return (
    <Failure icon={icon} title={title} detail={detail} onRetry={onRetry ?? retry}>
      {children}
      {/* a host offers it only for a file of its own: an archive's entry or a message's
          attachment has no path outside Viewer */}
      {openInApp && (
        <button type="button" onClick={openInApp}>
          Open in Default App
        </button>
      )}
      {showHex && (
        <button type="button" onClick={showHex}>
          Show as Hex
        </button>
      )}
    </Failure>
  );
}
