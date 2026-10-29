import './renderer/native-api';
import { createRoot } from 'react-dom/client';
import { initialize } from './renderer/state/store';
import { markStartup } from './renderer/app/startup';
import { Empty } from './renderer/ui/primitives';
import './renderer/styles.css';
// Failures reach the local diagnostic log; each window reports at most 50.
let reports = 0;
const diagnose = (value: unknown) => {
  if (++reports > 50) return;
  const detail = value instanceof Error ? (value.stack ?? value.message) : String(value);
  void window.viewer?.diagnosticReport?.(detail.slice(0, 8000)).catch(() => {});
};
window.addEventListener('error', (event) => diagnose(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => diagnose(event.reason));
const root = createRoot(document.getElementById('viewer')!);
const failed = (error: Error) =>
  root.render(<Empty icon="warning" title="Viewer could not start" detail={error.message} />);
// Each window loads only its own interface: Settings and the workspace share little code.
if (new URLSearchParams(location.search).get('window') === 'settings')
  import('./renderer/ui/settings/Settings')
    .then(({ SettingsWindow }) => root.render(<SettingsWindow />))
    .catch(failed);
else
  // the interface's code loads while the desktop prepares the saved state
  Promise.all([window.viewer.bootstrap(), import('./renderer/App')])
    .then(([bootstrap, { App }]) => {
      markStartup('viewer:bootstrap');
      initialize(bootstrap);
      root.render(<App />);
    })
    .catch(failed);
