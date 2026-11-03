import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
const api = window.viewerCanvas;
const library = api.assets.find((asset) => asset.name === 'robotics.js');
if (!library) throw new Error('Attach the robotics plugin library.');
const { createWorkbench, forwardKinematics, originTransform, multiplyTransforms } = await import(
  library.url
);
const source = api.getSources().find((s) => s.name.endsWith('.urdf'));
const briefSource = api.getSources().find((s) => s.name === 'station.json');
if (!source || !briefSource) throw new Error('Attach the robot and station.json snapshots.');
const text = (snapshot) => snapshot.data.evidence.map((e) => e.text ?? '').join('\n');
const workbench = createWorkbench(text(source), JSON.parse(text(briefSource)));
const { robot, brief, zero } = workbench;
const region = { min: [0.14, 0.12], max: [0.26, 0.24] };
let current = api.getState();
let targetIndex = current.ui?.targetIndex ?? 0;
const $ = (id) => document.getElementById(id);
const progress = $('progress');
const schema = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
api.registerAction(
  {
    id: 'evaluate',
    label: 'Evaluate mounting points',
    inputSchema: schema({ reserved: { type: 'boolean' }, targetOffsetX: { type: 'number' } }),
  },
  async (input, { signal }) => {
    const study = await workbench.evaluate(input, signal, (label) => {
      progress.textContent = label;
    });
    return {
      result: study,
      patch: { study, reserved: input.reserved, targetOffsetX: input.targetOffsetX },
    };
  },
);
api.registerAction(
  {
    id: 'select',
    label: 'Select mounting point',
    inputSchema: schema({ mount: { type: 'string' } }),
  },
  (input, { state }) => {
    const candidate = state.study?.candidates?.find((c) => c.id === input.mount);
    if (!candidate?.eligible) throw new Error('Evaluate and choose an eligible mounting point.');
    return { result: { selected: input.mount }, patch: { selected: input.mount } };
  },
);
const probe = schema({
  mount: { type: 'string' },
  joints: { type: 'string' },
  targetX: { type: 'number' },
  targetY: { type: 'number' },
  targetZ: { type: 'number' },
  tolerance: { type: 'number' },
  limitJoint: { type: 'string' },
  limitLower: { type: 'number' },
  limitUpper: { type: 'number' },
});
probe.required = ['mount', 'joints', 'targetX', 'targetY', 'targetZ', 'tolerance'];
api.registerAction({ id: 'inspectPose', label: 'Check a pose', inputSchema: probe }, (input) => ({
  result: workbench.inspectPose(input),
}));
api.registerAction(
  { id: 'selfTest', label: 'Test plugin calculations', inputSchema: schema({}) },
  () => ({ result: workbench.selfTest() }),
);
api.registerAction(
  { id: 'check', label: 'Check saved poses', inputSchema: schema({}) },
  (_input, { state }) => {
    if (!state.study?.candidates?.length) throw new Error('Evaluate the mounting points first.');
    return {
      result: workbench.check(state.study.candidates, !!state.reserved, state.targetOffsetX ?? 0),
    };
  },
);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#272a30');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
$('scene').prepend(renderer.domElement);
const camera = new THREE.PerspectiveCamera(36, 1, 0.001, 10);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
function resetView() {
  camera.position.set(0.85, -0.62, 0.73);
  controls.target.set(0.3, 0.18, 0.08);
  controls.update();
}
resetView();
if (current.camera) {
  camera.position.fromArray(current.camera.position);
  controls.target.fromArray(current.camera.target);
  controls.update();
}
scene.add(new THREE.HemisphereLight(0xffffff, 0x414954, 2.8));
const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(1, -1, 2);
scene.add(light);
const bench = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 0.4, 0.008),
  new THREE.MeshStandardMaterial({ color: '#393e47', roughness: 0.9 }),
);
bench.position.set(0.3, 0.2, -0.006);
scene.add(bench);
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(bench.geometry),
  new THREE.LineBasicMaterial({ color: '#737e8c' }),
);
outline.position.copy(bench.position);
scene.add(outline);
for (const x of [0.44, 0.52]) {
  const tray = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.06, 0.18, 0.014)),
    new THREE.LineBasicMaterial({ color: '#82909e' }),
  );
  tray.position.set(x, 0.16, 0.001);
  scene.add(tray);
}
const markers = brief.targets.map((t) => {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 16, 12),
    new THREE.MeshBasicMaterial({ color: '#82b3cf' }),
  );
  mesh.position.fromArray(t.position);
  scene.add(mesh);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...t.position),
      new THREE.Vector3(t.position[0], t.position[1], 0),
    ]),
    new THREE.LineBasicMaterial({ color: '#59616d' }),
  );
  scene.add(line);
  mesh.userData.targetLine = line;
  return mesh;
});
const labels = brief.targets.map((target) => {
  const label = document.createElement('span');
  label.className = 'target-label';
  label.textContent = target.id;
  $('scene').append(label);
  return label;
});
function renderScene() {
  renderer.render(scene, camera);
  labels.forEach((label, index) => {
    const point = markers[index].position.clone().project(camera);
    label.style.left = ((point.x + 1) * $('scene').clientWidth) / 2 + 10 + 'px';
    label.style.top = ((1 - point.y) * $('scene').clientHeight) / 2 - 14 + 'px';
    label.hidden = point.z > 1 || point.z < -1;
  });
}
const reserved = new THREE.Mesh(
  new THREE.PlaneGeometry(0.12, 0.12),
  new THREE.MeshBasicMaterial({
    color: '#aa8a62',
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  }),
);
reserved.position.set(0.2, 0.18, 0);
scene.add(reserved);
const mountMarkers = brief.mounts.map((m) => {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.008, 0.01, 32),
    new THREE.MeshBasicMaterial({ color: '#b1bac6', side: THREE.DoubleSide }),
  );
  marker.position.fromArray(m.base.xyz);
  marker.position.z = 0.002;
  scene.add(marker);
  return marker;
});
const loader = new STLLoader(),
  geometry = new Map();
