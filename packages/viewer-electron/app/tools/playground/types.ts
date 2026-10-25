export interface Sample {
  path: string;
  formats: string[];
  preview: string;
  description: string;
  source: string;
  license: string;
  bytes: Uint8Array | string;
}

export interface RemoteSample {
  path: string;
  formats: string[];
  preview: string;
  description: string;
  source: string;
  license: string;
  url: string;
  sha256: string;
  size: number;
}

export interface FileResult {
  path: string;
  state: 'created' | 'unchanged' | 'modified' | 'missing' | 'unavailable';
  expectedSHA256?: string;
  actualSHA256?: string;
  detail?: string;
}

export interface PlaygroundOptions {
  directory: string;
  downloadSamples: boolean;
}

export interface PlaygroundReport {
  version: 1;
  directory: string;
  files: FileResult[];
  git: { state: 'created' | 'preserved'; directory: string; ready: boolean };
  coverage: { formats: number; present: number; missing: string[] };
}
