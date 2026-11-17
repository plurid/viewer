/**
 * The review sheet: one HTML file beside the run's captures, opened straight from disk. Its styles,
 * its script and the run's results are inside it; the captures are next to it.
 */
import { readFile } from 'node:fs/promises';
import { reviewSheetScript } from './sheet-script';
import type { RunResults } from './types';

/** Text safe inside an HTML element. */
const escaped = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A function's source as a script that runs it; tsx names functions through an `__name` helper
 * the page lacks, so the script defines it. */
const runScript = (fn: () => void) =>
  `(() => {\n  const __name = (target) => target;\n  (${fn.toString()})();\n})();`;

export async function reviewSheet(results: RunResults, hasBaseline: boolean): Promise<string> {
  const styles = await readFile(new URL('./sheet.css', import.meta.url), 'utf8');
  // a script element ends at the first `</`, wherever it is
  const data = JSON.stringify({ ...results, hasBaseline }).replace(/<\//g, '<\\/');
  const captures = results.scenes.reduce((total, scene) => total + scene.captures.length, 0);
  const minutes = Math.floor(results.milliseconds / 60000);
  const seconds = Math.round((results.milliseconds % 60000) / 1000);
  const stopped = results.stopped
    ? `<div class="error">The run stopped early: ${escaped(results.stopped)}</div>`
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Viewer review ${escaped(results.run)}</title>
    <style>
${styles}
    </style>
  </head>
  <body>
    <header class="top">
      <h1>Viewer review ${escaped(results.run)}</h1>
      <div class="meta">
        ${results.scenes.length} scenes · ${captures} captures · ${minutes} min ${seconds} s ·
        ${escaped(results.binary)}
      </div>
      ${stopped}
      <div class="bar" id="totals"></div>
      <div class="bar">
        <button type="button" data-filter="all" aria-pressed="true">All scenes</button>
        <button type="button" data-filter="problems" aria-pressed="false">With problems</button>
        <button type="button" data-filter="changed" aria-pressed="false">
          Changed from baseline
        </button>
        <input id="search" type="search" placeholder="Find a scene" aria-label="Find a scene" />
        <button type="button" id="copy-notes">Copy all notes</button>
        <a href="#coverage">Coverage</a>
      </div>
    </header>
    <main>
      <div id="scenes"></div>
      <h2 id="coverage">Coverage</h2>
      <div id="coverage-list"></div>
    </main>
    <div class="lightbox" id="lightbox" hidden>
      <div class="tools">
        <strong class="title"></strong>
        <span class="modes"></span>
        <button type="button" class="close">Close</button>
      </div>
      <div class="frame"></div>
    </div>
    <script type="application/json" id="review-data">${data}</script>
    <script>
${runScript(reviewSheetScript)}
    </script>
  </body>
</html>
`;
}
