import type { MinimapCorner } from '../../../domain/contracts';
import type { OverlayRect, OverviewCorner } from './placement';
import { fixedOverviewCorner, solveOverviewPlacement, validOverlayRect } from './placement';
import { SpatialViewcube } from './SpatialViewcube';

export interface SpatialOverviewState {
  available: boolean;
  collapsed: boolean;
  expanded: boolean;
}

export interface SpatialOverviewPorts {
  subscribeEngine(listener: () => void): () => void;
  isDocked(): boolean;
  hasPlanes?(): boolean;
  /** A request must reach the engine before an absent map can cancel it. */
  minimapApplied?(): boolean;
  minimapShown(): boolean;
  viewcubeConcealed?(): boolean | undefined;
  corner(): MinimapCorner;
  requestMinimap(shown: boolean): void;
  labelForPlane(id: string): { label: string; path?: string } | undefined;
  onNavigate?(id: string): void;
  changed(state: SpatialOverviewState): void;
}

const mapSelector = '[data-plurid-overlay="minimap"]';
const cubeSelector = '[data-plurid-overlay="viewcube"]';
const toolbarSelector = '[data-plurid-entity="PluridToolbar"]';
// The toolbar root is a full-width, click-through band. Protect its controls and open menus,
// otherwise the empty bottom corners would suppress the cube even in a completely clear space.
const toolbarControlsSelector =
  `${toolbarSelector} [data-plurid-control], ` +
  `${toolbarSelector} [role="dialog"], ${toolbarSelector} [role="menu"]`;
// Only fixed, explicitly opted-in control areas participate; changing file rows do not.
const protectedAreaAttribute = 'data-viewer-overlay-protected';
// a plane's footer holds its actions, as its header controls do
const obstacleSelector =
  `.plane-controls, [data-plurid-plane] footer, ${cubeSelector}, ` +
  `${toolbarControlsSelector}, [${protectedAreaAttribute}]`;
const observedSelector = `${mapSelector}, ${toolbarSelector}, ${obstacleSelector}`;
const ownedStyles = [
  'position',
  'left',
  'top',
  'right',
  'bottom',
  'margin',
  'transform',
  'opacity',
  'background-color',
  'border-color',
] as const;

