import type { WebContents } from 'electron';
import type { DesktopEvent } from '../../domain/contracts';
import { performanceMeter } from '../diagnostics/performance';

/** Every desktop event reaches a renderer through here: typed, and never sent to a closed window. */
export function sendEvent(contents: WebContents, event: DesktopEvent): void {
  if (contents.isDestroyed()) return;
  performanceMeter.event(event.type, event);
  contents.send('viewer:event', event);
}
