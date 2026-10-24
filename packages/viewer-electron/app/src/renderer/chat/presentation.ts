import type { ChatMessage } from '../../domain/models/chat';

export function messageAuthor(message: ChatMessage): string {
  if (message.role === 'user') return 'You';
  if (message.role === 'tool') return 'Inspected context';
  return message.provider?.name ?? 'Assistant';
}
