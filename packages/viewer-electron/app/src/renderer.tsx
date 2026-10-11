import { createRoot } from 'react-dom/client';
import { SettingsWindow } from './renderer/ui/Settings';
import { App } from './renderer/App';
import { initialize } from './renderer/state/store';
import { Empty } from './renderer/ui/primitives';
import './renderer/styles.css';
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
