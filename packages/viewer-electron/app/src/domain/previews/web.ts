export interface HtmlPreview {
  id: string;
  url: string;
}

export interface LocalServer {
  id: string;
  paneID: string;
  root: string;
  url: string;
  port: number;
  started: number;
  state: 'running' | 'stopped';
}

export interface LocalServerLog {
  sequence: number;
  timestamp: number;
  method: string;
  /** URL pathname only; queries, headers and request bodies are never retained. */
  path: string;
  status: number;
  durationMs: number;
  bytes: number;
  error?: string;
}

export interface LocalServerDetail {
  server: LocalServer;
  logs: LocalServerLog[];
}

export type LocalServerAction =
  'stop' | 'restart' | 'clear-log' | 'open-browser' | 'copy-url' | 'close';
