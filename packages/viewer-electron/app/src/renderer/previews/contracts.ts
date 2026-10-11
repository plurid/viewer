import type { ComponentType } from 'react';
import type { ArchiveListing, FileEntry, Resource, ResourceRead } from '../../domain/contracts';

/** Renderer-only capabilities: preview modules never import the workspace or explorer. */
export interface PreviewCommand {
  id: string;
  label: string;
  aliases?: readonly string[];
  primary?: boolean;
  available?: boolean;
  run(): void | Promise<void>;
}

export interface PreviewContext {
  resource: Resource;
  active: boolean;
  interactive: boolean;
  signal: AbortSignal;
  look: 'dark' | 'light';
  commands?: { header?: HTMLElement; register(commands: readonly PreviewCommand[]): () => void };
  services: {
    read(id: string, limit?: number): Promise<ResourceRead>;
    archive(id: string): Promise<ArchiveListing>;
    archiveEntry(id: string, name: string): Promise<Resource>;
    release(id: string): Promise<void>;
  };
}
export interface PreviewModule {
  id: string;
  label: string;
  formats: readonly string[];
  detect(entry: FileEntry): number;
  load(): Promise<{ default: ComponentType<PreviewContext> }>;
  metadata?(context: PreviewContext): Promise<Record<string, string>>;
  thumbnail?(context: PreviewContext): Promise<string | null>;
}