function rectangle(element: Element): OverlayRect {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

function visible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/** Adapts public engine DOM attributes; the engine retains projection and navigation ownership. */
export class SpatialOverview {
  private map?: HTMLElement;
  private frame?: number;
  private releaseFrame?: number;
  private corner?: OverviewCorner;
  private size = { width: 0, height: 0 };
  private state: SpatialOverviewState = { available: false, collapsed: false, expanded: false };
  private disposed = false;
  private awaitingPlacement = false;
  private applied = '';
  private pressed = false;
  private opener?: HTMLElement;
  private opening = false;
  private restoreFocus = false;
  private styles = new Map<string, string>();
  private originalRole: string | null = null;
  private originalLabel: string | null = null;
  private originalPopover: string | null = null;
  private labels = new Map<HTMLElement, { label: string | null; title: string | null }>();
  private observed = new Set<Element>();
  private resize?: ResizeObserver;
  private mutation: MutationObserver;
  private unsubscribe: () => void;
  private viewcube: SpatialViewcube;

  constructor(
    private root: HTMLElement,
    private ports: SpatialOverviewPorts,
  ) {
    this.viewcube = new SpatialViewcube(this.pressPointer, this.invalidate);
    if (typeof ResizeObserver !== 'undefined') this.resize = new ResizeObserver(this.invalidate);
    this.mutation = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === 'attributes' ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches(observedSelector) || !!node.querySelector(observedSelector)),
            ),
        )
      )
        this.invalidate();
    });
    this.mutation.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [protectedAreaAttribute, 'data-plurid-hover'],
    });
    this.unsubscribe = ports.subscribeEngine(this.invalidate);
    window.addEventListener('resize', this.invalidate);
    window.addEventListener('pointerup', this.releasePointer);
    window.addEventListener('pointercancel', this.releasePointer);
    window.addEventListener('keydown', this.pendingKeyDown, true);
    this.invalidate();
  }

  snapshot(): SpatialOverviewState {
    return { ...this.state };
  }

  private publish(next: SpatialOverviewState): void {
    if (
      next.available === this.state.available &&
      next.collapsed === this.state.collapsed &&
      next.expanded === this.state.expanded
    )
      return;
    this.state = next;
    this.ports.changed({ ...next });
  }

  invalidate = (): void => {
    if (this.disposed || this.frame !== undefined || this.pressed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.measure();
    });
  };

  private pressPointer = (): void => {
    this.pressed = true;
  };

  private releasePointer = (): void => {
    if (!this.pressed) return;
    this.pressed = false;
    this.invalidate();
  };

  private keyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || (!this.state.expanded && !this.opening)) return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private pendingKeyDown = (event: KeyboardEvent): void => {
    if (this.opening) this.keyDown(event);
  };

  private click = (event: MouseEvent): void => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-plurid-minimap-plane]')
        : null;
    const id = target?.dataset.pluridMinimapPlane;
    if (!id || !this.state.expanded) return;
    // The original button still owns the engine frame; this only closes the host popup.
    this.close(false);
    this.ports.onNavigate?.(id);
  };

  private toggle = (event: Event): void => {
    if ((event as ToggleEvent).newState !== 'closed' || !this.state.expanded) return;
    const focused = document.activeElement;
    this.restoreFocus = !focused || focused === document.body || !!this.map?.contains(focused);
    this.finishClose();
  };

  open(opener?: HTMLElement): void {
    if (this.disposed || this.ports.isDocked() || this.ports.hasPlanes?.() === false) return;
    if (this.state.expanded || this.opening) {
      this.close();
      return;
    }
    this.opener =
      opener ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    this.restoreFocus = true;
    this.opening = true;
    if (this.releaseFrame !== undefined) cancelAnimationFrame(this.releaseFrame);
    this.releaseFrame = undefined;
    this.ports.requestMinimap(true);
    this.measure(false);
  }

  private expand(): void {
    const map = this.map;
    if (!map) return;
    if (typeof map.showPopover !== 'function')
      throw new Error('This browser cannot show the workspace overview.');
    map.setAttribute('popover', 'auto');
    map.setAttribute('role', 'dialog');
    map.setAttribute('aria-label', 'Overview');
    Object.assign(map.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      right: 'auto',
      bottom: 'auto',
      margin: '0',
      transform: 'translate(-50%, -50%)',
      opacity: '1',
      backgroundColor: 'var(--plurid-surface-solid)',
      borderColor: 'var(--plurid-surface-strong)',
    });
    map.showPopover();
    this.placeExpanded(rectangle(this.root));
    this.opening = false;
    this.publish({ available: true, collapsed: this.state.collapsed, expanded: true });
    map.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
  }

  private placeExpanded(viewport: OverlayRect): OverlayRect | undefined {
    const map = this.map;
    if (!map) return;
    const corner = this.ports.corner();
    if (fixedOverviewCorner(corner)) {
      const { width, height } = rectangle(map);
      const placement = solveOverviewPlacement({
        viewport,
        size: { width, height },
        obstacles: [],
        corner,
      });
      if (placement.kind === 'corner') {
        Object.assign(map.style, {
          left: `${placement.bounds.x}px`,
          top: `${placement.bounds.y}px`,
          transform: 'none',
        });
        return placement.bounds;
      }
    }
    Object.assign(map.style, {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    });
  }

  close(restoreFocus = true): void {
    if (!this.state.expanded && !this.opening) return;
    this.restoreFocus = restoreFocus;
    try {
      if (this.state.expanded && this.map?.isConnected) this.map.hidePopover();
    } catch (error) {
      // Native light-dismiss or engine detachment may have closed it before this callback.
      if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error;
    }
    this.finishClose();
  }

  private finishClose(): void {
    this.opening = false;
    this.publish({ ...this.state, expanded: false });
    if (this.restoreFocus && this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.restoreFocus = false;
    this.restoreAttributes();
    // Keep a closed popup out of hit-testing until its safe corner is remeasured.
    this.map?.setAttribute('popover', 'auto');
    // A real mouse click can flush React between the native map listener and its root listener.
    // Keep the engine button mounted until that root has performed camera navigation.
    this.releaseFrame = requestAnimationFrame(() => {
      this.releaseFrame = undefined;
      if (!this.opening && !this.state.expanded) this.ports.requestMinimap(false);
    });
    this.awaitingPlacement = true;
    this.applied = '';
    this.invalidate();
  }

  private restoreAttributes(): void {
    if (!this.map) return;
    const attributes: readonly (readonly [string, string | null])[] = [
      ['role', this.originalRole],
      ['aria-label', this.originalLabel],
      ['popover', this.originalPopover],
    ];
    for (const [attribute, value] of attributes) {
      if (value === null) this.map.removeAttribute(attribute);
      else this.map.setAttribute(attribute, value);
    }
    for (const [property, value] of this.styles) this.map.style.setProperty(property, value);
  }

  private bind(map: HTMLElement | undefined): void {
    if (map === this.map) return;
    if (this.map) {
      if (this.state.expanded) this.close(false);
      this.map.removeEventListener('pointerdown', this.pressPointer);
      this.map.removeEventListener('keydown', this.keyDown);
      this.map.removeEventListener('click', this.click);
      this.map.removeEventListener('toggle', this.toggle);
      this.restoreAttributes();
    }
    for (const [button, previous] of this.labels) {
      if (previous.label === null) button.removeAttribute('aria-label');
      else button.setAttribute('aria-label', previous.label);
      if (previous.title === null) button.removeAttribute('title');
      else button.setAttribute('title', previous.title);
    }
    this.labels.clear();
    this.map = map;
    this.applied = '';
    this.awaitingPlacement = false;
    this.corner = undefined;
    this.size = { width: 0, height: 0 };
    this.styles.clear();
    if (!map) return;
    for (const property of ownedStyles)
      this.styles.set(property, map.style.getPropertyValue(property));
    this.originalRole = map.getAttribute('role');
    this.originalLabel = map.getAttribute('aria-label');
    this.originalPopover = map.getAttribute('popover');
    map.addEventListener('pointerdown', this.pressPointer);
    map.addEventListener('keydown', this.keyDown);
    map.addEventListener('click', this.click);
    map.addEventListener('toggle', this.toggle);
  }

  private measure(settled = true): void {
    if (this.disposed) return;
    const map = this.root.querySelector<HTMLElement>(mapSelector) ?? undefined;
    const cube = this.root.querySelector<HTMLElement>(cubeSelector) ?? undefined;
    const wasOpen = this.opening || this.state.expanded;
    this.bind(map);
    this.viewcube.bind(cube);
    const empty = this.ports.hasPlanes?.() === false;
    if (this.ports.isDocked() || empty) {
      if (this.opening) this.close();
      if (this.state.expanded) this.close(false);
      if (empty && wasOpen) this.root.focus({ preventScroll: true });
      this.observe(new Set([this.root]));
      if (cube) this.viewcube.place(rectangle(this.root), [], true);
      this.publish({ available: false, collapsed: false, expanded: false });
      return;
    }
    if (!map && this.opening && settled && this.ports.minimapApplied?.() !== false) this.close();
    if (!map && !cube) {
      this.observe(new Set([this.root]));
      this.publish({ available: !this.ports.minimapShown(), collapsed: false, expanded: false });
      return;
    }
    const viewport = rectangle(this.root);
    const elements = [...this.root.querySelectorAll<HTMLElement>(obstacleSelector)];
    this.observe(new Set<Element>([this.root, ...(map ? [map] : []), ...elements]));
    const placeCube = (fixedMap?: OverlayRect) => {
      if (!cube) return;
      this.viewcube.place(
        viewport,
        elements.filter((element) => element !== cube && visible(element)).map(rectangle),
        false,
        fixedMap,
        this.ports.viewcubeConcealed?.(),
      );
    };
    const fixed = fixedOverviewCorner(this.ports.corner());
    if (!fixed) placeCube();
    if (this.state.expanded) {
      const bounds = this.placeExpanded(viewport);
      if (fixed) placeCube(bounds);
      return;
    }
    if (!map) {
      if (fixed) placeCube();
      this.publish({ available: !this.ports.minimapShown(), collapsed: false, expanded: false });
      return;
    }
    if (!this.ports.minimapShown() && !this.opening) {
      if (fixed) placeCube();
      map.setAttribute('popover', 'auto');
      this.publish({ available: true, collapsed: false, expanded: false });
      return;
    }
    if (!this.opening && !this.state.collapsed && !this.awaitingPlacement && !visible(map)) {
      if (fixed) placeCube();
      this.publish({ available: false, collapsed: false, expanded: false });
      return;
    }
    const measured = rectangle(map);
    if (validOverlayRect(measured)) this.size = { width: measured.width, height: measured.height };
    const obstacles = elements.filter(visible).map(rectangle).filter(validOverlayRect);
    const placement = solveOverviewPlacement({
      viewport,
      size: this.size,
      obstacles,
      current: this.corner,
      corner: this.ports.corner(),
    });
    if (fixed) placeCube(placement.kind === 'corner' ? placement.bounds : undefined);
    const parent = map.offsetParent instanceof HTMLElement ? rectangle(map.offsetParent) : viewport;
    const signature = JSON.stringify([placement, parent.x, parent.y]);
    const changed = signature !== this.applied;
    if (changed) {
      this.restoreAttributes();
      this.applied = signature;
    }
    this.awaitingPlacement = false;
    if (placement.kind === 'fallback') {
      if (changed) map.setAttribute('popover', 'auto');
      this.publish({ available: true, collapsed: true, expanded: false });
    } else {
      this.corner = placement.corner;
      if (changed)
        Object.assign(map.style, {
          position: 'absolute',
          left: `${placement.bounds.x - parent.x}px`,
          top: `${placement.bounds.y - parent.y}px`,
          right: 'auto',
          bottom: 'auto',
        });
      this.publish({ available: true, collapsed: false, expanded: false });
    }
    const currentButtons = new Set(
      map.querySelectorAll<HTMLElement>('[data-plurid-minimap-plane]'),
    );
    for (const button of this.labels.keys())
      if (!currentButtons.has(button)) this.labels.delete(button);
    for (const button of currentButtons) {
      if (!this.labels.has(button))
        this.labels.set(button, {
          label: button.getAttribute('aria-label'),
          title: button.getAttribute('title'),
        });
      const title = this.ports.labelForPlane(button.dataset.pluridMinimapPlane!);
      if (title) {
        const label = `Go to ${title.label}`;
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
        if (button.getAttribute('title') !== (title.path ?? title.label))
          button.setAttribute('title', title.path ?? title.label);
      }
    }
    if (this.opening) this.expand();
  }

  private observe(elements: Set<Element>): void {
    for (const element of this.observed)
      if (!elements.has(element)) this.resize?.unobserve(element);
    for (const element of elements) if (!this.observed.has(element)) this.resize?.observe(element);
    this.observed = elements;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.opening) this.close(false);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.mutation.disconnect();
    this.unsubscribe();
    window.removeEventListener('resize', this.invalidate);
    window.removeEventListener('pointerup', this.releasePointer);
    window.removeEventListener('pointercancel', this.releasePointer);
    window.removeEventListener('keydown', this.pendingKeyDown, true);
    this.viewcube.destroy();
    this.bind(undefined);
    if (this.releaseFrame !== undefined) {
      cancelAnimationFrame(this.releaseFrame);
      this.releaseFrame = undefined;
      this.ports.requestMinimap(false);
    }
    this.observed.clear();
  }
}
