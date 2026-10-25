import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { cadFormats } from '../../../domain/previews/models/formats';
import { importCad } from '../model/cad';
import { printingScale } from '../model/printing';
import {
  cadMaterial,
  modelLighting,
  normalizeModelAppearance,
  defaultModelAppearance,
  type ModelAppearance,
} from '../model/appearance';
import { modelSurfaceAppearance } from '../model/surface-appearance';
import { ShadingControls } from '../model/ShadingControls';
import { pickModelSurface } from '../model/pick-surface';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { usePreviewState } from '../state';
import type { PreviewContext } from '../contracts';
import { Empty, IconButton, Loading } from '../../ui/primitives';
import { ChoiceButton } from '../../ui/ChoiceMenu';

interface ModelSession {
  frame(): void;
  wireframe(value: boolean): void;
  appearance(value: ModelAppearance): void;
  animate(index: number, playing: boolean): void;
  active(value: boolean, interactive: boolean): void;
  measure(value: boolean): void;
  clearMeasure(): void;
  background(look: 'dark' | 'light'): void;
}
const backgrounds = { dark: '#292d34', light: '#e9edf1' } as const;
function disposeObject(object: THREE.Object3D): void {
  const materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.Points
    ) {
      child.geometry.dispose();
      for (const material of Array.isArray(child.material) ? child.material : [child.material])
        materials.add(material);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    const image = texture.source?.data;
    if (image instanceof ImageBitmap) image.close();
    texture.dispose();
  }
}
export default function ModelPreview(context: PreviewContext) {
  const { resource, signal, active, interactive, look } = context;
  const stage = useRef<HTMLDivElement>(null);
  const session = useRef<ModelSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [contextLost, setContextLost] = useState(false);
  const [info, setInfo] = useState('');
  const [dimensions, setDimensions] = useState<number[]>([]);
  const [distance, setDistance] = useState<number>();
  const [measure, setMeasure] = usePreviewState(context, 'model.measure', false);
  const [assumedUnit, setAssumedUnit] = usePreviewState(context, 'model.unit', 'units');
  const physicalUnits =
    cadFormats.includes(resource.entry.extension) || resource.entry.extension === '3mf';
  const unit = physicalUnits ? 'mm' : assumedUnit;
  const [wire, setWire] = usePreviewState(context, 'model.wire', false);
  const [savedAppearance, saveAppearance] = usePreviewState<unknown>(
    context,
    'model.appearance',
    defaultModelAppearance,
  );
  const appearance = useMemo(() => normalizeModelAppearance(savedAppearance), [savedAppearance]);
  const [shadingOpen, setShadingOpen] = useState(false);
  const [hasDeformingMeshes, setHasDeformingMeshes] = useState(false);
  const shadingID = useId();
  const shadingButton = useRef<HTMLButtonElement>(null);
  const closeShading = () => {
    setShadingOpen(false);
    shadingButton.current?.focus({ preventScroll: true });
  };
  const [animations, setAnimations] = useState<string[]>([]);
  const [animation, setAnimation] = useState(0);
  const [playing, setPlaying] = useState(false);
  const visibility = useRef({ active, interactive });
  visibility.current = { active, interactive };
  const playback = useRef({ wire, animation, playing, measure, appearance, look });
  playback.current = { wire, animation, playing, measure, appearance, look };
  useEffect(() => {
    session.current?.active(active, interactive);
  }, [active, interactive]);
  useEffect(() => {
    session.current?.wireframe(wire);
  }, [wire]);
  useEffect(() => {
    session.current?.appearance(appearance);
  }, [appearance]);
  useEffect(() => {
    session.current?.animate(animation, playing);
  }, [animation, playing]);
  useEffect(() => {
    session.current?.measure(measure);
  }, [measure]);
  // A theme change recolors the live scene instead of reloading the model.
  useEffect(() => {
    session.current?.background(look);
  }, [look]);
  const maxModelMB = context.limits?.maxModelMB ?? 256;
  const previewStore = context.state;
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    setLoading(true);
    setError('');
    setWarnings([]);
    setDimensions([]);
    setDistance(undefined);
    setInfo('');
    setAnimations([]);
    if (resource.entry.size > maxModelMB * 1024 * 1024) {
      setError('This model exceeds the file limit in Settings.');
      setLoading(false);
      return;
    }
    let disposed = false,
      object: THREE.Object3D | undefined,
      surfaces: ReturnType<typeof modelSurfaceAppearance> | undefined,
      mixer: THREE.AnimationMixer | undefined,
      clips: THREE.AnimationClip[] = [];
    let frameRequest = 0,
      renderActive = visibility.current.active,
      controlsInteractive = visibility.current.interactive,
      runningAnimation = false,
      dirty = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgrounds[playback.current.look]);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10000);
    if (
      cadFormats.includes(resource.entry.extension) ||
      ['stl', '3mf'].includes(resource.entry.extension)
    )
      camera.up.set(0, 0, 1);
    const markings = new THREE.Group();
    scene.add(markings);
    const points: THREE.Vector3[] = [];
    let measuring = playback.current.measure;
    const clearMeasure = () => {
      disposeObject(markings);
      markings.clear();
      points.length = 0;
      previewStore?.set('model.measurement', []);
      setDistance(undefined);
      dirty = true;
      schedule();
    };
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (error) {
      setError(`3D graphics are unavailable: ${(error as Error).message}`);
      setLoading(false);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = playback.current.appearance.exposure;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    element.append(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D model. Drag to orbit, right-drag to pan, scroll to zoom.',
    );
    renderer.domElement.tabIndex = 0;
    const controls = new OrbitControls(camera, renderer.domElement);
    const remembered = previewStore?.get('model.camera') as
      { position?: number[]; target?: number[] } | undefined;
    let restoringView = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.enabled = controlsInteractive;
    // Orbiting changes the camera every frame; remember it at most every 250 ms.
    let cameraTimer: ReturnType<typeof setTimeout> | undefined;
    const rememberCamera = () => {
      clearTimeout(cameraTimer);
      cameraTimer = undefined;
      previewStore?.set('model.camera', {
        position: camera.position.toArray(),
        target: controls.target.toArray(),
      });
    };
    controls.addEventListener('change', () => {
      if (!restoringView && object) cameraTimer ??= setTimeout(rememberCamera, 250);
      dirty = true;
      schedule();
    });
    // Stop gesture initiation at the canvas. OrbitControls receives subsequent
    // pointer moves/up on ownerDocument, so those events must keep bubbling.
    const isolate = (event: Event) => {
      if (controls.enabled) event.stopPropagation();
    };
    const wheel = (event: WheelEvent) => {
      if (controls.enabled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    for (const type of ['pointerdown', 'contextmenu', 'dblclick'])
      renderer.domElement.addEventListener(type, isolate);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    let press: { x: number; y: number; id: number } | undefined;
    const down = (event: PointerEvent) => {
      press =
        event.button === 0 && measuring
          ? { x: event.clientX, y: event.clientY, id: event.pointerId }
          : undefined;
    };
    const pick = (event: PointerEvent) => {
      const start = press;
      press = undefined;
      if (
        !start ||
        start.id !== event.pointerId ||
        !measuring ||
        !controls.enabled ||
        !object ||
        Math.hypot(start.x - event.clientX, start.y - event.clientY) > 4
      )
        return;
      const point = pickModelSurface(
        object,
        camera,
        event,
        renderer.domElement.getBoundingClientRect(),
      );
      if (!point) return;
      if (points.length === 2) clearMeasure();
      addMeasurementPoint(point);
      previewStore?.set(
        'model.measurement',
        points.map((point) => point.toArray()),
      );
    };
    const addMeasurementPoint = (point: THREE.Vector3) => {
      if (!object) return;
      points.push(point.clone());
      const extent = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).length();
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(extent / 250, 0.0001), 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffc56a, depthTest: false }),
      );
      marker.position.copy(point);
      marker.renderOrder = 10;
      markings.add(marker);
      if (points.length === 2) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0xffc56a, depthTest: false }),
        );
        line.renderOrder = 10;
        markings.add(line);
        const [start, end] = points;
        if (start && end) setDistance(start.distanceTo(end));
      }
      dirty = true;
      schedule();
    };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointerup', pick);
    const lighting = modelLighting(scene, camera);
    const applyAppearance = (value: ModelAppearance, wireframe: boolean) => {
      renderer.toneMappingExposure = value.exposure;
      renderer.shadowMap.enabled = value.shadows && value.shading !== 'normals' && !wireframe;
      lighting.apply(value.lighting, renderer.shadowMap.enabled);
      surfaces?.apply(value, wireframe);
      dirty = true;
      schedule();
    };
    // Chromium caps live WebGL contexts; with many 3D planes the oldest can be taken.
    // Say so instead of leaving a blank view, and redraw once it is given back.
    const contextLost = (event: Event) => {
      event.preventDefault();
      if (!disposed) setContextLost(true);
    };
    const contextRestored = () => {
      if (disposed) return;
      setContextLost(false);
      dirty = true;
      schedule();
    };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
    let lastFrame = performance.now();
    function schedule() {
      if (!disposed && renderActive && !frameRequest) frameRequest = requestAnimationFrame(render);
    }
    function render() {
      frameRequest = 0;
      if (disposed || !renderActive) return;
      const now = performance.now(),
        delta = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      const changed = controls.update();
      if (mixer && runningAnimation) {
        mixer.update(delta);
        dirty = true;
      }
      if (dirty || changed) {
        lighting.update();
        renderer.render(scene, camera);
        dirty = false;
      }
      if (runningAnimation || changed) schedule();
    }
    function frame() {
      if (!object) return;
      const box = new THREE.Box3().setFromObject(object);
      lighting.fit(box);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z, 0.01);
      const distance = (extent / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 1.5;
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(distance * 0.7, distance * 0.5, distance));
      camera.near = Math.max(extent / 10000, 0.00001);
      camera.far = extent * 10000;
      camera.updateProjectionMatrix();
      controls.maxDistance = extent * 100;
      controls.minDistance = extent * 0.001;
      controls.update();
      dirty = true;
      schedule();
    }
    const resize = new ResizeObserver(() => {
      const width = Math.max(1, element.clientWidth),
        height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      dirty = true;
      schedule();
    });
    resize.observe(element);
    const manager = new THREE.LoadingManager();
    const missing = new Set<string>();
    const base = new URL('.', resource.url).href;
    manager.setURLModifier((url) => {
      if (/^(data:|blob:)/.test(url)) return url;
      const local = new URL(url, base);
      const scope = new URL(resource.url);
      if (local.protocol !== scope.protocol || local.host !== scope.host)
        throw new Error(
          'Network assets are disabled. Place model textures and buffers beside the model.',
        );
      return local.href;
    });
    manager.onError = (url) => {
      missing.add(decodeURIComponent(url.split('/').pop() || url));
      if (!disposed) setWarnings([...missing]);
    };
    const abort = new AbortController();
    void (async () => {
      const response = await fetch(resource.url, { signal: abort.signal });
      if (!response.ok) throw new Error('Model file is unavailable.');
      const ext = resource.entry.extension;
      let loaded: THREE.Object3D;
      if (ext === 'gltf' || ext === 'glb') {
        const data = ext === 'gltf' ? await response.text() : await response.arrayBuffer();
        const gltf = await new GLTFLoader(manager).parseAsync(data, base);
        loaded = gltf.scene;
        clips = gltf.animations;
      } else if (ext === 'obj') {
        const source = await response.text();
        const loader = new OBJLoader(manager);
        const library = /^mtllib\s+(.+)$/m.exec(source)?.[1]?.trim();
        if (library) {
          try {
            const mtlURL = manager.resolveURL(new URL(library, base).href);
            const mtl = await fetch(mtlURL, { signal: abort.signal });
            if (!mtl.ok) throw new Error(library);
            const materials = new MTLLoader(manager).parse(
              await mtl.text(),
              new URL('.', mtlURL).href,
            );
            materials.preload();
            loader.setMaterials(materials);
          } catch {
            missing.add(library);
            if (!disposed) setWarnings([...missing]);
          }
        }
        loaded = loader.parse(source);
      } else if (ext === 'stl') {
        const geometry = new STLLoader(manager).parse(await response.arrayBuffer());
        geometry.computeVertexNormals();
        loaded = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: 0xb5c4cc,
            roughness: 0.55,
            metalness: 0.08,
            side: THREE.DoubleSide,
          }),
        );
      } else if (cadFormats.includes(ext)) {
        if (resource.entry.size > 64 * 1024 * 1024)
          throw new Error('This CAD file exceeds the conversion limit (64 MB).');
        loaded = new THREE.Group();
        const meshes = await importCad(await response.arrayBuffer(), ext, abort.signal);
        for (const mesh of meshes) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
          geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
          if (mesh.normals)
            geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
          else geometry.computeVertexNormals();
          const part = new THREE.Mesh(geometry, cadMaterial(mesh.color));
          part.name = mesh.name;
          loaded.add(part);
        }
      } else if (ext === '3mf') {
        const data = await response.arrayBuffer();
        const scale = printingScale(data);
        loaded = new ThreeMFLoader(manager).parse(data);
        loaded.scale.multiplyScalar(scale);
      } else if (ext === 'ply') {
        const geometry = new PLYLoader(manager).parse(await response.arrayBuffer());
        geometry.computeVertexNormals();
        loaded = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: 0xb5c4cc,
            vertexColors: !!geometry.attributes.color,
            side: THREE.DoubleSide,
          }),
        );
      } else if (ext === 'fbx') {
        loaded = new FBXLoader(manager).parse(await response.arrayBuffer(), base);
        clips = loaded.animations;
      } else throw new Error('This 3D format is not supported.');
      if (disposed || signal.aborted) {
        disposeObject(loaded);
        return;
      }
      object = loaded;
      let meshes = 0,
        vertices = 0,
        triangles = 0;
      loaded.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshes++;
          vertices += child.geometry.attributes.position?.count || 0;
          triangles +=
            (child.geometry.index?.count || child.geometry.attributes.position?.count || 0) / 3;
        }
      });
      if (!meshes) throw new Error('No renderable geometry was found in this model.');
      if (vertices > 4000000 || triangles > 2000000)
        throw new Error('This model exceeds the geometry limit for previews.');
      const bounds = new THREE.Box3().setFromObject(loaded);
      if (
        bounds.isEmpty() ||
        [...bounds.min.toArray(), ...bounds.max.toArray()].some((value) => !Number.isFinite(value))
      )
        throw new Error('This model has invalid geometry.');
      setDimensions(bounds.getSize(new THREE.Vector3()).toArray());
      const retained = previewStore?.get('model.measurement');
      if (
        Array.isArray(retained) &&
        retained.length <= 2 &&
        retained.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 3 &&
            point.every((value) => typeof value === 'number' && Number.isFinite(value)) &&
            bounds.containsPoint(new THREE.Vector3(...(point as [number, number, number]))),
        )
      )
        for (const point of retained)
          addMeasurementPoint(new THREE.Vector3(...(point as [number, number, number])));
      scene.add(loaded);
      surfaces = modelSurfaceAppearance(loaded);
      setHasDeformingMeshes(surfaces.hasDeformingMeshes);
      setInfo(
        `${meshes.toLocaleString()} meshes · ${Math.round(triangles).toLocaleString()} triangles · ${vertices.toLocaleString()} vertices`,
      );
      setAnimations(clips.map((clip, index) => clip.name || `Animation ${index + 1}`));
      if (clips.length) mixer = new THREE.AnimationMixer(loaded);
      session.current = {
        frame,
        clearMeasure,
        background: (look) => {
          scene.background = new THREE.Color(backgrounds[look]);
          dirty = true;
          schedule();
        },
        measure: (value) => {
          measuring = value;
          if (!value) clearMeasure();
        },
        wireframe: (value) => applyAppearance(playback.current.appearance, value),
        appearance: (value) => applyAppearance(value, playback.current.wire),
        animate: (index, playing) => {
          mixer?.stopAllAction();
          if (clips[index]) mixer?.clipAction(clips[index]).play();
          runningAnimation = playing;
          dirty = true;
          schedule();
        },
        active: (value, input) => {
          renderActive = value;
          controlsInteractive = input;
          controls.enabled = value && input;
          lastFrame = performance.now();
          if (value) {
            dirty = true;
            schedule();
          } else {
            cancelAnimationFrame(frameRequest);
            frameRequest = 0;
          }
        },
      };
      session.current.wireframe(playback.current.wire);
      session.current.animate(playback.current.animation, playback.current.playing);
      session.current.active(visibility.current.active, visibility.current.interactive);
      frame();
      if (
        remembered?.position?.length === 3 &&
        remembered.target?.length === 3 &&
        [...remembered.position, ...remembered.target].every(Number.isFinite)
      ) {
        camera.position.fromArray(remembered.position);
        controls.target.fromArray(remembered.target);
        controls.update();
        dirty = true;
        schedule();
      }
      restoringView = false;
      setLoading(false);
    })().catch((error) => {
      if (!disposed && !abort.signal.aborted) {
        setError(error.message);
        setLoading(false);
      }
    });
    return () => {
      if (cameraTimer) rememberCamera();
      disposed = true;
      abort.abort();
      session.current = null;
      cancelAnimationFrame(frameRequest);
      resize.disconnect();
      controls.dispose();
      surfaces?.dispose();
      lighting.dispose();
      disposeObject(markings);
      mixer?.stopAllAction();
      if (object) {
        mixer?.uncacheRoot(object);
        disposeObject(object);
      }
      for (const type of ['pointerdown', 'contextmenu', 'dblclick'])
        renderer.domElement.removeEventListener(type, isolate);
      renderer.domElement.removeEventListener('wheel', wheel);
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointerup', pick);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [
    resource.id,
    resource.url,
    resource.entry.extension,
    resource.entry.size,
    maxModelMB,
    previewStore,
    signal,
  ]);
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'model-measure',
          label: measure ? 'Stop measuring model' : 'Measure model distance',
          available: !loading && !error,
          run: () => setMeasure((value) => !value),
        },
        {
          id: 'model-frame',
          label: 'Frame model',
          aliases: ['fm'],
          primary: true,
          available: !loading && !error,
          run: () => session.current?.frame(),
        },
        {
          id: 'model-wireframe',
          label: wire ? 'Hide wireframe' : 'Show wireframe',
          aliases: ['wf'],
          available: !loading && !error,
          run: () => setWire((value) => !value),
        },
        {
          id: 'model-shading',
          label: shadingOpen ? 'Hide shading controls' : 'Model shading…',
          aliases: ['lighting', 'clay', 'shadows', 'brightness'],
          available: !loading && !error,
          run: () => setShadingOpen((value) => !value),
        },
        {
          id: 'model-playback',
          label: playing ? 'Pause animation' : 'Play animation',
          available: animations.length > 0 && !error,
          run: () => setPlaying((value) => !value),
        },
        ...animations.map((name, index) => ({
          id: `model-animation-${index}`,
          label: `Play ${name}`,
          available: !error,
          run: () => {
            setAnimation(index);
            setPlaying(true);
          },
        })),
      ],
      [loading, error, wire, playing, animations, measure, shadingOpen, setMeasure, setWire],
    ),
  );
  return (
    <div className="model-viewer">
      <PreviewToolbar context={context}>
        <IconButton
          icon="frame"
          label="Frame model"
          disabled={loading || !!error}
          onClick={() => session.current?.frame()}
        />
        <button
          className={measure ? 'selected' : ''}
          aria-pressed={measure}
          disabled={loading || !!error}
          onClick={() => setMeasure(!measure)}
        >
          Measure
        </button>
        <button
          className={wire ? 'selected' : ''}
          aria-pressed={wire}
          disabled={loading || !!error}
          onClick={() => setWire(!wire)}
        >
          Wireframe
        </button>
        <button
          ref={shadingButton}
          className={shadingOpen ? 'selected' : ''}
          aria-expanded={shadingOpen}
          aria-controls={shadingID}
          disabled={loading || !!error}
          onClick={() => setShadingOpen((value) => !value)}
        >
          Shading
        </button>
        {animations.length > 0 && (
          <>
            <ChoiceButton
              label="Model animation"
              value={String(animation)}
              choices={animations.map((name, index) => ({ value: String(index), label: name }))}
              onChoose={(value) => setAnimation(Number(value))}
            />
            <IconButton
              icon={playing ? 'pause' : 'play'}
              label={playing ? 'Pause animation' : 'Play animation'}
              onClick={() => setPlaying(!playing)}
            />
          </>
        )}
        <span className="toolbar-spacer" />
        {!physicalUnits && (
          // the button takes no title of its own: its wrapper shows the tooltip
          <span title="This format does not declare physical units. Choose the units used when it was exported.">
            <ChoiceButton
              label="Assumed model units"
              value={assumedUnit}
              choices={[
                { value: 'units', label: 'Model units' },
                { value: 'mm', label: 'Millimeters' },
                { value: 'cm', label: 'Centimeters' },
                { value: 'm', label: 'Meters' },
                { value: 'in', label: 'Inches' },
              ]}
              onChoose={setAssumedUnit}
            />
          </span>
        )}
        <span className="muted">{resource.entry.extension.toUpperCase()}</span>
      </PreviewToolbar>
      <div className="model-stage" ref={stage}>
        {shadingOpen && !loading && !error && (
          <ShadingControls
            id={shadingID}
            value={appearance}
            change={saveAppearance}
            close={closeShading}
            hasDeformingMeshes={hasDeformingMeshes}
          />
        )}
        {loading && (
          <div className="preview-overlay">
            <Loading label="Loading model…" />
          </div>
        )}
        {error && (
          <div className="preview-overlay">
            <Empty icon="model" title="Model could not be loaded" detail={error} />
          </div>
        )}
      </div>
      {contextLost && (
        <p className="inline-warning" role="status">
          The 3D view was paused to free graphics memory. Close other 3D previews or reopen this one
          to show it again.
        </p>
      )}
      {warnings.length > 0 && (
        <p className="inline-warning">Missing companion assets: {warnings.join(', ')}</p>
      )}
      <footer className="model-info">
        <span title={info} className="model-dimensions">
          {dimensions.length > 0 &&
            `${dimensions.map((value) => value.toLocaleString(undefined, { maximumFractionDigits: 3 })).join(' × ')} ${unit}`}
        </span>
        {measure ? (
          <span className="model-measurement" role="status">
            {distance === undefined
              ? 'Click two surface points · drag to orbit'
              : `Distance: ${distance.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}`}
            <button onClick={() => session.current?.clearMeasure()}>Clear</button>
          </span>
        ) : (
          <span className="model-statistics">{info}</span>
        )}
      </footer>
    </div>
  );
}
