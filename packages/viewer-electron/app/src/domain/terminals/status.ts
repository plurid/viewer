export type TerminalStatus = { kind: 'stopped'; error?: string } | { kind: 'starting' | 'running' };
