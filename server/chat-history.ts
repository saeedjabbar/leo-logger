import { randomUUID } from 'node:crypto';
import type { ChatMessage } from './types.js';

export function newChatMessages(input: {
  userId: string;
  babyId: string;
  userText: string;
  assistantText: string;
  provider: ChatMessage['provider'];
  eventIds: string[];
  now?: Date;
}) {
  const createdAt = (input.now || new Date()).toISOString();
  const exchangeId = randomUUID();
  const common = { userId: input.userId, babyId: input.babyId, exchangeId, createdAt };
  return [
    { ...common, id: randomUUID(), role: 'user', text: input.userText },
    { ...common, id: randomUUID(), role: 'assistant', text: input.assistantText, provider: input.provider, eventIds: input.eventIds },
  ] satisfies ChatMessage[];
}

export function allChatMessagesForUser(messages: ChatMessage[], userId: string, babyId: string) {
  return messages
    .filter((message) => message.userId === userId && message.babyId === babyId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.role === 'user' ? -1 : 1));
}

export function chatHistoryForUser(messages: ChatMessage[], userId: string, babyId: string, limit = 200) {
  return allChatMessagesForUser(messages, userId, babyId).slice(-Math.max(1, Math.min(limit, 500)));
}

export function publicChatMessage(message: ChatMessage) {
  return { id: message.id, role: message.role, text: message.text, createdAt: message.createdAt };
}
