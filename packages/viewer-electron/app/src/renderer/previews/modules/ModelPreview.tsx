import { resourceStatusMessage } from '../../../domain/previews/resource-status';
import { previewProblem } from '../preview-problem';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { importMesh, meshObjects } from '../model/mesh';
import { meshTriangleLimit, meshVertexLimit } from '../model/mesh-data';
import type { MeshResult } from '../model/mesh-data';
import { fileName, isSceneFormat, loadScene, sceneNotices } from '../model/scenes';
import { assertModelMemory } from '../model/memory';
import { cadFormats } from '../../../domain/previews/models/formats';
import { cadObject, importCad, retainCadWorker } from '../model/cad';
import { modelCacheKey, modelGeometryCache } from '../model/cache';
import type { ParsedModel } from '../model/cache';
import { printingScale } from '../model/printing';
import {
  modelLighting,
  normalizeModelAppearance,
  defaultModelAppearance,
} from '../model/appearance';
import type { ModelAppearance } from '../model/appearance';
import { modelSurfaceAppearance } from '../model/surface-appearance';
import { ShadingControls } from '../model/ShadingControls';
import { pickModelSurface } from '../model/pick-surface';
import {
  defaultModelUp,
  modelNavigation,
  modelRotation,
  readModelCamera,
} from '../model/navigation';
import type { ModelCamera, ModelRotation } from '../model/navigation';
import { homeOffset, standardModelView } from '../model/viewcube';
import type { CubeView } from '../model/viewcube';
import { ModelViewCube } from '../model/ModelViewCube';
import type { ModelViewCubeHandle } from '../model/ModelViewCube';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { headerItem } from '../../workspace/header-overflow';
import { usePreviewState } from '../state';
import type { PreviewContext } from '../contracts';
import { IconButton, Loading } from '../../ui/primitives';
import { PreviewFailure } from '../PreviewFailure';
import { plural } from '../../../domain/plural';
import { ChoiceButton } from '../../ui/ChoiceMenu';
import type { Look } from '../../../domain/contracts';

