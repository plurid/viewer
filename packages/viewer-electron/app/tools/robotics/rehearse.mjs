// Credentials stay inside Electron's main process, without an inspector.
import { tsImport } from 'tsx/esm/api';
import { url } from 'node:inspector';
import { app } from 'electron';

if (url()) {
  console.error('Run the rehearsal without a main-process debugger.');
  app.exit(1);
} else {
  void tsImport('./rehearse-main.ts', import.meta.url).catch(() => {
    console.error('The robot rehearsal entry could not start.');
    app.exit(1);
  });
}
