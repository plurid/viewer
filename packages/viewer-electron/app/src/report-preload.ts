import { ipcRenderer } from 'electron';
import { reportCloseChannel, reportCopyChannel } from './domain/diagnostics/report-window';

// The page gets a button listener, never an API for reading the report or the log.
window.addEventListener(
  'DOMContentLoaded',
  () => {
    document.querySelector('button')?.addEventListener('click', () => {
      ipcRenderer.send(reportCopyChannel);
    });
    document.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        ipcRenderer.send(reportCloseChannel);
      } else if (
        event.key === 'Enter' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        ipcRenderer.send(reportCopyChannel);
      }
    });
  },
  { once: true },
);
