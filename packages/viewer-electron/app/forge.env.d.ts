/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare module 'virtual:viewer-canvas-libraries' {
  export const canvasLibraries: ReadonlyMap<string, string>;
}
