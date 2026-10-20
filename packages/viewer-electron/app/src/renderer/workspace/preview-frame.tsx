import type { ReactNode } from 'react';

/**
 * A preview plane's frame. It takes the focus when pressed, unless something inside already has
 * it, so the keys of a preview whose content takes no focus (an image, a PDF, an EPUB) are the
 * plane's, which plurid leaves alone: after a click they went to the body, and plurid's camera
 * keys applied (2026-10-20).
 */
export function PreviewFrame({ activate, children }: { activate(): void; children: ReactNode }) {
  return (
    <div
      className="preview-plane"
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        activate();
        if (!event.currentTarget.contains(document.activeElement))
          event.currentTarget.focus({ preventScroll: true });
      }}
    >
      {children}
    </div>
  );
}