interface ModelSession {
  frame(): void;
  /** Turns to the fitted starting view, as Frame model places it. */
  home(): void;
  /** Turns to a standard view of the cube. */
  standardView(view: CubeView): void;
  turnStart(): void;
  turn(x: number, y: number): void;
  /** A wheel over the cube zooms or pans as it would over the canvas. */
  wheel(event: WheelEvent): void;
  /** Zooms by whole notches, in for positive steps. */
  zoom(steps: number): void;
  rotation(value: ModelRotation): void;
  /** Places the camera at `position`, looking at `target`, in the model's coordinates. */
  view(position: readonly number[], target: readonly number[]): void;
  wireframe(value: boolean): void;
  appearance(value: ModelAppearance): void;
  animate(index: number, playing: boolean): void;
  active(value: boolean, interactive: boolean): void;
  measure(value: boolean): void;
  clearMeasure(): void;
  background(look: Look): void;
}
const backgrounds = { dark: '#292d34', light: '#e9edf1' } as const;
/** A cube turn's length; with reduced motion the view changes at once. */
const turnMilliseconds = 320;
function turnDuration(): number {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : turnMilliseconds;
}
interface LoadedModel {
  object: THREE.Object3D;
  notes: string[];
  /** The workers' arrays, kept for the next preview of this file version. */
  parsed?: ParsedModel;
}
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
  const viewCube = useRef<ModelViewCubeHandle>(null);
  const cacheKey = modelCacheKey(resource);
  // A remembered model shows in the first paint, without a loading state.
  const [loading, setLoading] = useState(() => !modelGeometryCache.has(cacheKey));
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [contextLost, setContextLost] = useState(false);
  const [info, setInfo] = useState('');
  const [dimensions, setDimensions] = useState<number[]>([]);
  const [distance, setDistance] = useState<number>();
  const [rotation, setRotation] = useState<ModelRotation>(() =>
    modelRotation(resource.entry.extension, context.state?.get('model.camera')),
  );
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
  // Read at each wheel event, so a change in Settings applies to an open preview.
  const scrollDevice = useRef(context.limits?.modelScrollDevice ?? 'automatic');
  scrollDevice.current = context.limits?.modelScrollDevice ?? 'automatic';
  const playback = useRef({ wire, animation, playing, measure, appearance, look, rotation });
  playback.current = { wire, animation, playing, measure, appearance, look, rotation };
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
  useEffect(() => {
    session.current?.rotation(rotation);
  }, [rotation]);
  // A theme change recolors the live scene instead of reloading the model.
  useEffect(() => {
    session.current?.background(look);
  }, [look]);
  // Evidence places the camera once the model has loaded, and again whenever it changes.
  const anchor = context.evidence?.anchor.kind === 'model' ? context.evidence.anchor : undefined;
  useEffect(() => {
    if (anchor && !loading) session.current?.view(anchor.position, anchor.target);
  }, [anchor, loading]);
  const maxModelMB = context.limits?.maxModelMB ?? 256;
  const previewStore = context.state;
  // OCCT stays loaded while any 3D preview is open, and for a while after the last one closes.
  useEffect(() => retainCadWorker(), []);
  // OrbitControls disconnects keyboard listeners from canvas.getRootNode().
  // Dispose while the canvas still belongs to that root, before React detaches it.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const cached = modelGeometryCache.get(cacheKey);
    // An OBJ's material library is read again, as it can change apart from the OBJ.
    const library =
      cached?.kind === 'mesh' && resource.entry.extension === 'obj'
        ? cached.data.libraries[0]
        : undefined;
    const instant = cached && !library;
    setLoading(!instant);
    setError('');
    setWarnings([]);
    setNotices([]);
    setDimensions([]);
    setDistance(undefined);
    setInfo('');
    setAnimations([]);
    if (resource.entry.size > maxModelMB * 1_000_000) {
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
      graphicsFailed = false,
      memoryCheck = true,
      runningAnimation = false,
      dirty = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgrounds[playback.current.look]);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10000);
    camera.up.fromArray(defaultModelUp(resource.entry.extension));
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
      setError(
        previewProblem(
          error,
          "3D graphics couldn't start. Close other 3D previews, then try again.",
        ),
      );
      setLoading(false);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = playback.current.appearance.exposure;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // First in the stage, so Tab reaches the model before the view cube.
    element.prepend(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D model. Drag to rotate, right-drag or two-finger scroll to pan, mouse wheel or pinch to zoom. Arrow keys pan, Shift+arrows rotate, plus and minus zoom, Home resets the view.',
    );
    renderer.domElement.tabIndex = 0;
    const remembered = readModelCamera(resource.entry.extension, previewStore?.get('model.camera'));
    let restoringView = true;
    // Damping changes the camera every frame; remember it at most every 250 ms.
    let cameraTimer: ReturnType<typeof setTimeout> | undefined;
    const rememberCamera = () => {
      clearTimeout(cameraTimer);
      cameraTimer = undefined;
      previewStore?.set('model.camera', controls.snapshot());
    };
    const controls = modelNavigation(
      camera,
      renderer.domElement,
      playback.current.rotation,
      {
        change: () => {
          if (!restoringView && object) cameraTimer ??= setTimeout(rememberCamera, 250);
          dirty = true;
          schedule();
        },
        wake: schedule,
        frame: () => frame(),
      },
      {
        top: defaultModelUp(resource.entry.extension),
        scrollDevice: () => scrollDevice.current,
      },
    );
    controls.enabled = renderActive && controlsInteractive;
    const flushCamera = () => {
      if (cameraTimer && !disposed) rememberCamera();
    };
    window.addEventListener('pagehide', flushCamera);
    window.addEventListener('viewer-preview-flush', flushCamera);
    // Stop gesture initiation at the canvas. Both controls receive subsequent
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
        event.button === 0 && measuring && controls.enabled
          ? { x: event.clientX, y: event.clientY, id: event.pointerId }
          : undefined;
    };
    const move = (event: PointerEvent) => {
      // Crossing the threshold makes a drag even if the pointer returns to its start.
      if (press && Math.hypot(press.x - event.clientX, press.y - event.clientY) > 4)
        press = undefined;
    };
    const cancelPress = () => {
      press = undefined;
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
    renderer.domElement.ownerDocument.addEventListener('pointermove', move);
    renderer.domElement.ownerDocument.addEventListener('pointerup', cancelPress);
    renderer.domElement.ownerDocument.addEventListener('pointercancel', cancelPress);
    const lighting = modelLighting(scene, camera);
    const applyAppearance = (value: ModelAppearance, wireframe: boolean) => {
      renderer.toneMappingExposure = value.exposure;
      renderer.shadowMap.enabled = value.shadows && value.shading !== 'normals' && !wireframe;
      lighting.apply(value.lighting, renderer.shadowMap.enabled);
      surfaces?.apply(value, wireframe);
      memoryCheck = true;
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
      if (!disposed && !graphicsFailed && renderActive && !frameRequest)
        frameRequest = requestAnimationFrame(render);
    }
    function render() {
      frameRequest = 0;
      if (disposed || graphicsFailed || !renderActive) return;
      const now = performance.now(),
        delta = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      const changed = controls.update();
      if (mixer && runningAnimation) {
        mixer.update(delta);
        dirty = true;
      }
      if (dirty || changed) {
        try {
          if (object && memoryCheck) assertModelMemory(object);
          memoryCheck = false;
          lighting.update();
          renderer.render(scene, camera);
          viewCube.current?.update(camera);
        } catch (error) {
          graphicsFailed = true;
          setError(previewProblem(error, "Viewer couldn't draw this model."));
          setLoading(false);
          return;
        }
        dirty = false;
      }
      if (runningAnimation || changed) schedule();
    }
    /** The fitted starting view; it also sets the clipping planes and distance limits. */
    function fitted(): ModelCamera | undefined {
      if (!object) return;
      const box = new THREE.Box3().setFromObject(object);
      lighting.fit(box);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z, 0.01);
      const distance = (extent / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 1.5;
      camera.near = Math.max(extent / 10000, 0.00001);
      camera.far = extent * 10000;
      camera.updateProjectionMatrix();
      controls.maxDistance = extent * 100;
      controls.minDistance = extent * 0.001;
      return {
        ...controls.snapshot(),
        target: center.toArray(),
        position: center
          .clone()
          .addScaledVector(homeOffset(resource.entry.extension), distance)
          .toArray(),
        up: defaultModelUp(resource.entry.extension),
      };
    }
    function frame(turn = false) {
      const view = fitted();
      if (!view) return;
      if (turn) controls.animate(view, turnDuration());
      else controls.view(view);
      dirty = true;
      schedule();
    }
    const resize = new ResizeObserver(() => {
      const width = Math.max(1, element.clientWidth),
        height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height, false);
      controls.resize();
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      dirty = true;
      schedule();
    });
    resize.observe(element);
    const manager = new THREE.LoadingManager();
    const assetsChanged = () => {
      if (!disposed) {
        memoryCheck = true;
        dirty = true;
        schedule();
      }
    };
    manager.onLoad = assetsChanged;
    manager.onProgress = assetsChanged;
    const missing = new Set<string>();
    const base = new URL('.', resource.url).href;
    manager.setURLModifier((url) => {
      if (/^(data:|blob:)/.test(url)) return url;
      const local = new URL(url, base);
      const scope = new URL(resource.url);
      if (local.protocol !== scope.protocol || local.host !== scope.host)
        throw new Error(
          "This model loads files from the internet, which Viewer doesn't do. Put its textures next to the model file.",
        );
      return local.href;
    });
    manager.onError = (url) => {
      missing.add(fileName(url));
      if (!disposed) setWarnings([...missing]);
    };
    const abort = new AbortController();
    const begun = modelGeometryCache.begin();
    const materialLibrary = async (library: string | undefined) => {
      if (!library) return;
      try {
        const url = manager.resolveURL(new URL(library, base).href);
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error(library);
        const materials = new MTLLoader(manager).parse(
          await response.text(),
          new URL('.', url).href,
        );
        materials.preload();
        return materials;
      } catch {
        missing.add(library);
        if (!disposed) setWarnings([...missing]);
      }
    };
    type Materials = Awaited<ReturnType<typeof materialLibrary>>;
    /** A mesh parse two previews of one file version share. */
    const shared = (parse: (signal: AbortSignal) => Promise<MeshResult>) =>
      modelGeometryCache.share(
        cacheKey,
        resource.entry.path,
        async (signal): Promise<ParsedModel> => ({ kind: 'mesh', data: await parse(signal) }),
        abort.signal,
      );
    const parsedObject = (parsed: ParsedModel, materials?: Materials) =>
      parsed.kind === 'cad' ? cadObject(parsed.meshes) : meshObjects(parsed.data, materials);
    const load = async (): Promise<LoadedModel> => {
      if (cached) {
        const materials = await materialLibrary(library);
        return { object: parsedObject(cached, materials), notes: [], parsed: cached };
      }
      const response = await fetch(resource.url, { signal: abort.signal });
      if (!response.ok)
        throw new Error(
          resourceStatusMessage(response.status) ??
            "Couldn't read this model file. Check that it's still there, then try again.",
        );
      const ext = resource.entry.extension;
      if (ext === 'gltf' || ext === 'glb') {
        const data = ext === 'gltf' ? await response.text() : await response.arrayBuffer();
        const gltf = await new GLTFLoader(manager).parseAsync(data, base);
        clips = gltf.animations;
        return { object: gltf.scene, notes: [] };
      }
      if (ext === 'obj') {
        const source = await response.text();
        const parsing = shared((signal) => importMesh(source, 'obj', signal));
        // Attach the rejection immediately while a companion request is pending.
        void parsing.catch(() => {});
        const materials = await materialLibrary(/^mtllib\s+(.+)$/m.exec(source)?.[1]?.trim());
        const parsed = await parsing;
        return { object: parsedObject(parsed, materials), notes: [], parsed };
      }
      if (ext === 'stl' || ext === 'ply' || ext === 'off') {
        const source = ext === 'off' ? await response.text() : await response.arrayBuffer();
        const parsed = await shared((signal) => importMesh(source, ext, signal));
        return { object: parsedObject(parsed), notes: [], parsed };
      }
      if (cadFormats.includes(ext)) {
        if (resource.entry.size > 64_000_000)
          throw new Error('This CAD file exceeds the conversion limit (64 MB).');
        const buffer = await response.arrayBuffer();
        const parsed = await modelGeometryCache.share(
          cacheKey,
          resource.entry.path,
          async (signal) => ({ kind: 'cad', meshes: await importCad(buffer, ext, signal) }),
          abort.signal,
        );
        return { object: parsedObject(parsed), notes: [], parsed };
      }
      if (ext === '3mf') {
        const data = await response.arrayBuffer();
        const scale = printingScale(data);
        const object = new ThreeMFLoader(manager).parse(data);
        object.scale.multiplyScalar(scale);
        return { object, notes: [] };
      }
      if (ext === 'fbx') {
        const object = new FBXLoader(manager).parse(await response.arrayBuffer(), base);
        clips = object.animations;
        return { object, notes: [] };
      }
      if (isSceneFormat(ext)) {
        const scene = await loadScene(ext, resource.entry.size, response, abort.signal);
        clips = scene.clips;
        return { object: scene.object, notes: sceneNotices(scene) };
      }
      throw new Error('This 3D format is not supported.');
    };
    const show = ({ object: loaded, notes, parsed }: LoadedModel) => {
      if (disposed || signal.aborted) {
        disposeObject(loaded);
        return;
      }
      object = loaded;
      assertModelMemory(loaded);
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
      if (vertices > meshVertexLimit || triangles > meshTriangleLimit)
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
        [
          plural(meshes, 'mesh', 'meshes'),
          plural(Math.round(triangles), 'triangle'),
          plural(vertices, 'vertex', 'vertices'),
        ].join(' · '),
      );
      setNotices(notes);
      setAnimations(clips.map((clip, index) => clip.name || `Animation ${index + 1}`));
      if (clips.length) mixer = new THREE.AnimationMixer(loaded);
      session.current = {
        frame: () => frame(),
        home: () => frame(true),
        standardView: (view) =>
          controls.animate(
            standardModelView(view, resource.entry.extension, controls.destination()),
            turnDuration(),
          ),
        turnStart: () => controls.hold(),
        turn: (x, y) => controls.turn(x, y),
        // The event itself: its legacy deltas and momentum tell a mouse from a trackpad.
        wheel: (event) => controls.wheel(event),
        zoom: (steps) => controls.zoom(steps),
        // A remembered model has its session before the effects' first run: those calls only
        // repeat what the session already holds, and must not save or clear anything.
        rotation: (value) => {
          if (controls.snapshot().rotation === value) return;
          controls.rotation(value, turnDuration());
          rememberCamera();
        },
        view: (position, target) => {
          controls.view({ ...controls.snapshot(), position: [...position], target: [...target] });
        },
        clearMeasure,
        background: (look) => {
          scene.background = new THREE.Color(backgrounds[look]);
          dirty = true;
          schedule();
        },
        measure: (value) => {
          if (measuring === value) return;
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
      if (remembered) controls.view({ ...remembered, rotation: playback.current.rotation });
      restoringView = false;
      // Only a model that is shown is remembered: a failed or cancelled parse never is.
      if (parsed) modelGeometryCache.set(cacheKey, resource.entry.path, parsed, begun);
      setLoading(false);
    };
    const fail = (error: unknown) => {
      if (!disposed && !abort.signal.aborted) {
        setError(
          previewProblem(
            error,
            "Viewer couldn't read the shapes in this model.",
            resource.entry.extension,
          ),
        );
        setLoading(false);
      }
    };
    if (cached && instant) {
      try {
        show({ object: parsedObject(cached), notes: [], parsed: cached });
      } catch (error) {
        fail(error);
      }
    } else void load().then(show).catch(fail);
    return () => {
      if (cameraTimer) rememberCamera();
      window.removeEventListener('pagehide', flushCamera);
      window.removeEventListener('viewer-preview-flush', flushCamera);
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
      renderer.domElement.ownerDocument.removeEventListener('pointermove', move);
      renderer.domElement.ownerDocument.removeEventListener('pointerup', cancelPress);
      renderer.domElement.ownerDocument.removeEventListener('pointercancel', cancelPress);
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
    resource.entry.path,
    resource.entry.size,
    cacheKey,
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
          aliases: ['fm', 'reset view', 'reset rotation'],
          primary: true,
          available: !loading && !error,
          run: () => session.current?.frame(),
        },
        {
          id: 'model-rotation',
          label: rotation === 'free' ? 'Use turntable rotation' : 'Use free rotation',
          aliases: ['rotation', 'free', 'turntable', 'trackball', 'tumble'],
          available: !loading && !error,
          run: () => setRotation((value) => (value === 'free' ? 'turntable' : 'free')),
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
      [
        loading,
        error,
        wire,
        playing,
        animations,
        measure,
        shadingOpen,
        rotation,
        setMeasure,
        setWire,
      ],
    ),
  );
  return (
    <div className="model-viewer">
      <PreviewToolbar context={context}>
        <IconButton
          {...headerItem('fit', 3, ['preview.model-frame'])}
          icon="fit"
          label="Frame model"
          disabled={loading || !!error}
          onClick={() => session.current?.frame()}
        />
        <button
          {...headerItem('measure', 4, ['preview.model-measure'])}
          className={measure ? 'selected' : ''}
          aria-pressed={measure}
          disabled={loading || !!error}
          onClick={() => setMeasure(!measure)}
        >
          Measure
        </button>
        {/* Essential leaves Wireframe to "…" */}
        {context.toolbar !== 'essential' && (
          <>
            <button
              {...headerItem('wireframe', 7, ['preview.model-wireframe'])}
              className={wire ? 'selected' : ''}
              aria-pressed={wire}
              disabled={loading || !!error}
              onClick={() => setWire(!wire)}
            >
              Wireframe
            </button>
            <span {...headerItem('rotation', 8, ['preview.model-rotation'])}>
              <ChoiceButton
                label="Rotation"
                value={rotation}
                choices={[
                  { value: 'free', label: 'Free' },
                  { value: 'turntable', label: 'Turntable' },
                ]}
                disabled={loading || !!error}
                onChoose={(value) => setRotation(value === 'free' ? 'free' : 'turntable')}
              />
            </span>
          </>
        )}
        <button
          {...headerItem('shading', 6, ['preview.model-shading'])}
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
              {...headerItem('playback', 5, ['preview.model-playback'])}
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
        <span className="muted" {...headerItem('format', 9, 'detail')}>
          {resource.entry.extension.toUpperCase()}
        </span>
      </PreviewToolbar>
      <div className="model-stage" ref={stage}>
        <ModelViewCube
          ref={viewCube}
          extension={resource.entry.extension}
          hidden={loading || !!error || contextLost}
          inactive={!active || !interactive}
          choose={(view) => session.current?.standardView(view)}
          home={() => session.current?.home()}
          turnStart={() => session.current?.turnStart()}
          turn={(x, y) => session.current?.turn(x, y)}
          wheel={(event) => session.current?.wheel(event)}
          zoom={(steps) => session.current?.zoom(steps)}
        />
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
            <PreviewFailure
              context={context}
              icon="model"
              title="Can't show this model"
              detail={error}
            />
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
        <p className="inline-warning">Missing files next to the model: {warnings.join(', ')}</p>
      )}
      {notices.map((notice) => (
        <p key={notice} className="inline-warning">
          {notice}
        </p>
      ))}
      <footer className="model-info">
        <span title={info} className="model-dimensions">
          {dimensions.length > 0 &&
            `${dimensions.map((value) => value.toLocaleString(undefined, { maximumFractionDigits: 3 })).join(' × ')} ${unit}`}
        </span>
        {measure ? (
          <span className="model-measurement" role="status">
            {distance === undefined
              ? 'Click two surface points · drag to rotate'
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
