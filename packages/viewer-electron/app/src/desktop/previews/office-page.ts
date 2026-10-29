import { officeFamilies } from '../../domain/previews/documents/layout';

/** Static, isolated renderer. No paths, document text or user-provided script are
 * interpolated here. The document lives in a fresh Emscripten RAM filesystem. */
export const officePage = `<!doctype html><meta charset="utf-8"><title>Office layout renderer</title>
<canvas id="qtcanvas" style="width:1024px;height:768px"></canvas>
<script type="module" src="./office-main.js"></script>`;

export const officeMain = `
import { ZetaHelperMain } from './zetaHelper.js';
const helper = new ZetaHelperMain('office-thread.js', {
  threadJsType: 'module', wasmPkg: 'url:' + new URL('./', location.href).href,
  blockPageScroll: false
});
const fail = () => fetch('./failed', {method:'POST', body:'Document could not be rendered.'});
addEventListener('error', fail);
addEventListener('unhandledrejection', fail);
helper.start(() => {
  helper.thrPort.onmessage = async event => {
    try {
      if (event.data.cmd === 'ready') {
        const response = await fetch('./input');
        if (!response.ok) throw Error('Input unavailable');
        const {extension, sheet, whole, inputPath, inputURL} = await (await fetch('./job')).json();
        if (!Object.hasOwn(${JSON.stringify(officeFamilies)},extension)) throw Error('Invalid format');
        helper.FS.mkdir('/tmp/viewer-input');
        helper.FS.writeFile(inputPath, new Uint8Array(await response.arrayBuffer()));
        helper.thrPort.postMessage({cmd:'convert', extension, sheet, whole: whole === true, inputURL});
      } else if (event.data.cmd === 'converted') {
        const bytes = helper.FS.readFile('/tmp/output.pdf');
        await fetch('./metadata', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(event.data.office)});
        await fetch('./result', {method:'POST', headers:{'Content-Type':'application/pdf'}, body:bytes});
      } else if (event.data.cmd === 'error') await fail();
    } catch { await fail(); }
  };
});`;

export const officeThread = `
import { ZetaHelperThread } from './zetaHelper.js';
const helper = new ZetaHelperThread();
const z = helper.zetajs, css = helper.css;
const property = (Name, Value) => new css.beans.PropertyValue({Name, Value});
const families = ${JSON.stringify(officeFamilies)};
helper.thrPort.onmessage = event => {
  if (event.data.cmd !== 'convert' || !Object.hasOwn(families,event.data.extension)) return;
  let model;
  try {
    model = helper.desktop.loadComponentFromURL(event.data.inputURL, '_blank', 0, [
      property('Hidden', true), property('ReadOnly', true),
      property('MacroExecutionMode', new z.Any(z.type.short, css.document.MacroExecMode.NEVER_EXECUTE)),
      property('UpdateDocMode', new z.Any(z.type.short, css.document.UpdateDocMode.NO_UPDATE))
    ]);
    if (!model) throw Error('Document unavailable');
    const family = families[event.data.extension];
    const office = {sheets:[], limited:false};
    let selectedSheet;
    if (family === 'workbook') {
      const book = model.getSheets(), names = Array.from(book.getElementNames());
      office.sheets = names.slice(0,256).map(name => ({name,hidden:!book.getByName(name).getPropertyValue('IsVisible')}));
      office.limited = names.length > 256;
      if (!event.data.whole) {
        const name = event.data.sheet || office.sheets.find(sheet => !sheet.hidden)?.name || names[0];
        if (!names.includes(name)) throw Error('Worksheet unavailable');
        office.selectedSheet = name;
        selectedSheet = book.getByName(name);
        selectedSheet.setPropertyValue('IsVisible', true);
        model.getCurrentController().setActiveSheet(selectedSheet);
      }
    }
    const filter = {word:'writer_pdf_Export', workbook:'calc_pdf_Export', presentation:'impress_pdf_Export', drawing:'draw_pdf_Export'}[family];
    const options = [property('FilterName', filter)];
    if (selectedSheet) {
      // Hiding other tabs does not constrain Calc's PDF export. Supply the UNO
      // selection explicitly, including the typed FilterData sequence.
      options.push(property('Selection', selectedSheet));
      options.push(property('FilterData', new z.Any(z.type.sequence(z.type.struct(css.beans.PropertyValue)), [
        property('Selection', selectedSheet), property('SinglePageSheets', false)
      ])));
    }
    model.storeToURL('file:///tmp/output.pdf', options);
    model.close(false);
    model = undefined;
    helper.thrPort.postMessage({cmd:'converted',office});
  } catch {
    try { if(model) model.close(false); } catch {}
    helper.thrPort.postMessage({cmd:'error'});
  }
};
helper.thrPort.postMessage({cmd:'ready'});`;

export const officeCSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:",
  "worker-src 'self' blob: data:",
  "connect-src 'self'",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
