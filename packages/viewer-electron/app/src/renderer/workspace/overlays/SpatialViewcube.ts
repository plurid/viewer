import { solveProtectedOverlayPlacement, type OverlayRect } from './placement';

const ownedStyles = ['left', 'top', 'right', 'bottom', 'visibility', 'transition'] as const;

/** Keeps the original engine control usable without covering explicitly protected plane controls. */
export class SpatialViewcube {
  private element?: HTMLElement;
  private styles = new Map<string, string>();
  private concealed = false;
  private applied = '';

  constructor(private pressPointer: () => void) {}

  bind(element: HTMLElement | undefined): void {
    if (element === this.element) return;
    if (this.element) {
      this.restore();
      this.element.removeEventListener('pointerdown', this.pressPointer);
    }
    this.element = element;
    this.styles.clear();
    this.concealed = false;
    this.applied = '';
    if (!element) return;
    for (const property of ownedStyles)
      this.styles.set(property, element.style.getPropertyValue(property));
    element.addEventListener('pointerdown', this.pressPointer);
  }

  private restore(): void {
    if (!this.element) return;
    for (const [property, value] of this.styles) this.element.style.setProperty(property, value);
    this.concealed = false;
    this.applied = '';
  }

  place(viewport: OverlayRect, obstacles: readonly OverlayRect[], docked: boolean): void {
    const element = this.element;
    if (!element) return;
    if (docked) {
      this.restore();
      return;
    }
    const style = getComputedStyle(element);
    if (style.display === 'none' || (!this.concealed && style.visibility === 'hidden')) return;
    const measured = element.getBoundingClientRect();
    const placement = solveProtectedOverlayPlacement({
      viewport,
      bounds: { x: measured.x, y: measured.y, width: measured.width, height: measured.height },
      obstacles,
    });
    const parent =
      element.offsetParent instanceof HTMLElement
        ? element.offsetParent.getBoundingClientRect()
        : viewport;
    const signature = JSON.stringify([placement, parent.x, parent.y]);
    if (signature === this.applied) return;
    this.applied = signature;
    if (!placement) {
      // Rotation/frame commands remain available; a geometry change restores the cube automatically.
      element.style.visibility = 'hidden';
      this.concealed = true;
      return;
    }
    Object.assign(element.style, {
      left: `${placement.x - parent.x}px`,
      top: `${placement.y - parent.y}px`,
      right: 'auto',
      bottom: 'auto',
      visibility: this.styles.get('visibility') ?? '',
      // Moving a HUD through a protected button would briefly recreate the obstruction.
      transition: 'none',
    });
    this.concealed = false;
  }

  destroy(): void {
    this.bind(undefined);
  }
}
