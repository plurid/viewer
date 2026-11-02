import assert from 'node:assert/strict';

const annotations = `
const sceneLabels=document.createElement('div');
sceneLabels.id='sceneLabels';
document.getElementById('viewWrap').appendChild(sceneLabels);
function updateSceneLabels(){
  const width=container.clientWidth,height=container.clientHeight;
  const labels=[];
  scene.traverse(function(object){
    const text=object.userData.presentationLabel;
    if(!text) return;
    const point=object.getWorldPosition(new THREE.Vector3()).project(camera);
    if(point.z < -1 || point.z > 1) return;
    labels.push({text,x:(point.x+1)*width/2,y:(1-point.y)*height/2});
  });
  labels.sort(function(a,b){return Number(!/^[AB][123]$/.test(a.text))-Number(!/^[AB][123]$/.test(b.text)) || a.y-b.y;});
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));
  sceneLabels.replaceChildren(svg);
  const occupied=[];
  labels.forEach(function(label){
    const element=document.createElement('span');
    element.className='scene-label';element.textContent=label.text;
    sceneLabels.appendChild(element);
    const w=element.offsetWidth,h=element.offsetHeight;
    const x=Math.max(4,Math.min(width-w-4,label.x-w/2));
    let y=Math.max(4,Math.min(height-h-44,label.y-h-9));
    for(let attempt=0;attempt<24;attempt++){
      if(!occupied.some(function(r){return x<r.x+r.w+6&&x+w+6>r.x&&y<r.y+r.h+4&&y+h+4>r.y;})) break;
      y=Math.max(4,Math.min(height-h-44,label.y-h-9+(attempt%2?1:-1)*Math.ceil((attempt+1)/2)*(h+5)));
    }
    element.style.left=x+'px';element.style.top=y+'px';
    occupied.push({x,y,w,h});
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',String(label.x));line.setAttribute('y1',String(label.y));
    line.setAttribute('x2',String(x+w/2));line.setAttribute('y2',String(y+h/2));
    line.setAttribute('stroke','#aeb6bf');line.setAttribute('stroke-opacity','0.65');
    svg.appendChild(line);
  });
}
`;

/** Local presentation edits only; the retained provider HTML remains the provenance source. */
export function presentStationHTML(original: string): string {
  let html = original;
  const replace = (before: string, after: string) => {
    assert.equal(html.split(before).length, 2, 'Expected one qualified presentation anchor.');
    html = html.replace(before, () => after);
  };
  const computations = (text: string) =>
    text.slice(
      text.indexOf('async function evalOne('),
      text.indexOf("document.getElementById('bAll')"),
    );
  assert.ok(computations(original).length > 5000);
  replace(
    '<h1>Six-slot station placement</h1>',
    '<h1>Six-slot station placement <span class="fixture-note">Fictional station</span></h1>',
  );
  replace(
    '<div class="row"><select id="selMount">',
    '<label for="selMount">Mounting point</label><div class="row"><select id="selMount">',
  );
  for (const id of ['evalStatus', 'checkStatus', 'selStatus'])
    replace(`id="${id}"`, `id="${id}" role="status" aria-live="polite" aria-atomic="true"`);
  replace(
    "setLog('evalStatus','Ready. Use Evaluate all, then Select and Check.');",
    "const restoredStudy=getState()[STUDY];setLog('evalStatus',restoredStudy&&restoredStudy.candidates&&restoredStudy.candidates.length?'Saved evaluation: '+restoredStudy.candidates.length+' mounting points. '+(restoredStudy.selected?'Selected '+restoredStudy.selected+'. Inspect a target or run again.':'Choose a mounting point to save.'):'Evaluate the mounting points to compare them.');",
  );
  replace(
    '</style>',
    `.fixture-note{margin-left:12px;font-size:12px;font-weight:400;color:#aeb6bf}
#sceneLabels{position:absolute;inset:0;pointer-events:none;overflow:hidden}
#sceneLabels svg{position:absolute;inset:0}
.scene-label{position:absolute;white-space:nowrap;font:500 14px/20px system-ui,-apple-system,sans-serif;color:#e6e8eb;background:#141619;padding:0 3px}
</style>`,
  );
  const textFunction = html.match(/^function makeText\(txt,color\).*$/m)?.[0];
  assert.ok(textFunction);
  replace(
    textFunction,
    "function makeText(txt,color){const anchor=new THREE.Object3D();anchor.userData.presentationLabel=txt==='Reserved'?'':txt==='central'&&reserveEnabled()?'Central (reserved)':txt;return anchor;}",
  );
  replace(
    'function render(){renderer.render(scene,camera);}',
    annotations + 'function render(){renderer.render(scene,camera);updateSceneLabels();}',
  );
  replace(
    'lbl.position.set((x0+x1)/2,(y0+y1)/2,0.032)',
    'lbl.position.set((x0+x1)/2,y0-0.04,0.015)',
  );
  assert.equal(
    computations(html),
    computations(original),
    'Evaluation and action code must match.',
  );
  return html;
}
