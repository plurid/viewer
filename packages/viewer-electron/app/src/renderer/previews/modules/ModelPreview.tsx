import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import type { PreviewContext } from '../contracts';
import { Empty, IconButton, Loading } from '../../ui/primitives';

interface ModelSession {
  frame(): void;
  wireframe(value: boolean): void;
  animate(index: number, playing: boolean): void;
  active(value: boolean, interactive: boolean): void;
}
function disposeObject(object: THREE.Object3D): void {
  const materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
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
export default function ModelPreview({
  resource,
  signal,
  active,
  interactive,
  look,
}: PreviewContext) {
  const stage = useRef<HTMLDivElement>(null);
  const session = useRef<ModelSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [info, setInfo] = useState('');
  const [wire, setWire] = useState(false);
  const [animations, setAnimations] = useState<string[]>([]);
  const [animation, setAnimation] = useState(0);
  const [playing, setPlaying] = useState(false);
  const visibility = useRef({ active, interactive });
  visibility.current = { active, interactive };
  const playback = useRef({ wire, animation, playing });
  playback.current = { wire, animation, playing };
  useEffect(() => {
    session.current?.active(active, interactive);
  }, [active, interactive]);
  useEffect(() => {
    session.current?.wireframe(wire);
  }, [wire]);
  useEffect(() => {
    session.current?.animate(animation, playing);
  }, [animation, playing]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    setLoading(true);
    setError('');
    setWarnings([]);
    if (resource.entry.size > 256 * 1024 * 1024) {
      setError('Models larger than 256 MB need a streaming model adapter.');
      setLoading(false);
      return;
    }
    let disposed = false,
      object: THREE.Object3D | undefined,
      mixer: THREE.AnimationMixer | undefined,
      clips: THREE.AnimationClip[] = [];
    let frameRequest = 0,
      renderActive = visibility.current.active,
      controlsInteractive = visibility.current.interactive,
      runningAnimation = false,
      dirty = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(look === 'dark' ? '#292d34' : '#e9edf1');
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10000);
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
    renderer.toneMappingExposure = 1.2;
    element.append(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D model. Drag to orbit, right-drag to pan, scroll to zoom.',
    );
    renderer.domElement.tabIndex = 0;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.enabled = controlsInteractive;
    controls.addEventListener('change', () => {
      dirty = true;
      schedule();
    });
    // Native canvas listeners stop the event before Plurid's ancestor listeners see it.
    const isolate = (event: Event) => {
      if (controls.enabled) event.stopPropagation();
    };
    const wheel = (event: WheelEvent) => {
      if (controls.enabled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'contextmenu', 'dblclick'])
      renderer.domElement.addEventListener(type, isolate);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    scene.add(new THREE.HemisphereLight(0xffffff, 0x58616b, 2));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa7c9e5, 1.5);
    fill.position.set(-3, 2, -4);
    scene.add(fill);
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
        renderer.render(scene, camera);
        dirty = false;
      }
      if (runningAnimation || changed) schedule();
    }
    function frame() {
      if (!object) return;
      const box = new THREE.Box3().setFromObject(object);
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
        const library = /^mtllib\s+(.+)$/m.exec(source)?.[1].trim();
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
      } else {
        loaded = new FBXLoader(manager).parse(await response.arrayBuffer(), base);
        clips = loaded.animations;
      }
      if (disposed || signal.aborted) {
        disposeObject(loaded);
        return;
      }
      object = loaded;
      scene.add(loaded);
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
      setInfo(
        `${meshes.toLocaleString()} meshes · ${Math.round(triangles).toLocaleString()} triangles · ${vertices.toLocaleString()} vertices`,
      );
      setAnimations(clips.map((clip, index) => clip.name || `Animation ${index + 1}`));
      if (clips.length) mixer = new THREE.AnimationMixer(loaded);
      session.current = {
        frame,
        wireframe: (value) => {
          loaded.traverse((child) => {
            if (child instanceof THREE.Mesh)
              for (const material of Array.isArray(child.material)
                ? child.material
                : [child.material]) {
                if ('wireframe' in material)
                  (material as THREE.MeshStandardMaterial).wireframe = value;
              }
          });
          dirty = true;
          schedule();
        },
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
      setLoading(false);
    })().catch((error) => {
      if (!disposed && !abort.signal.aborted) {
        setError(error.message);
        setLoading(false);
      }
    });
    return () => {
      disposed = true;
      abort.abort();
      session.current = null;
      cancelAnimationFrame(frameRequest);
      resize.disconnect();
      controls.dispose();
      mixer?.stopAllAction();
      if (object) {
        mixer?.uncacheRoot(object);
        disposeObject(object);
      }
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'contextmenu', 'dblclick'])
        renderer.domElement.removeEventListener(type, isolate);
      renderer.domElement.removeEventListener('wheel', wheel);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [resource.id, resource.url, resource.entry.extension, resource.entry.size, look, signal]);
  return (
    <div className="model-viewer">
      <div className="preview-toolbar">
        <IconButton icon="frame" label="Frame model" onClick={() => session.current?.frame()} />
        <button
          className={wire ? 'selected' : ''}
          aria-pressed={wire}
          onClick={() => setWire(!wire)}
        >
          Wireframe
        </button>
        {animations.length > 0 && (
          <>
            <select
              aria-label="Model animation"
              value={animation}
              onChange={(event) => setAnimation(Number(event.target.value))}
            >
              {animations.map((name, index) => (
                <option key={index} value={index}>
                  {name}
                </option>
              ))}
            </select>
            <IconButton
              icon={playing ? 'pause' : 'play'}
              label={playing ? 'Pause animation' : 'Play animation'}
              onClick={() => setPlaying(!playing)}
            />
          </>
        )}
        <span className="toolbar-spacer" />
        <span className="muted">{resource.entry.extension.toUpperCase()}</span>
      </div>
      <div className="model-stage" ref={stage}>
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
      {warnings.length > 0 && (
        <p className="inline-warning">Missing companion assets: {warnings.join(', ')}</p>
      )}
      <footer className="model-info">
        <span>{info}</span>
        <span>Drag orbit · right-drag pan · scroll zoom</span>
      </footer>
    </div>
  );
}
