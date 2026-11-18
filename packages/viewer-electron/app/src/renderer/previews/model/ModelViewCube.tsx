import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, Ref } from 'react';
import type * as THREE from 'three';
import { IconButton } from '../../ui/primitives';
import {
  cubeHeading,
  cubePatch,
  cubeTransform,
  cubeViews,
  nearestCubeView,
  stepCubeView,
} from './viewcube';
import type { CubeStep, CubeView } from './viewcube';
import './viewcube.css';

export interface ModelViewCubeHandle {
  /** Turns the cube with the camera; called after each frame the camera moves. */
  update(camera: THREE.Camera): void;
}

export interface ModelViewCubeActions {
  choose(view: CubeView): void;
  home(): void;
  /** A drag begins: momentum and a running turn stop. */
  turnStart(): void;
  /** Angles for a drag right and down, as on the canvas. */
  turn(x: number, y: number): void;
  wheel(event: WheelEvent): void;
  /** Whole notches, in for positive steps, as + and - do on the canvas. */
  zoom(steps: number): void;
}

interface ModelViewCubeProps extends ModelViewCubeActions {
  ref?: Ref<ModelViewCubeHandle>;
  extension: string;
  hidden: boolean;
  /** An inactive plane's cube takes no input; a click reaches the plane. */
  inactive: boolean;
}

interface CubePress {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

const patches = cubeViews.map(cubePatch);
const steps: Record<string, CubeStep> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};
const zoomKeys: Record<string, number> = { '+': 1, '=': 1, '-': -1, _: -1 };
/** The cube's box in pixels: a drag across it turns the model half a turn. */
const cubeSize = 104;
/** Movement within this many pixels is a click, as on the canvas. */
const clickSlop = 4;
const homeLabel = 'Home view';

/** Standard views on a bevelled cube that turns with the model preview's own camera. */
export function ModelViewCube({
  ref,
  extension,
  hidden,
  inactive,
  ...actions
}: ModelViewCubeProps) {
  const root = useRef<HTMLDivElement>(null);
  const solid = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const press = useRef<CubePress | undefined>(undefined);
  const dragged = useRef(false);
  const heading = useRef(0);
  const latest = useRef(actions);
  const [current, setCurrent] = useState<CubeView>(cubeViews[0]!);
  /** The name under the pointer: a side, or the Home button. */
  const [hovered, setHovered] = useState<string>();
  useLayoutEffect(() => {
    latest.current = actions;
  });
  useImperativeHandle(
    ref,
    () => ({
      update(camera) {
        if (solid.current) solid.current.style.transform = cubeTransform(camera, extension);
        const nearest = nearestCubeView(camera, extension);
        heading.current = cubeHeading(nearest) ?? heading.current;
        // Tab lands on the side in view. Keyboard focus inside the cube stays where it is,
        // except during a drag, when the caption names the side the drag turns to.
        const element = root.current;
        if (press.current?.moved || !element?.contains(element.ownerDocument.activeElement))
          setCurrent(nearest);
      },
    }),
    [extension],
  );
  // React's wheel listener is passive; this one keeps the plane from scrolling.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => latest.current.wheel(event);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const focus = (view: CubeView) => {
    heading.current = cubeHeading(view) ?? heading.current;
    setCurrent(view);
    buttons.current.get(view.id)?.focus({ preventScroll: true });
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = steps[event.key];
    const zoom = zoomKeys[event.key];
    if (step) focus(stepCubeView(current, step, heading.current));
    else if (zoom) latest.current.zoom(zoom);
    else if (event.key === 'Home') latest.current.home();
    else if (event.key === ' ' || event.key === 'Enter') {
      // The button acts on its own; the key must not reach Quick Preview, which closes on Space.
      event.stopPropagation();
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragged.current = false;
    press.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = press.current;
    if (!start || start.id !== event.pointerId) return;
    if (!start.moved) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= clickSlop) return;
      // Capture only once it is a drag, so a click still reaches the patch under the pointer.
      start.moved = dragged.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setHovered(undefined);
      latest.current.turnStart();
    }
    latest.current.turn(
      (Math.PI * (event.clientX - start.lastX)) / cubeSize,
      (Math.PI * (event.clientY - start.lastY)) / cubeSize,
    );
    start.lastX = event.clientX;
    start.lastY = event.clientY;
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (press.current?.id !== event.pointerId) return;
    press.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const end = () => {
    press.current = undefined;
  };
  return (
    <div className="model-viewcube-layer" hidden={hidden}>
      <div
        ref={root}
        className="model-viewcube"
        inert={inactive}
        // Any press or menu on the cube is the cube's: the plane never drags or opens its menu.
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <div
          className="model-viewcube-view"
          role="toolbar"
          aria-label="View cube"
          onKeyDown={key}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={end}
          onLostPointerCapture={end}
          onPointerOver={(event) => {
            if (press.current?.moved) return;
            const target = (event.target as HTMLElement).closest<HTMLElement>('[data-view]');
            setHovered(
              target?.dataset.view === 'home'
                ? homeLabel
                : cubeViews.find((view) => view.id === target?.dataset.view)?.label,
            );
          }}
          onPointerLeave={() => setHovered(undefined)}
        >
          <div className="model-viewcube-solid" ref={solid}>
            {cubeViews.map((view, index) => (
              <button
                key={view.id}
                ref={(element) => {
                  if (element) buttons.current.set(view.id, element);
                  else buttons.current.delete(view.id);
                }}
                type="button"
                className={`model-viewcube-patch model-viewcube-${view.kind}`}
                style={patches[index]}
                data-view={view.id}
                aria-label={`${view.label} view`}
                tabIndex={view === current ? 0 : -1}
                onFocus={() => {
                  heading.current = cubeHeading(view) ?? heading.current;
                  setCurrent(view);
                }}
                onClick={(event) => {
                  // A drag ends in a click on the patch it started from; Enter is detail 0.
                  if (dragged.current && event.detail > 0) return;
                  latest.current.choose(view);
                }}
              >
                {view.kind === 'face' ? view.label : null}
              </button>
            ))}
          </div>
          {/* One tab stop for the cube: Home is its key, and this button its pointer target. */}
          <IconButton
            className="model-viewcube-home"
            icon="fit"
            label={homeLabel}
            // The caption beside the cube names it; a tooltip as well would say it twice.
            title={undefined}
            data-view="home"
            tabIndex={-1}
            aria-keyshortcuts="Home"
            onClick={(event) => {
              if (dragged.current && event.detail > 0) return;
              latest.current.home();
            }}
          />
        </div>
        <span className="model-viewcube-caption" aria-hidden="true">
          {hovered ?? current.label}
        </span>
      </div>
    </div>
  );
}
