import { useEffect, useRef } from 'react';
import { IconButton } from '../../ui/primitives';
import { ChoiceButton } from '../../ui/ChoiceMenu';
import { defaultModelAppearance, type ModelAppearance } from './appearance';
export function ShadingControls({
  id,
  value,
  change,
  close,
  hasDeformingMeshes,
}: {
  id: string;
  value: ModelAppearance;
  change(value: ModelAppearance): void;
  close(): void;
  hasDeformingMeshes: boolean;
}) {
  const fields = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fields.current?.querySelector('button')?.focus({ preventScroll: true });
  }, []);
  const unlit = value.shading === 'normals';
  return (
    <section
      className="model-shading-panel"
      id={id}
      aria-label="Model shading"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <header>
        <strong>Shading</strong>
        <IconButton icon="close" label="Close shading controls" onClick={close} />
      </header>
      <div className="model-shading-fields" ref={fields}>
        <label>
          <span>Surface</span>
          <ChoiceButton
            label="Model surface"
            value={value.shading}
            choices={[
              { value: 'shaded', label: 'Original materials' },
              { value: 'clay', label: 'Clay' },
              { value: 'normals', label: 'Normals' },
            ]}
            onChoose={(shading) =>
              change({ ...value, shading: shading as ModelAppearance['shading'] })
            }
          />
        </label>
        <label>
          <span>Lighting</span>
          <ChoiceButton
            label="Model lighting"
            value={value.lighting}
            disabled={unlit}
            choices={[
              { value: 'studio', label: 'Studio' },
              { value: 'contrast', label: 'Contrast' },
              { value: 'soft', label: 'Soft' },
            ]}
            onChoose={(lighting) =>
              change({ ...value, lighting: lighting as ModelAppearance['lighting'] })
            }
          />
        </label>
        <label className="model-brightness">
          <span>
            Brightness <output>{Math.round(value.exposure * 100)}%</output>
          </span>
          <input
            aria-label="Model brightness"
            type="range"
            min="0.4"
            max="1.6"
            step="0.05"
            value={value.exposure}
            disabled={unlit}
            onChange={(event) => change({ ...value, exposure: Number(event.target.value) })}
          />
        </label>
        <label className="model-shading-toggle">
          <span>Show edges</span>
          <input
            type="checkbox"
            checked={value.edges}
            onChange={(event) => change({ ...value, edges: event.target.checked })}
          />
        </label>
        <label className="model-shading-toggle">
          <span>Shadows</span>
          <input
            type="checkbox"
            checked={value.shadows}
            disabled={unlit}
            onChange={(event) => change({ ...value, shadows: event.target.checked })}
          />
        </label>
        {hasDeformingMeshes && value.edges && (
          <p className="muted">
            Edges are shown on rigid meshes. Use Wireframe for animated surfaces.
          </p>
        )}
        <button onClick={() => change({ ...defaultModelAppearance })}>Reset shading</button>
      </div>
    </section>
  );
}
