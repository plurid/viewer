import { sample } from './documents';
import type { Sample } from '../types';

export function projectSamples(): Sample[] {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Field notes / Viewer playground</title>
    <link rel="stylesheet" href="style.css">
    <script src="app.js" defer></script>
  </head>
  <body>
    <main>
      <p class="eyebrow">VIEWER PLAYGROUND / LOCAL PROJECT</p>
      <h1>A small project.<br>A wider view.</h1>
      <p class="intro">A self-contained website for HTML previews, local servers and request logs.</p>
      <section aria-labelledby="materials-heading">
        <h2 id="materials-heading">On the workbench</h2>
        <div class="materials">
          <article><span>01</span><h3>Aluminum panel</h3><p>200 × 100 mm · 12 units</p></article>
          <article><span>02</span><h3>Nylon spacer</h3><p>8 mm · 24 units</p></article>
          <article><span>03</span><h3>Steel bracket</h3><p>3 mm · 6 units</p></article>
        </div>
      </section>
      <section aria-labelledby="interaction-heading">
        <h2 id="interaction-heading">Try an interaction</h2>
        <button id="counter" type="button">Reviewed: 0</button>
        <button id="load-data" type="button">Load project data</button>
        <pre id="result" aria-live="polite">Start a local server in this folder, then load the JSON.</pre>
      </section>
      <footer>No package install, build step, external requests or credentials.</footer>
    </main>
  </body>
</html>
`;
  const css = `:root {
  color-scheme: light;
  font-family: system-ui, sans-serif;
  color: #253c45;
  background: #f3f0e7;
}

* { box-sizing: border-box; }
body { margin: 0; }
main { max-width: 980px; margin: auto; padding: 72px 32px; }
.eyebrow { color: #52706f; font-size: 12px; letter-spacing: .12em; }
h1 { margin-block: 28px; font-size: clamp(42px, 8vw, 80px); line-height: 1.05; letter-spacing: -.05em; }
.intro { max-width: 560px; font-size: 20px; line-height: 1.6; }
section { margin-top: 56px; }
h2 { font-size: 18px; }
.materials { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
article { padding: 24px; border-top: 2px solid #52706f; background: #e8e6db; }
article span { color: #52706f; }
article h3 { margin-block: 24px 8px; font-size: 19px; }
article p { margin: 0; font-size: 14px; }
button { padding: 12px 18px; margin: 4px 8px 4px 0; font: inherit; border: 1px solid #52706f; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }
button:hover { background: #d9e3df; }
button:focus-visible { outline: 3px solid #b9753b; outline-offset: 3px; }
pre { min-height: 80px; padding: 20px; white-space: pre-wrap; overflow-wrap: anywhere; background: #e8e6db; }
footer { margin-top: 56px; color: #52706f; font-size: 13px; }
`;
  const javascript = `let reviewed = 0;

document.querySelector('#counter').addEventListener('click', (event) => {
  reviewed += 1;
  event.currentTarget.textContent = 'Reviewed: ' + reviewed;
});

document.querySelector('#load-data').addEventListener('click', async () => {
  const result = document.querySelector('#result');
  try {
    const response = await fetch('data/project.json');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    result.textContent = JSON.stringify(await response.json(), null, 2);
    console.info('Local project data loaded.');
  } catch (error) {
    result.textContent = 'Start a local server in this folder to load project data. ' + error.message;
  }
});
`;
  return Object.entries({
    'index.html': html,
    'style.css': css,
    'app.js': javascript,
    'data/project.json':
      JSON.stringify({ name: 'Field notes', parts: 3, reviewed: false }, null, 2) + '\n',
    'README.md': `# Static website

Preview index.html, then run **Start local server** on this folder.
Open the URL from the server plane, load project data, and inspect its request logs.
There is no dependency install or build step. Stop the server from its plane.
`,
  }).map(([name, bytes]) =>
    sample(
      `projects/static-website/${name}`,
      [],
      'Local project',
      'Manual HTML preview and explicit local-server exercise.',
      bytes,
    ),
  );
}
