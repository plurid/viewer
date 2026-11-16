import { ipcRenderer } from 'electron';
import { reportCopyChannel } from './domain/diagnostics/report-window';

// The page gets a button listener, never an API for reading the report or the log.
window.addEventListener(
  'DOMContentLoaded',
  () => {
    document.querySelector('button')?.addEventListener('click', () => {
      ipcRenderer.send(reportCopyChannel);
    });
  },
  { once: true },
);
