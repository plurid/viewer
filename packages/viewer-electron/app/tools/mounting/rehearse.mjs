import { tsImport } from 'tsx/esm/api';
import { url } from 'node:inspector';
import { app } from 'electron';

app.setName('Viewer');
if (url()) {
  console.error('Run the mounting rehearsal without a main-process debugger.');
  app.exit(1);
} else {
  await tsImport('./rehearse-main.ts', import.meta.url).catch(() => {
    console.error('The mounting rehearsal entry could not start.');
    app.exit(1);
  });
}
