import { describe, expect, it } from 'vitest';
import { chatHistoryForUser, newChatMessages, publicChatMessage } from './chat-history.js';
import type { ChatMessage } from './types.js';

const message = (id: string, userId: string, babyId: string, createdAt: string): ChatMessage => ({
  id, exchangeId: id, userId, babyId, role: 'user', text: id, createdAt,
});

describe('chat history privacy', () => {
  it('returns only the current user and baby in chronological order', () => {
    const messages = [
      message('later', 'saeed', 'leo', '2026-08-22T02:00:00.000Z'),
      message('other-user', 'florence', 'leo', '2026-08-22T01:30:00.000Z'),
      message('earlier', 'saeed', 'leo', '2026-08-22T01:00:00.000Z'),
      message('other-baby', 'saeed', 'mia', '2026-08-22T01:00:00.000Z'),
    ];
    expect(chatHistoryForUser(messages, 'saeed', 'leo').map((item) => item.id)).toEqual(['earlier', 'later']);
  });

  it('stores an exchange but exposes only the client contract', () => {
    const [user, assistant] = newChatMessages({ userId: 'saeed', babyId: 'leo', userText: 'log a pee', assistantText: 'Logged pee.', provider: 'built-in', eventIds: ['event'], now: new Date('2026-08-22T01:00:00.000Z') });
    expect(user.exchangeId).toBe(assistant.exchangeId);
    expect(publicChatMessage(assistant)).toEqual({ id: assistant.id, role: 'assistant', text: 'Logged pee.', createdAt: '2026-08-22T01:00:00.000Z' });
  });
});
