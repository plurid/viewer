// Run with Electron, never ELECTRON_RUN_AS_NODE. The OS key store is main-process only.
import { tsImport } from 'tsx/esm/api';
import { url } from 'node:inspector';
import { app } from 'electron';

if (url()) {
  console.error(
    'Use a -- separator before evaluation options. This tool does not open credentials while a debugger is listening.',
  );
  app.exit(1);
} else {
  void tsImport('./evaluate-profile-main.ts', import.meta.url).catch(() => {
    console.error('The desktop evaluation entry could not start.');
    app.exit(1);
  });
}
