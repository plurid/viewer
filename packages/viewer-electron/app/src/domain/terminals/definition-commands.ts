import type { TerminalStart } from '../automation/actions';

/** A reference binds a click to the catalog text the person saw, without accepting shell input. */
export interface DefinitionCommandReference {
  key: string;
  plane: number;
  basis: string;
}

export interface DefinitionCommandStart extends DefinitionCommandReference {
  request: TerminalStart;
}

export type DefinitionCommandOutcome = DefinitionCommandReference & { terminalID: string } & (
    { kind: 'started' | 'running' | 'declined' } | { kind: 'failed'; message: string }
  );
