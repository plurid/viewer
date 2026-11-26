import type { CommandContext, CommandInvocation, CommandRegistry } from '../commands/registry';
import type { WorkspaceController } from '../workspace/context';
import type { PaletteMode } from '../commands/palette-modes';

/** The origin of an agent or model request follows each step of a command line. */
export interface LineDispatch {
  modelRequest?: boolean;
  id?: string;
  deadline?: number;
}
/** What a line runs against: the window's commands and workspace, given by App. */
export interface LineHost {
  /** App's invoke: a command where it belongs (an editor, a terminal, the registry); false when
   * nothing ran. */
  invocation?: CommandInvocation;
  invoke(
    id: string,
    remember?: boolean,
    agent?: LineDispatch,
    invocation?: CommandInvocation,
  ): Promise<boolean>;
  registry: CommandRegistry;
  workspace: WorkspaceController;
  /** The active plane's context, read again before each step. */
  context(): CommandContext;
  newWorkspace(name: string): Promise<void>;
  switchWorkspace(id: string): Promise<void>;
  /** The palette in a mode, with text typed: `:help` and `:history` open the command line. */
  palette(mode: PaletteMode, query?: string): void;
  agent?: LineDispatch;
}
/** A line stopped where the person chose to (Cancel in a question): nothing to report. */
export class Stopped extends Error {
  constructor() {
    super('Stopped.');
    this.name = 'Stopped';
  }
}
