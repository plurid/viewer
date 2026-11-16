import { ipcRenderer } from 'electron';
import {
  reportCloseChannel, reportCopyChannel, reportOptionsChannel, reportUpdateChannel, reportShownChannel,
} from './domain/diagnostics/report-window';
import type { ReportUpdate } from './domain/diagnostics/report-window';

// The page receives local controls, never a callable report or log reader.
window.addEventListener('DOMContentLoaded', () => {
  const button = document.querySelector('button')!;
  const report = document.querySelector('pre')!;
  const checkbox = document.querySelector<HTMLInputElement>('#include-message-text')!;
  const warning = document.getElementById('message-warning')!;
  const status = document.getElementById('report-status')!;
  let revision = 0;
  button.addEventListener('click', () => {
    if (!button.disabled) ipcRenderer.send(reportCopyChannel);
  });
  checkbox.addEventListener('change', () => {
    warning.hidden = !checkbox.checked;
    button.disabled = true;
    report.setAttribute('aria-busy', 'true');
    ipcRenderer.send(reportOptionsChannel, checkbox.checked);
  });
  ipcRenderer.on(reportUpdateChannel, (_event, update: ReportUpdate) => {
    if (update.revision <= revision) return;
    revision = update.revision;
    report.textContent = update.report;
    checkbox.checked = update.includeMessageText;
    warning.hidden = !checkbox.checked;
    status.hidden = !update.error;
    status.textContent = update.error ?? '';
    report.setAttribute('aria-busy', 'false');
    // Acknowledgement binds Copy to the text already placed in the document.
    ipcRenderer.send(reportShownChannel, revision);
    button.disabled = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      ipcRenderer.send(reportCloseChannel);
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      if (!button.disabled) ipcRenderer.send(reportCopyChannel);
    }
  });
}, { once: true });