const resources = [
  ...new Set(
    robot.links.flatMap((link) =>
      link.visuals.flatMap((visual) =>
        visual.geometry.kind === 'mesh' ? [visual.geometry.resource] : [],
      ),
    ),
  ),
];
for (const resource of resources) {
  const name = resource.split('/').at(-1);
  const matches = api.assets.filter((asset) => asset.name === name);
  if (matches.length !== 1) throw new Error('Attach one mesh named ' + name + '.');
  const response = await fetch(matches[0].url);
  if (!response.ok) throw new Error('Mesh unavailable: ' + name);
  geometry.set(resource, loader.parse(await response.arrayBuffer()));
}
const visuals = [];
for (const link of robot.links)
  for (const visual of link.visuals) {
    if (visual.geometry.kind !== 'mesh') continue;
    const shape = geometry.get(visual.geometry.resource);
    if (!shape) throw new Error('Missing robot geometry.');
    const mesh = new THREE.Mesh(
      shape,
      new THREE.MeshStandardMaterial({ color: '#b8bec7', roughness: 0.7 }),
    );
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    visuals.push({ mesh, link: link.name, visual });
  }
function poseAt(candidate, index) {
  const mount = brief.mounts.find((m) => m.id === candidate.id);
  return forwardKinematics(robot, candidate.poses[index].positions, mount.base);
}
function measure(candidate) {
  return {
    reached: candidate.poses.filter((pose) => pose.withinTolerance && !pose.violations.length)
      .length,
    maximumError: Math.max(...candidate.poses.map((pose) => pose.residual)),
    allowed: !(
      current.reserved &&
      brief.mounts
        .find((mount) => mount.id === candidate.id)
        .base.xyz.slice(0, 2)
        .every((v, i) => v >= region.min[i] && v <= region.max[i])
    ),
  };
}
function render() {
  targetIndex = Math.max(0, Math.min(brief.targets.length - 1, current.ui?.targetIndex ?? 0));
  const study = {
    candidates: current.study?.candidates ?? [],
    selected: current.selected ?? brief.mounts[0].id,
  };
  const selected = brief.mounts.find((m) => m.id === study.selected) ?? brief.mounts[0];
  const candidate = study.candidates.find((c) => c.id === selected.id);
  const pose = candidate
    ? poseAt(candidate, targetIndex)
    : forwardKinematics(robot, zero, selected.base);
  for (const { mesh, link, visual } of visuals) {
    mesh.matrix.fromArray(multiplyTransforms(pose.links[link], originTransform(visual.origin)));
    mesh.matrix.scale(new THREE.Vector3(...visual.geometry.scale));
    mesh.matrixWorldNeedsUpdate = true;
  }
  reserved.visible = !!current.reserved;
  $('offset').value = (current.targetOffsetX ?? 0) * 1000;
  targetIndex = Math.max(0, Math.min(brief.targets.length - 1, current.ui?.targetIndex ?? 0));
  $('target').value = String(targetIndex);
  $('reserved').checked = reserved.visible;
  mountMarkers.forEach((m, i) =>
    m.material.color.set(brief.mounts[i].id === selected.id ? '#82b3cf' : '#b1bac6'),
  );
  markers.forEach((m, i) => {
    m.position.x = brief.targets[i].position[0] + (current.targetOffsetX ?? 0);
    m.userData.targetLine.position.x = current.targetOffsetX ?? 0;
    m.material.color.set(i === targetIndex ? '#f2f4f6' : '#82b3cf');
    m.scale.setScalar(i === targetIndex ? 1.5 : 1);
  });
  $('mounts').replaceChildren(
    ...brief.mounts.map((m) => {
      const row = document.createElement('tr'),
        name = document.createElement('td'),
        poses = document.createElement('td'),
        distance = document.createElement('td'),
        button = document.createElement('button');
      const c = study.candidates.find((c) => c.id === m.id),
        measurement = c && measure(c, study);
      button.textContent = m.label;
      button.disabled = !c?.eligible;
      button.onclick = () => run('select', { mount: m.id });
      name.append(button);
      row.dataset.selected = String(m.id === selected.id);
      row.dataset.reserved = String(measurement?.allowed === false);
      poses.textContent = measurement
        ? measurement.allowed
          ? `${measurement.reached} / 6`
          : 'Reserved'
        : 'Pending';
      distance.textContent =
        Math.round(Math.hypot(...m.base.xyz.map((v, i) => v - brief.reference[i])) * 1000) + ' mm';
      row.append(name, poses, distance);
      return row;
    }),
  );
  $('selection').textContent = `Selected: ${selected.label} · ${selected.base.xyz
    .slice(0, 2)
    .map((v) => Math.round(v * 1000))
    .join(', ')} mm`;
  $('pose-label').textContent = `${selected.label} mount · ${brief.targets[targetIndex].id}`;
  $('endpoint').textContent =
    `Target ${brief.targets[targetIndex].position.map((v) => Math.round(v * 1000)).join(', ')} mm`;
  $('result').textContent = candidate
    ? `${measure(candidate, study).reached} / ${brief.targets.length} candidate poses at ${selected.label}.`
    : 'No candidate poses yet.';
  renderScene();
}
async function run(action, input = {}) {
  try {
    const result = await api.invokeAction(action, input);
    if (action === 'check') progress.textContent = 'Saved poses checked by the robotics plugin.';
    if (action === 'evaluate') progress.textContent = 'Mounting points evaluated.';
    return result;
  } catch (e) {
    progress.textContent = e.message;
  }
}
$('evaluate').onclick = () =>
  run('evaluate', {
    reserved: $('reserved').checked,
    targetOffsetX: Number($('offset').value) / 1000,
  });
