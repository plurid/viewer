import type { Drawing } from '../../src/domain/previews/drawings/dxf/math';

interface PageData {
  attachment: { name: string; widthMm: number; heightMm: number; holes: number };
  stock: { material: string; thicknessMm: number; quantity: number };
  drawing: Drawing;
}

/** Operate: a compact supplier conversation, using Viewer's typography and neutral surfaces. */
export function supplierPage(data: PageData): string {
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo cutting service</title>
<style>
:root{color-scheme:dark;--space:#272a30;--surface:#31353d;--field:#292d34;--ink:#f2f4f6;--muted:#b1bac6;--line:#454b55;--accent:#82b3cf}
*{box-sizing:border-box}body{margin:0;background:var(--space);color:var(--ink);font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;accent-color:var(--accent)}
::selection{background:var(--accent);color:var(--field)}:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
main{max-width:780px;margin:auto;min-height:100vh;display:flex;flex-direction:column;padding:0 24px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 0;border-bottom:1px solid var(--line)}h1{margin:0;font-size:18px;font-weight:600}header span,small{color:var(--muted);font-size:12px}
.attachment{display:flex;gap:20px;align-items:center;padding:24px 0;border-bottom:1px solid var(--line)}svg{width:120px;height:100px;flex-shrink:0;color:var(--ink);background:var(--field)}.attachment strong{overflow-wrap:anywhere}.attachment p{margin:6px 0;color:var(--muted)}
#messages{flex:1;padding:8px 0 24px}.message{padding:20px 0;border-bottom:1px solid var(--line)}.message h2{margin:0 0 8px;font-size:13px;color:var(--muted);font-weight:500}.message p{margin:0;max-width:65ch;white-space:pre-line}.message p+p{margin-top:8px}table{border-collapse:collapse;width:100%;margin:8px 0 12px;font-variant-numeric:tabular-nums}th,td{text-align:start;padding:10px 0;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:12px;font-weight:500}td:last-child,th:last-child{text-align:end}
footer{border-top:1px solid var(--line);padding:20px 0;display:flex;align-items:center;justify-content:space-between;gap:16px}button{font:inherit;border:1px solid var(--line);border-radius:4px;padding:8px 14px;background:var(--surface);color:var(--ink);cursor:pointer}button:hover{background:#393e47}button:disabled{opacity:.55;cursor:default}#status{font-size:12px;color:var(--muted)}
@media(max-width:480px){main{padding:0 16px}header{align-items:start;flex-direction:column;gap:4px}.attachment{gap:12px}svg{width:90px;height:80px}footer{align-items:start;flex-direction:column}}
</style><main><header><h1>Demo cutting service</h1><span>Local simulation</span></header>
<section class="attachment" aria-label="Plate attachment"><svg role="img" aria-label="Attached cutting drawing"><g fill="none" stroke="currentColor" transform="scale(1 -1)"></g></svg><div><strong id="filename"></strong><p id="geometry"></p><small id="stock"></small></div></section>
<section id="messages" aria-label="Conversation" aria-live="polite"><article class="message"><h2>Viewer agent</h2><p id="request"></p></article></section>
<footer><span id="status">Ready to request a simulated quote</span><button id="send">Request quote</button></footer></main>
<script>
const data=${json};
document.querySelector('#filename').textContent=data.attachment.name;
document.querySelector('#geometry').textContent=data.attachment.widthMm+' × '+data.attachment.heightMm+' mm · '+data.attachment.holes+' holes';
document.querySelector('#stock').textContent=data.stock.quantity+' plate · '+data.stock.material+' · '+data.stock.thicknessMm+' mm thick';
document.querySelector('#request').textContent='Please quote '+data.stock.quantity+' plate using this drawing, in '+data.stock.thicknessMm+' mm '+data.stock.material+'. What are the delivery options?';
const svg=document.querySelector('svg'),g=svg.querySelector('g'),b=data.drawing.bounds,pad=Math.max(b.max.x-b.min.x,b.max.y-b.min.y)*.08;
svg.setAttribute('viewBox',[b.min.x-pad,-b.max.y-pad,b.max.x-b.min.x+pad*2,b.max.y-b.min.y+pad*2].join(' '));
for(const entity of data.drawing.entities){const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',entity.points.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' ')+(entity.closed?' Z':''));p.setAttribute('vector-effect','non-scaling-stroke');g.append(p)}
const send=document.querySelector('#send'),status=document.querySelector('#status');
send.onclick=async()=>{send.disabled=true;status.textContent='Requesting local quote…';try{
const response=await fetch(location.pathname+'/quote',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});const result=await response.json();if(!response.ok)throw new Error(result.error);
const article=document.createElement('article');article.className='message';const heading=document.createElement('h2');heading.textContent='Cutting-service agent';article.append(heading);
const table=document.createElement('table');table.innerHTML='<thead><tr><th>Option</th><th>Delivered in</th><th>Total</th></tr></thead><tbody></tbody>';
for(const option of result.quote.options){const row=table.tBodies[0].insertRow();for(const value of [option.label,option.deliveryDays+' days','€'+option.total])row.insertCell().textContent=value}article.append(table);
const note=document.createElement('p');note.textContent='Both totals include cutting, delivery and tax.';article.append(note);document.querySelector('#messages').append(article);
status.textContent='Saved '+result.file+' · attach this reply in Viewer';send.textContent='Quote received';
}catch(error){status.textContent=error.message;send.disabled=false}};
</script></html>`;
}
