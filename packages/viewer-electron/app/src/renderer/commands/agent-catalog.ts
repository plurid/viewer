import type { CommandContext, CommandRegistry, ResolvedCommand } from './registry';

/** Window actions keep their own scope; publishing a file selection must not hide them. */
export function agentCatalog(
  registry: CommandRegistry,
  context: CommandContext,
): ResolvedCommand[] {
  const commands = registry.list({
    paneID: context.paneID,
    context,
    scope: context.selection.length ? 'files' : context.folder ? 'folder' : 'preview',
  });
  const seen = new Set(commands.map(({ id }) => id));
  for (const command of registry.list({ sources: ['window'], context, scope: 'window' })) {
    if (seen.has(command.id)) continue;
    seen.add(command.id);
    commands.push(command);
  }
  return commands;
}
