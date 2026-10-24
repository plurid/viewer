import './renderer/native-api';
import { createRoot } from 'react-dom/client';
import { SettingsWindow } from './renderer/ui/settings/Settings';
import { App } from './renderer/App';
import { initialize } from './renderer/state/store';
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
if (new URLSearchParams(location.search).get('window') === 'settings')
  root.render(<SettingsWindow />);
else
  window.viewer
    .bootstrap()
    .then((bootstrap) => {
      initialize(bootstrap);
      root.render(<App />);
    })
    .catch((error) =>
      root.render(<Empty icon="warning" title="Viewer could not start" detail={error.message} />),
    );
