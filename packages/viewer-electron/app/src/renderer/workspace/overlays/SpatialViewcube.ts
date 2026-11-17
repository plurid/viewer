import type { OverlayRect } from './placement';
import { overlaysIntersect, solveOverviewPlacement, validOverlayRect } from './placement';

interface CubeTranslation {
  x: number;
  y: number;
}

function translationOffset(value: string, bounds: OverlayRect): CubeTranslation | undefined {
  if (!value || value === 'none') return { x: 0, y: 0 };
  const parts = value.split(/\s+/);
  if (!parts.every((part) => /^-?[\d.]+(?:px|%)?$/.test(part))) return;
  const distance = (part: string, size: number) =>
    Number.parseFloat(part) * (part.endsWith('%') ? size / 100 : 1);
  return {
    x: distance(parts[0]!, bounds.width),
    y: distance(parts[1] ?? '0px', bounds.height),
  };
}

/** Keep engine conceal and hover while yielding to the person's fixed map corner. */
export class SpatialViewcube {
  private element?: HTMLElement;
  private visibility = '';
  private visibilityPriority = '';
  private suppressed = false;
  private translation = '';
  private translationPriority = '';
  private moved = false;
  private offset: CubeTranslation = { x: 0, y: 0 };
  private origin?: string;
  private placementKey = '';
  private placed?: OverlayRect;
  private concealed = false;

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
      this.restorePosition();
      this.element.removeEventListener('pointerdown', this.pressPointer);
      this.element.removeEventListener('transitionend', this.transitionEnd);
    }
    this.element = element;
    this.origin = undefined;
    this.concealed = false;
    if (!element) return;
    this.visibility = element.style.getPropertyValue('visibility');
    this.visibilityPriority = element.style.getPropertyPriority('visibility');
    this.translation = element.style.getPropertyValue('translate');
    this.translationPriority = element.style.getPropertyPriority('translate');
    element.addEventListener('pointerdown', this.pressPointer);
    element.addEventListener('transitionend', this.transitionEnd);
  }

  private restore(): void {
    if (!this.element || !this.suppressed) return;
    this.element.style.setProperty('visibility', this.visibility, this.visibilityPriority);
    this.suppressed = false;
  }

  private restorePosition(): void {
    if (this.element && this.moved)
      this.element.style.setProperty('translate', this.translation, this.translationPriority);
    this.moved = false;
    this.offset = { x: 0, y: 0 };
    this.placed = undefined;
    this.placementKey = '';
  }

  place(
    viewport: OverlayRect,
    obstacles: readonly OverlayRect[],
    docked: boolean,
    fixedMap?: OverlayRect,
    conceal?: boolean,
  ): void {
    const element = this.element;
    if (!element) return;
    if (docked) {
      this.restorePosition();
      this.restore();
      return;
    }
    const style = getComputedStyle(element);
    if (style.display === 'none' || (!this.suppressed && style.visibility === 'hidden')) return;
    const measured = element.getBoundingClientRect();
    let offset = this.offset;
    if (this.origin !== undefined) {
      const current = translationOffset(style.translate, measured);
      const origin = translationOffset(this.origin, measured);
      if (current && origin) offset = { x: current.x - origin.x, y: current.y - origin.y };
    }
    // Restoring translate to measure would start a reverse transition before the box catches up.
    const natural = {
      x: measured.x - offset.x,
      y: measured.y - offset.y,
      width: measured.width,
      height: measured.height,
    };
    const concealX = Math.max(
      0,
      -Number.parseFloat(style.right) || 0,
      -Number.parseFloat(style.left) || 0,
    );
    const concealY = Math.max(
      0,
      -Number.parseFloat(style.bottom) || 0,
      -Number.parseFloat(style.top) || 0,
    );
    const offscreen = concealX > 0 || concealY > 0;
    // DOM-only consumers must remember conceal after hover brings the anchors back into view.
    this.concealed = conceal ?? (this.concealed || offscreen);
    const keepEnginePosition = this.concealed || offscreen;
    const signature = JSON.stringify([viewport, fixedMap, measured.width, measured.height]);
    if (!fixedMap || keepEnginePosition) {
      // Relocating a concealed viewcube on reveal would move it away from the pointer.
      this.restorePosition();
    } else if (signature !== this.placementKey) {
      if (validOverlayRect(natural) && overlaysIntersect(natural, fixedMap)) {
        const placement = solveOverviewPlacement({
          viewport,
          size: { width: measured.width, height: measured.height },
          obstacles: [...obstacles, fixedMap],
        });
        if (placement.kind === 'corner') {
          if (this.origin === undefined) this.origin = style.translate;
          this.offset = {
            x: placement.bounds.x - natural.x,
            y: placement.bounds.y - natural.y,
          };
          const original =
            this.origin && this.origin !== 'none' ? this.origin.split(/\s+/) : ['0px', '0px'];
          const shifted = (value: string, distance: number) =>
            /^-?[\d.]+px$/.test(value)
              ? `${Number.parseFloat(value) + distance}px`
              : `calc(${value} + ${distance}px)`;
          const translation =
            `${shifted(original[0]!, this.offset.x)} ${shifted(original[1] ?? '0px', this.offset.y)}` +
            (original[2] ? ' ' + original[2] : '');
          if (element.style.translate !== translation)
            element.style.setProperty('translate', translation, this.translationPriority);
          this.moved = true;
          this.placed = placement.bounds;
        } else this.restorePosition();
      } else this.restorePosition();
      if (this.placed || !overlaysIntersect(natural, fixedMap)) this.placementKey = signature;
    }
    const bounds = this.placed ?? natural;
    // Conceal deliberately puts most of the cube outside the viewport. Only its visible portion
    // can block a button; clamping the entire cube inside would defeat its concealed state.
    const x = Math.max(bounds.x, viewport.x);
    const y = Math.max(bounds.y, viewport.y);
    const visible = {
      x,
      y,
      width: Math.min(bounds.x + bounds.width, viewport.x + viewport.width) - x,
      height: Math.min(bounds.y + bounds.height, viewport.y + viewport.height) - y,
    };
    const blocked =
      validOverlayRect(visible) &&
      [...obstacles, ...(fixedMap && !keepEnginePosition ? [fixedMap] : [])].some(
        (area) => validOverlayRect(area) && overlaysIntersect(visible, area),
      );
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
