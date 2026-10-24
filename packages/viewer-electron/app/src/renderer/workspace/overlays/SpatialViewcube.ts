import { overlaysIntersect, validOverlayRect, type OverlayRect } from './placement';

/** The engine owns positioning, conceal and hover; Viewer only protects controls underneath. */
export class SpatialViewcube {
  private element?: HTMLElement;
  private visibility = '';
  private visibilityPriority = '';
  private suppressed = false;

  constructor(
    private pressPointer: () => void,
    private invalidate: () => void,
  ) {}

  private transitionEnd = (event: Event): void => {
    if (event.target === this.element) this.invalidate();
  };

  bind(element: HTMLElement | undefined): void {
    if (element === this.element) return;
    if (this.element) {
      this.restore();
      this.element.removeEventListener('pointerdown', this.pressPointer);
      this.element.removeEventListener('transitionend', this.transitionEnd);
    }
    this.element = element;
    if (!element) return;
    this.visibility = element.style.getPropertyValue('visibility');
    this.visibilityPriority = element.style.getPropertyPriority('visibility');
    element.addEventListener('pointerdown', this.pressPointer);
    element.addEventListener('transitionend', this.transitionEnd);
  }

  private restore(): void {
    if (!this.element || !this.suppressed) return;
    this.element.style.setProperty('visibility', this.visibility, this.visibilityPriority);
    this.suppressed = false;
  }

  place(viewport: OverlayRect, obstacles: readonly OverlayRect[], docked: boolean): void {
    const element = this.element;
    if (!element) return;
    if (docked) {
      this.restore();
      return;
    }
    const style = getComputedStyle(element);
    if (style.display === 'none' || (!this.suppressed && style.visibility === 'hidden')) return;
    const measured = element.getBoundingClientRect();
    // Conceal deliberately puts most of the cube outside the viewport. Only its visible portion
    // can block a button; clamping the entire cube inside would defeat the engine's tucked state.
    const x = Math.max(measured.x, viewport.x);
    const y = Math.max(measured.y, viewport.y);
    const visible = {
      x,
      y,
      width: Math.min(measured.right, viewport.x + viewport.width) - x,
      height: Math.min(measured.bottom, viewport.y + viewport.height) - y,
    };
    const blocked =
      validOverlayRect(visible) &&
      obstacles.some((area) => validOverlayRect(area) && overlaysIntersect(visible, area));
    if (blocked) {
      if (!this.suppressed) {
        element.style.setProperty('visibility', 'hidden', this.visibilityPriority);
        this.suppressed = true;
      }
    } else {
      this.restore();
    }
  }

  destroy(): void {
    this.bind(undefined);
  }
}
