export interface FolderSizeTask {
  id: string;
  paths: string[];
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  bytes: number;
  files: number;
  folders: number;
  skipped: number;
  measuredAt?: number;
  error?: string;
  /** Independently measured top-level items. Overlapping descendants are excluded from the total. */
  items?: { path: string; bytes: number; files: number; folders: number; skipped: number }[];
}
export interface NativeApplication {
  id: string;
  name: string;
  default: boolean;
}
export interface ApplicationChoices {
  applications: NativeApplication[];
  defaultName?: string;
  supported: boolean;
}
