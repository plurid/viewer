import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { CommandRegistry, type CommandSource } from './registry';
export const CommandsContext = createContext<CommandRegistry | null>(null);
export function useCommands(): CommandRegistry {
  const registry = useContext(CommandsContext);
  if (!registry) throw new Error('Command registry is missing.');
  return registry;
}
export function useCommandRevision(): void {
  const registry = useCommands();
  useSyncExternalStore(registry.subscribe, registry.snapshot);
}
export function useCommandSource(
  id: string,
  source: CommandSource,
  dependencies: readonly unknown[],
): void {
  const registry = useCommands();
  const live = useRef(source);
  live.current = source;
  useEffect(
    () =>
      registry.register(id, {
        context: () => live.current.context(),
        definitions: () => live.current.definitions(),
        valid: (context, current) => live.current.valid?.(context, current) ?? true,
      }),
    [registry, id],
  );
  useEffect(() => {
    registry.touch();
  }, dependencies);
}
