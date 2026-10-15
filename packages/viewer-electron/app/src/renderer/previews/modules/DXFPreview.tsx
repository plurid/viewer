import { useEffect, useMemo, useRef, useState } from 'react';
import type { PreviewContext } from '../contracts';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { usePreviewState } from '../state';
import { Empty, IconButton, Loading } from '../../ui/primitives';
import {
  createDrawingCanvas,
  type CanvasOptions,
  type DrawingCanvas,
  type DrawingView,
} from '../dxf/canvas';
import type { Drawing, DrawingEntity } from '../../../domain/dxf/math';
import { DXF_MAX_BYTES } from '../../../domain/dxf/math';
import {
  convertUnits,
  formatMeasure,
  measurementValue,
  unitInfo,
  units,
  type Measurement,
  type Tool,
} from '../../../domain/dxf/units';
import type { DrawingResult } from '../dxf/dxf.worker';

/** Extend the established preview header: the drawing leads, tools and evidence stay compact. */
export default function DXFPreview(context: PreviewContext) {
  const { resource, signal, active, interactive, look } = context;
  const stage = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    session = useRef<DrawingCanvas | null>(null);
  const [drawing, setDrawing] = useState<Drawing>(),
    [error, setError] = useState('');
  const [selected, setSelected] = useState<DrawingEntity>(),
    [draft, setDraft] = useState(0);
  const [tool, setTool] = usePreviewState<Tool>(context, 'dxf.tool', 'inspect');
  const [grid, setGrid] = usePreviewState(context, 'dxf.grid', true),
    [snap, setSnap] = usePreviewState(context, 'dxf.snap', true);
  const [panel, setPanel] = usePreviewState(context, 'dxf.panel', false);
  const [hidden, setHidden] = usePreviewState<string[] | null>(context, 'dxf.hidden', null);
  const [measurements, setMeasurements] = usePreviewState<Measurement[]>(
    context,
    'dxf.measurements',
    [],
  );
  const [display, setDisplay] = usePreviewState(context, 'dxf.units', 'drawing');
  const sourceUnit = unitInfo(drawing?.units ?? 0).id;
  const displayUnit = display === 'drawing' ? sourceUnit : Number(display);
  const options: CanvasOptions = {
    active,
    interactive,
    look,
    tool,
    grid,
    snap,
    hiddenLayers: hidden ?? drawing?.layers.filter((l) => !l.visible).map((l) => l.name) ?? [],
    measurements,
    unit: sourceUnit,
    displayUnit,
  };
  const current = useRef(options);
  current.current = options;
  const callbacks = useRef({ setMeasurements, context });
  callbacks.current = { setMeasurements, context };
  useEffect(() => {
    setDrawing(undefined);
    setError('');
    setSelected(undefined);
    if (resource.entry.size > DXF_MAX_BYTES) {
      setError('This drawing exceeds the DXF preview limit (32 MB).');
      return;
    }
    if (signal.aborted) return;
    const worker = new Worker(new URL('../dxf/dxf.worker.ts', import.meta.url), { type: 'module' });
    let disposed = false;
    const stop = () => {
      disposed = true;
      clearTimeout(timeout);
      worker.terminate();
    };
    const timeout = setTimeout(() => {
      if (!disposed) {
        setError(
          'Drawing preview took too long. Simplify the drawing or export its 2D model space and reopen it.',
        );
        stop();
      }
    }, 20000);
    worker.onmessage = (event: MessageEvent<DrawingResult>) => {
      if (disposed || signal.aborted) return;
      if (event.data.error) setError(event.data.error);
      else setDrawing(event.data.drawing);
      stop();
    };
    worker.onerror = () => {
      if (!disposed && !signal.aborted)
        setError('The drawing worker could not load this file. Reopen it to retry.');
      stop();
    };
    signal.addEventListener('abort', stop, { once: true });
    worker.postMessage({ url: resource.url });
    return () => {
      signal.removeEventListener('abort', stop);
      stop();
    };
  }, [resource.id, resource.url, resource.entry.size, signal]);
  useEffect(() => {
    if (!drawing || !stage.current || !canvas.current) return;
    try {
      session.current = createDrawingCanvas(
        stage.current,
        canvas.current,
        drawing,
        current.current,
        {
          selected: setSelected,
          measurements: (value) => callbacks.current.setMeasurements(value),
          draft: setDraft,
          view: (value) => callbacks.current.context.state?.set('dxf.view', value),
        },
        context.state?.get('dxf.view') as DrawingView | undefined,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Drawing graphics are unavailable.');
    }
    return () => {
      session.current?.dispose();
      session.current = null;
    };
  }, [drawing, context.state]);
  useEffect(() => {
    session.current?.set(current.current);
  }, [active, interactive, look, tool, grid, snap, hidden, measurements, display, drawing]);
  const ready = !!drawing && !error;
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'dxf-frame',
          label: 'Fit drawing',
          aliases: ['fit dxf', 'fd'],
          primary: true,
          available: ready,
          run: () => session.current?.frame(),
        },
        ...(['inspect', 'distance', 'angle', 'area'] as const).map((value) => ({
          id: `dxf-${value}`,
          label: value === 'inspect' ? 'Inspect drawing geometry' : `Measure ${value}`,
          aliases: ['dxf', `drawing ${value}`],
          available: ready,
          run: () => setTool(value),
        })),
        {
          id: 'dxf-grid',
          label: grid ? 'Hide drawing grid' : 'Show drawing grid',
          available: ready,
          run: () => setGrid((value) => !value),
        },
        {
          id: 'dxf-snap',
          label: snap ? 'Disable drawing snap' : 'Enable drawing snap',
          available: ready,
          run: () => setSnap((value) => !value),
        },
        {
          id: 'dxf-panel',
          label: panel ? 'Hide drawing details' : 'Show drawing details',
          aliases: ['dxf layers', 'measurements'],
          available: ready,
          run: () => setPanel((value) => !value),
        },
        {
          id: 'dxf-clear',
          label: 'Clear drawing measurements',
          available: ready && measurements.length > 0,
          run: () => setMeasurements([]),
        },
      ],
      [
        ready,
        grid,
        snap,
        panel,
        measurements.length,
        setTool,
        setGrid,
        setSnap,
        setPanel,
        setMeasurements,
      ],
    ),
  );
  const measure = (value: number, squared = false) =>
    formatMeasure(convertUnits(value, sourceUnit, displayUnit, squared), displayUnit, squared);
  const instructions =
    tool === 'inspect'
      ? 'Click geometry to inspect · drag to pan · scroll to zoom'
      : tool === 'distance'
        ? 'Pick two points · Shift temporarily disables snap'
        : tool === 'angle'
          ? 'Pick first point, vertex, then last point'
          : 'Pick boundary points · Enter or double-click to finish · Escape cancels';
  const latest = measurements.at(-1);
  return (
    <div
      className="dxf-viewer"
      data-dxf-units={sourceUnit}
      data-dxf-entities={drawing?.entities.length}
    >
      <PreviewToolbar context={context}>
        <IconButton
          icon="frame"
          label="Fit drawing"
          disabled={!ready}
          onClick={() => session.current?.frame()}
        />
        <select
          aria-label="Drawing tool"
          disabled={!ready}
          value={tool}
          onChange={(event) => setTool(event.target.value as Tool)}
        >
          <option value="inspect">Inspect</option>
          <option value="distance">Distance</option>
          <option value="angle">Angle</option>
          <option value="area">Area</option>
        </select>
        <button
          aria-pressed={snap}
          className={snap ? 'selected' : ''}
          disabled={!ready}
          onClick={() => setSnap(!snap)}
        >
          Snap
        </button>
        <IconButton
          icon="grid"
          label={grid ? 'Hide drawing grid' : 'Show drawing grid'}
          aria-pressed={grid}
          disabled={!ready}
          onClick={() => setGrid(!grid)}
        />
        <IconButton
          icon="sidebar"
          label={panel ? 'Hide drawing details' : 'Show drawing details'}
          aria-pressed={panel}
          disabled={!ready}
          onClick={() => setPanel(!panel)}
        />
      </PreviewToolbar>
      <div className="dxf-content">
        <div className="dxf-stage" ref={stage}>
          <canvas
            ref={canvas}
            tabIndex={0}
            aria-label="DXF drawing. Click to inspect or measure, drag to pan, scroll to zoom. Home fits the drawing. Enter finishes an area and Escape cancels."
          />
          {!drawing && !error && (
            <div className="preview-overlay">
              <Loading label="Loading drawing…" />
            </div>
          )}
          {error && (
            <div className="preview-overlay">
              <Empty icon="drawing" title="Drawing could not be loaded" detail={error} />
            </div>
          )}
          {ready && (selected || measurements.length > 0 || draft > 0) && (
            <div className="dxf-readout" aria-live="polite">
              {selected && (
                <span>
                  <strong>{selected.type}</strong> · {selected.layer}
                  {selected.length !== undefined
                    ? ` · ${selected.approximate ? '≈ ' : ''}${measure(selected.length)}`
                    : ''}
                  {selected.radius !== undefined ? ` · R ${measure(selected.radius)}` : ''}
                  {selected.axes
                    ? ` · axes ${measure(selected.axes[0] * 2)} × ${measure(selected.axes[1] * 2)}`
                    : ''}
                  {selected.area !== undefined ? ` · ${measure(selected.area, true)}` : ''}
                </span>
              )}
              {latest && (
                <span data-dxf-last-measurement>
                  <strong>
                    {latest.tool === 'angle'
                      ? 'Angle'
                      : latest.tool === 'area'
                        ? 'Area'
                        : 'Distance'}
                  </strong>{' '}
                  ·{' '}
                  {(() => {
                    const value = measurementValue(latest);
                    return value === undefined
                      ? 'Pick distinct points'
                      : latest.tool === 'angle'
                        ? `${value.toFixed(2)}°`
                        : measure(value, latest.tool === 'area');
                  })()}
                </span>
              )}
              {draft > 0 && (
                <span>
                  {draft} {draft === 1 ? 'point' : 'points'}
                </span>
              )}
            </div>
          )}
        </div>
        {panel && ready && (
          <aside className="dxf-details" aria-label="Drawing details">
            <header>
              <strong>Drawing</strong>
              <IconButton
                icon="close"
                label="Close drawing details"
                onClick={() => setPanel(false)}
              />
            </header>
            <label>
              Measurement units
              <select
                aria-label="Drawing measurement units"
                value={display}
                onChange={(event) => setDisplay(event.target.value)}
              >
                <option value="drawing">From file ({unitInfo(sourceUnit).symbol})</option>
                {units
                  .filter((u) => [1, 2, 4, 5, 6].includes(u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
              </select>
            </label>
            {!sourceUnit && (
              <p className="muted">
                This file does not specify units. Choosing a unit labels its coordinates; it does
                not rescale the drawing.
              </p>
            )}
            <p className="muted">
              {drawing.entities.length.toLocaleString()} entities ·{' '}
              {measure(drawing.bounds.max.x - drawing.bounds.min.x)} ×{' '}
              {measure(drawing.bounds.max.y - drawing.bounds.min.y)}
            </p>
            <strong>Layers</strong>
            {drawing.layers.map((layer) => (
              <label className="dxf-layer" key={layer.name}>
                <input
                  type="checkbox"
                  checked={!options.hiddenLayers.includes(layer.name)}
                  onChange={(event) =>
                    setHidden(
                      event.target.checked
                        ? options.hiddenLayers.filter((name) => name !== layer.name)
                        : [...options.hiddenLayers, layer.name],
                    )
                  }
                />
                <span title={layer.name}>{layer.name}</span>
                <span className="muted">{layer.count}</span>
              </label>
            ))}
            <div className="dxf-section-heading">
              <strong>Measurements</strong>
              <button disabled={!measurements.length} onClick={() => setMeasurements([])}>
                Clear
              </button>
            </div>
            {!measurements.length && (
              <p className="muted">
                Choose Distance, Angle or Area and pick points on the drawing.
              </p>
            )}
            {measurements.map((item, index) => {
              const value = measurementValue(item);
              return (
                <div className="dxf-measurement" key={item.id}>
                  <span>
                    <strong>
                      {index + 1}.{' '}
                      {item.tool === 'angle' ? 'Angle' : item.tool === 'area' ? 'Area' : 'Distance'}
                    </strong>
                    <span>
                      {value === undefined
                        ? 'Undefined'
                        : item.tool === 'angle'
                          ? `${value.toFixed(2)}°`
                          : measure(value, item.tool === 'area')}
                    </span>
                    {item.tool === 'distance' && (
                      <small className="muted">
                        ΔX {measure(Math.abs((item.points[1]?.x ?? 0) - (item.points[0]?.x ?? 0)))}{' '}
                        · ΔY{' '}
                        {measure(Math.abs((item.points[1]?.y ?? 0) - (item.points[0]?.y ?? 0)))}
                      </small>
                    )}
                  </span>
                  <IconButton
                    icon="close"
                    label={`Remove measurement ${index + 1}`}
                    onClick={() =>
                      setMeasurements((items) => items.filter((m) => m.id !== item.id))
                    }
                  />
                </div>
              );
            })}
            {measurements.length >= 100 && (
              <p className="muted">
                100-measurement limit reached. Remove or clear measurements to continue.
              </p>
            )}
            {drawing.warnings.length > 0 && (
              <>
                <strong>Preview limitations</strong>
                {drawing.warnings.map((warning) => (
                  <p className="muted" key={warning}>
                    {warning}
                  </p>
                ))}
              </>
            )}
          </aside>
        )}
      </div>
      {ready && (
        <footer className="dxf-info">
          <div className="dxf-guidance">
            <span title={instructions}>{instructions}</span>
            <span className="dxf-units">
              {unitInfo(displayUnit).symbol}
              {displayUnit !== sourceUnit &&
                sourceUnit !== 0 &&
                ` · file ${unitInfo(sourceUnit).symbol}`}
            </span>
          </div>
          {draft > 0 && (
            <span className="dxf-draft-controls">
              {tool === 'area' && (
                <button disabled={draft < 3} onClick={() => session.current?.finish()}>
                  Finish area
                </button>
              )}
              <IconButton
                icon="close"
                label="Cancel measurement"
                onClick={() => session.current?.cancel()}
              />
            </span>
          )}
          {drawing.warnings.length > 0 && (
            <button onClick={() => setPanel(true)}>
              {drawing.warnings.length}{' '}
              {drawing.warnings.length === 1 ? 'limitation' : 'limitations'}
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
