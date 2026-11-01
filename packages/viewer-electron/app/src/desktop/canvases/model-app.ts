/** A working starting point the conversation can revise using the same canvas protocol. */
export function modelCanvasHTML(assetID: string): string {
  return `<style>
html,body{margin:0;height:100%;font:14px system-ui;background:#20242c;color:#edf0f5}body{display:flex;flex-direction:column}header{padding:16px 20px;border-bottom:1px solid #434b57;display:flex;align-items:center;gap:16px;flex-wrap:wrap}h1{font-size:16px;margin:0 auto 0 0}label{display:flex;align-items:center;gap:8px}button,input,select{font:inherit}button,select{color:inherit;background:#303743;border:1px solid #536071;border-radius:5px;padding:6px 10px}#stage{flex:1;position:relative;min-height:0}canvas{display:block;width:100%;height:100%}#status{position:absolute;bottom:12px;left:20px;pointer-events:none;color:#b5c2d4}footer{padding:8px 20px;color:#b5c2d4;font-size:12px}
</style><header><h1>Object studio</h1><label>Light <input id="light" type="range" min="0.2" max="4" step="0.1"></label><label><input id="wire" type="checkbox">Wireframe</label><label>Background <select id="background"><option value="#20242c">Dark</option><option value="#e9edf1">Light</option></select></label><button id="reset">Reset view</button></header><main id="stage"><div id="status">Loading mesh…</div></main><footer>Meta SAM 3D Objects · inferred geometry, not verified dimensions</footer>
<script type="module">
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const api=window.viewerCanvas, state=api.getState(), asset=api.assets.find(item=>item.id===${JSON.stringify(assetID)});
const stage=document.getElementById('stage'), status=document.getElementById('status');
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));stage.append(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.01,1000),controls=new OrbitControls(camera,renderer.domElement);
const ambient=new THREE.HemisphereLight(0xffffff,0x44556b,2),light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,5,4);scene.add(ambient,light);
let mesh,center=new THREE.Vector3(),distance=3,disposed=false;
const render=()=>{if(!disposed)renderer.render(scene,camera)};
const saveView=()=>api.setState({modelCamera:camera.position.toArray(),modelTarget:controls.target.toArray()});
const reset=()=>{camera.position.copy(center).add(new THREE.Vector3(distance,distance*.65,distance));controls.target.copy(center);controls.update();saveView();render()};
controls.addEventListener('change',render);controls.addEventListener('end',saveView);
const resize=new ResizeObserver(()=>{const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render()});resize.observe(stage);
const background=document.getElementById('background');background.value=state.modelBackground||'#20242c';scene.background=new THREE.Color(background.value);background.onchange=()=>{scene.background.set(background.value);api.setState({modelBackground:background.value});render()};
const slider=document.getElementById('light');slider.value=state.modelLight??1;const setLight=()=>{light.intensity=3*Number(slider.value);ambient.intensity=2*Number(slider.value);render()};setLight();slider.oninput=setLight;slider.onchange=()=>api.setState({modelLight:Number(slider.value)});
const wire=document.getElementById('wire');wire.checked=state.modelWire??false;const applyWire=()=>{mesh?.traverse(child=>{if(child.isMesh)for(const material of Array.isArray(child.material)?child.material:[child.material])material.wireframe=wire.checked});render()};wire.onchange=()=>{api.setState({modelWire:wire.checked});applyWire()};
document.getElementById('reset').onclick=reset;
if(!asset)throw new Error('The model asset is unavailable.');
const disposeMesh=object=>object?.traverse(child=>{child.geometry?.dispose();if(child.material)for(const material of Array.isArray(child.material)?child.material:[child.material]){for(const value of Object.values(material))if(value?.isTexture){value.source?.data?.close?.();value.dispose()}material.dispose()}});
new GLTFLoader().load(asset.url,gltf=>{if(disposed){disposeMesh(gltf.scene);return;}mesh=gltf.scene;scene.add(mesh);const box=new THREE.Box3().setFromObject(mesh);box.getCenter(center);distance=Math.max(box.getSize(new THREE.Vector3()).length(),.1);camera.far=Math.max(distance*100,100);camera.updateProjectionMatrix();if(Array.isArray(state.modelCamera)&&state.modelCamera.length===3&&Array.isArray(state.modelTarget)&&state.modelTarget.length===3){camera.position.fromArray(state.modelCamera);controls.target.fromArray(state.modelTarget);controls.update()}else reset();applyWire();status.textContent='Drag to orbit · scroll to zoom';render()},undefined,()=>{status.textContent='The model could not be loaded. Check the canvas assets.'});
addEventListener('pagehide',()=>{disposed=true;resize.disconnect();controls.dispose();disposeMesh(mesh);renderer.dispose();renderer.forceContextLoss()},{once:true});
</script>`;
}