$('check').onclick = () => run('check');
$('export').onclick = () => {
  if (!current.study) {
    progress.textContent = 'Evaluate the mounting points first.';
    return;
  }
  api.requestExport({
    format: 'json',
    name: 'placement-result',
    content: JSON.stringify(
      {
        selected: current.selected,
        reserved: current.reserved,
        targetOffsetX: current.targetOffsetX,
        study: current.study,
      },
      null,
      2,
    ),
  });
};
$('reserved').onchange = () => {
  progress.textContent = 'Run Evaluate placements to apply this constraint.';
};
$('fit').onclick = () => {
  resetView();
  saveCamera();
  render();
};
$('robot-source').onclick = () => api.openSource(source.id);
$('brief-source').onclick = () => api.openSource(briefSource.id);
for (const [index, target] of brief.targets.entries()) {
  const option = document.createElement('option');
  option.value = index;
  option.textContent = target.id;
  $('target').append(option);
}
$('target').onchange = (e) => {
  api.setState({ ui: { ...current.ui, targetIndex: Number(e.target.value) } });
};
api.subscribe((state) => {
  if (JSON.stringify(current.study) !== JSON.stringify(state.study)) {
    progress.textContent =
      'Mounting points evaluated. Select a passing point to inspect its poses.';
  }
  current = state;
  render();
});
controls.addEventListener('change', renderScene);
function saveCamera() {
  const value = { position: camera.position.toArray(), target: controls.target.toArray() };
  if (JSON.stringify(value) !== JSON.stringify(current.camera)) api.setState({ camera: value });
}
controls.addEventListener('end', saveCamera);
new ResizeObserver(() => {
  const bounds = $('scene').getBoundingClientRect();
  renderer.setSize(bounds.width, bounds.height, false);
  camera.aspect = bounds.width / bounds.height;
  camera.updateProjectionMatrix();
  render();
}).observe($('scene'));
render();
document.documentElement.dataset.loaded = String(visuals.length);
