import { realpath } from 'node:fs/promises';
import { assertLocalPath } from '../files/local-path';
import type { BrowserWindow } from 'electron';
import type { TerminalStart } from '../../domain/automation/actions';
import type {
  DefinitionCommandConfirmation,
  DefinitionCommandApproval,
  ExecutionConfirmations,
} from '../actions/execution-confirmations';
import { definitionCommandFingerprint } from '../actions/execution-confirmations';
import type { Terminals } from '../terminals/terminals';
import type { TerminalStatus } from '../../domain/terminals/status';
import { validInitialInput } from '../terminals/terminal-protocol';
import { errorMessage } from '../../domain/errors';
import { definitionKeySchema, definitionLimits } from '../../domain/workspaces/definitions/schema';
import type {
  DefinitionCommandReference,
  DefinitionCommandStart,
  DefinitionCommandOutcome,
  DefinitionCommandPresentation,
} from '../../domain/terminals/definition-commands';
export type {
  DefinitionCommandReference,
  DefinitionCommandStart,
  DefinitionCommandOutcome,
} from '../../domain/terminals/definition-commands';

export interface DefinitionCommand {
  command: string;
  cwd: string;
  paneCwd: string;
  profileID: string;
  workspaceName: string;
  basis: string;
}

export type DefinitionCommandLookup = (
  owner: number,
  key: string,
  plane: number,
  workspaceID: string,
  terminalID: string,
) => DefinitionCommand | undefined;

interface DefinitionCommandPorts {
  lookup: DefinitionCommandLookup;
  terminals: Pick<Terminals, 'start' | 'profile' | 'running'>;
  confirmations: Pick<ExecutionConfirmations, 'requireDefinitionCommands'>;
  isAgentDriven(owner: number): boolean;
  ownsWorkspace(owner: number, workspaceID: string): boolean;
  window(owner: number): BrowserWindow | undefined;
}

interface PreparedCommand {
  request: TerminalStart;
  paneCwd: string;
  confirmation: DefinitionCommandConfirmation;
  fingerprint: string;
}

interface PendingDefinitionStart {
  owner: number;
  request: TerminalStart;
  reference: DefinitionCommandReference;
  result: Promise<DefinitionCommandOutcome>;
}

/** Inspection and reattachment cannot acquire the approval and start capability of a Run click. */
export class DefinitionCommands {
  private starts = new Map<string, PendingDefinitionStart>();
  constructor(private ports: DefinitionCommandPorts) {}

  async pending(
    request: TerminalStart,
    owner: number,
    wait = false,
  ): Promise<TerminalStatus | undefined> {
    assertLocalPath(request.cwd);
    const pending = this.starts.get(request.id);
    if (!pending) return;
    await this.matchPending(request, owner, pending);
    if (!wait) return { kind: 'starting' };
    const outcome = await pending.result;
    if (outcome.kind === 'declined') return { kind: 'stopped' };
    if (outcome.kind === 'failed') return { kind: 'stopped', error: outcome.message };
  }

