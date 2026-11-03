/** A layout and runtime contract, with no task-specific implementation. */
export const canvasScaffold = `
<style>
  :root { color-scheme: light dark; font: 14px system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; color: light-dark(#202428, #e5e8eb); background: light-dark(#f7f7f8, #30343a); }
  main { padding: 24px; }
  h1 { margin: 0 0 12px; font-size: 20px; font-weight: 600; }
  p { max-width: 60ch; line-height: 1.5; }
</style>
<main>
  <h1>Build a tool for this project</h1>
  <p>Describe what you want in the conversation. The agent can create controls, calculations and exports using the files you attach.</p>
</main>`;

export const canvasHostContract = {
  version: 1,
  capabilities: ['context-snapshots', 'local-assets', 'saved-inputs', 'actions', 'export-review'],
  libraries: ['three', 'three/addons/'],
  execution: 'sandboxed-browser',
} as const;
