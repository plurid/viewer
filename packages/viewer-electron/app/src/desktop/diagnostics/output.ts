import type { EventEmitter } from 'node:events';

const protectedOutput = Symbol.for('viewer.closed-diagnostic-pipe');
type Output = EventEmitter & { [protectedOutput]?: true };

/** GUI diagnostics may outlive the terminal or test runner that launched them.
 * A closed diagnostic pipe must not become an Electron exception dialog. */
export function protectDiagnosticOutput(outputs: readonly Output[]): void {
  for (const output of outputs) {
    if (output[protectedOutput]) continue;
    output[protectedOutput] = true;
    output.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') throw error;
    });
  }
}