  async inspect(
    owner: number,
    request: TerminalStart,
    reference: DefinitionCommandReference,
  ): Promise<DefinitionCommandPresentation> {
    assertLocalPath(request.cwd);
    if (!this.ports.ownsWorkspace(owner, request.workspaceID)) return { kind: 'changed' };
    const found = this.ports.lookup(
      owner,
      reference.key,
      reference.plane,
      request.workspaceID,
      request.id,
    );
    if (!found) return { kind: 'changed' };
    if (found.basis !== reference.basis)
      throw new Error('The definition changed. Review the command again.');
    try {
      const folders = await Promise.all(
        [found.cwd, found.paneCwd, request.cwd].map((cwd) => realpath(cwd)),
      );
      if (folders.some((cwd) => cwd !== folders[0])) return { kind: 'changed' };
    } catch (error) {
      if (
        found.cwd === request.cwd &&
        found.paneCwd === request.cwd &&
        ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        return { kind: 'folder-unavailable' };
      return { kind: 'changed' };
    }
    const current = this.ports.lookup(
      owner,
      reference.key,
      reference.plane,
      request.workspaceID,
      request.id,
    );
    if (!current || current.basis !== found.basis || current.paneCwd !== found.paneCwd)
      throw new Error('The definition changed. Review the command again.');
    if (request.profileID !== current.profileID) return { kind: 'changed' };
    return { kind: 'available', command: found.command, cwd: found.cwd, reference };
  }

  async start(
    owner: number,
    request: TerminalStart,
    definition: DefinitionCommandReference,
  ): Promise<DefinitionCommandOutcome> {
    const [result] = await this.startAll(owner, [{ request, ...definition }]);
    if (result!.kind === 'failed') throw new Error(result!.message);
    return result!;
  }

  async startAll(
    owner: number,
    input: readonly DefinitionCommandStart[],
  ): Promise<DefinitionCommandOutcome[]> {
    input.forEach((item) => assertLocalPath(item.request.cwd));
    this.requireHuman(owner);
    const items = structuredClone(input);
    if (!items.length) return [];
    const first = items[0]!;
    if (
      items.length > definitionLimits.planes ||
      items.some(
        (item) =>
          item.key !== first.key ||
          item.request.workspaceID !== first.request.workspaceID ||
          !definitionKeySchema.safeParse(item.key).success ||
          typeof item.basis !== 'string' ||
          !item.basis.length ||
          item.basis.length > 200 ||
          !Number.isInteger(item.plane) ||
          item.plane < 0 ||
          item.plane >= definitionLimits.planes,
      ) ||
      new Set(items.map((item) => item.plane)).size !== items.length ||
      new Set(items.map((item) => item.request.id)).size !== items.length
    )
      throw new Error('Choose distinct commands in one workspace.');
    const claims: {
      item: DefinitionCommandStart;
      pending: PendingDefinitionStart;
      resolve(outcome: DefinitionCommandOutcome): void;
    }[] = [];
    const outcomes = items.map((item) => {
      const existing = this.starts.get(item.request.id);
      if (
        existing &&
        (existing.reference.key !== item.key ||
          existing.reference.plane !== item.plane ||
          existing.reference.basis !== item.basis)
      )
        return Promise.resolve(
          this.outcome(item, {
            kind: 'failed',
            message: 'This terminal is already waiting for another start.',
          }),
        );
      if (existing)
        return this.matchPending(item.request, owner, existing).then(
          () => existing.result,
          (error) => this.outcome(item, { kind: 'failed', message: errorMessage(error) }),
        );
      let resolve!: (outcome: DefinitionCommandOutcome) => void;
      const result = new Promise<DefinitionCommandOutcome>((done) => {
        resolve = done;
      });
      const pending = {
        owner,
        request: item.request,
        reference: { key: item.key, plane: item.plane, basis: item.basis },
        result,
      };
      this.starts.set(item.request.id, pending);
      claims.push({ item, pending, resolve });
      return result;
    });
    const finish = (index: number, outcome: DefinitionCommandOutcome) => {
      const claim = claims[index]!;
      if (this.starts.get(claim.item.request.id) === claim.pending)
        this.starts.delete(claim.item.request.id);
      claim.resolve(outcome);
    };
    if (claims.length)
      void this.startBatch(
        owner,
        claims.map(({ item }) => item),
      ).then(
        (results) => results.forEach((result, index) => finish(index, result)),
        (error) =>
          claims.forEach(({ item }, index) =>
            finish(index, this.outcome(item, { kind: 'failed', message: errorMessage(error) })),
          ),
      );
    return Promise.all(outcomes);
  }

  private async matchPending(
    request: TerminalStart,
    owner: number,
    pending: PendingDefinitionStart,
  ): Promise<void> {
    if (
      pending.owner !== owner ||
      pending.request.workspaceID !== request.workspaceID ||
      pending.request.rootID !== request.rootID ||
      pending.request.profileID !== request.profileID
    )
      throw new Error('Terminal belongs to another plane.');
    if (
      pending.request.cwd !== request.cwd &&
      (await realpath(pending.request.cwd)) !== (await realpath(request.cwd))
    )
      throw new Error('Terminal belongs to another plane.');
  }

  private async startBatch(
    owner: number,
    items: readonly DefinitionCommandStart[],
  ): Promise<DefinitionCommandOutcome[]> {
    this.requireHuman(owner);
    const results = new Map<number, DefinitionCommandOutcome>();
    const ready: { item: DefinitionCommandStart; prepared: PreparedCommand; index: number }[] = [];
    for (const [index, item] of items.entries()) {
      try {
        this.requireOwner(owner, item.request.workspaceID);
        const prepared = await this.prepare(owner, item);
        if (await this.ports.terminals.running(item.request, owner))
          results.set(index, this.outcome(item, { kind: 'running' }));
        else ready.push({ item, prepared, index });
      } catch (error) {
        results.set(index, this.outcome(item, { kind: 'failed', message: errorMessage(error) }));
      }
    }
    if (ready.length) {
      let approval: DefinitionCommandApproval;
      try {
        this.requireHuman(owner);
        approval = await this.ports.confirmations.requireDefinitionCommands(
          ready.map(({ prepared }) => prepared.confirmation),
          this.ports.window(owner),
        );
      } catch (error) {
        for (const { item, index } of ready)
          results.set(index, this.outcome(item, { kind: 'failed', message: errorMessage(error) }));
        return items.map((_, index) => results.get(index)!);
      }
      await Promise.all(
        ready.map(async ({ item, index }) => {
          if (approval.kind === 'declined') {
            results.set(index, this.outcome(item, { kind: 'declined' }));
            return;
          }
          try {
            // Approval can outlive edits and earlier starts. Compare with the actual native review.
            const current = await this.prepare(owner, item);
            if (!approval.fingerprints.includes(current.fingerprint))
              throw new Error('The command changed during approval. Review it again.');
            if (await this.ports.terminals.running(current.request, owner)) {
              results.set(index, this.outcome(item, { kind: 'running' }));
              return;
            }
            this.requireOwner(owner, item.request.workspaceID);
            await this.ports.terminals.start(current.request, owner, {
              initialInput: current.confirmation.command,
              approvedProfile: current.confirmation.profile,
              approvedCwd: current.confirmation.cwd,
              validate: () => {
                this.requireOwner(owner, item.request.workspaceID);
                if (this.lookup(owner, item).paneCwd !== current.paneCwd)
                  throw new Error('The terminal changed during approval. Review it again.');
              },
            });
            results.set(index, this.outcome(item, { kind: 'started' }));
          } catch (error) {
            results.set(
              index,
              this.outcome(item, { kind: 'failed', message: errorMessage(error) }),
            );
          }
        }),
      );
    }
    return items.map((_, index) => results.get(index)!);
  }

  private outcome(
    item: DefinitionCommandStart,
    result: { kind: 'started' | 'running' | 'declined' } | { kind: 'failed'; message: string },
  ): DefinitionCommandOutcome {
    return {
      key: item.key,
      plane: item.plane,
      basis: item.basis,
      terminalID: item.request.id,
      ...result,
    };
  }

  private requireHuman(owner: number): void {
    if (this.ports.isAgentDriven(owner))
      throw new Error('Workspace commands require a person in this window.');
  }

  private requireOwner(owner: number, workspaceID: string): void {
    this.requireHuman(owner);
    if (!this.ports.ownsWorkspace(owner, workspaceID))
      throw new Error('The workspace is no longer available in this window.');
  }

  private async prepare(owner: number, item: DefinitionCommandStart): Promise<PreparedCommand> {
    this.requireOwner(owner, item.request.workspaceID);
    const found = this.lookup(owner, item);
    const definition = { ...found };
    if (!definition.command.trim() || !validInitialInput(definition.command))
      throw new Error('The workspace command must be one line of at most 1,000 characters.');
    if (item.request.profileID !== definition.profileID)
      throw new Error('The terminal profile does not match the workspace command.');
    const profile = this.ports.terminals.profile(definition.profileID);
    if (!profile) throw new Error('The terminal profile is no longer available.');
    const [cwd, requestedCwd, paneCwd] = await Promise.all([
      realpath(definition.cwd),
      realpath(item.request.cwd),
      realpath(definition.paneCwd),
    ]);
    if (cwd !== requestedCwd || cwd !== paneCwd)
      throw new Error('The terminal folder does not match the workspace command.');
    const confirmation: DefinitionCommandConfirmation = {
      key: item.key,
      cwd,
      profile,
      command: definition.command,
      workspaceName: definition.workspaceName,
    };
    return {
      paneCwd: definition.paneCwd,
      request: {
        id: item.request.id,
        workspaceID: item.request.workspaceID,
        rootID: item.request.rootID,
        profileID: item.request.profileID,
        cols: item.request.cols,
        rows: item.request.rows,
        cwd: item.request.cwd,
      },
      confirmation,
      fingerprint: definitionCommandFingerprint(confirmation),
    };
  }

  private lookup(owner: number, item: DefinitionCommandStart): DefinitionCommand {
    const found = this.ports.lookup(
      owner,
      item.key,
      item.plane,
      item.request.workspaceID,
      item.request.id,
    );
    if (!found) throw new Error('The workspace command is no longer available.');
    if (found.basis !== item.basis)
      throw new Error('The definition changed. Review the command again.');
    return found;
  }
}
