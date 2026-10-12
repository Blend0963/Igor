/**
 * In-memory conversation store.
 * Extracted from ShodhMemoryStore — preserves the original behavior exactly.
 * Conversations are lost on server restart.
 */

import type { ConversationMessage, ConversationSummary, IConversationStore } from "./types.js";

export class InMemoryConversationStore implements IConversationStore {
  private conversations = new Map<string, ConversationMessage[]>();
  private knownUsers = new Set<string>();

  storeMessage(
    conversationId: string,
    userId: string,
    role: "user" | "assistant",
    content: string
  ): string {
    this.knownUsers.add(userId);
    const id = crypto.randomUUID();
    const messages = this.conversations.get(conversationId) || [];
    messages.push({
      id,
      conversationId,
      userId,
      role,
      content,
      createdAt: new Date(),
    });

    // Keep a longer durable history for MaDo's shared cross-device conversation.
    if (!conversationId.startsWith("mado-user:") && messages.length > 20) {
      messages.shift();
    }

    this.conversations.set(conversationId, messages);
    return id;
  }

  getConversationHistory(
    conversationId: string,
    limit: number = 10
  ): ConversationMessage[] {
    const messages = this.conversations.get(conversationId) || [];
    return messages.slice(-limit);
  }

  getRecentMessages(userId: string, hoursOld: number = 24, limit: number = 12, excludeConversationId?: string): ConversationMessage[] {
    const cutoff = Date.now() - hoursOld * 60 * 60 * 1000;
    return [...this.conversations.values()]
      .flat()
      .filter((msg) => msg.userId === userId
        && msg.createdAt.getTime() >= cutoff
        && (!excludeConversationId || msg.conversationId !== excludeConversationId))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-limit);
  }

  searchMessages(userId: string, query: string, limit: number = 6): ConversationMessage[] {
    const terms = [...new Set(query.toLocaleLowerCase().normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "").match(/[a-z0-9]{3,}/g) ?? [])]
      .filter((term) => !new Set(["rappelle", "rappeler", "souviens", "retrouve", "conversation", "parlais", "parlait", "remember", "recall", "about", "what", "when", "where", "with", "that", "this", "from", "were", "have", "avait", "avais", "dans", "pour", "avec", "quoi", "comment", "quel", "quelle"]).has(term));
    if (terms.length === 0) return [];
    return [...this.conversations.values()].flat()
      .filter((msg) => msg.userId === userId)
      .map((msg) => {
        const text = msg.content.toLocaleLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
        return { msg, score: terms.reduce((n, term) => n + (text.includes(term) ? 1 : 0), 0) };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.msg.createdAt.getTime() - a.msg.createdAt.getTime())
      .slice(0, limit)
      .sort((a, b) => a.msg.createdAt.getTime() - b.msg.createdAt.getTime())
      .map((item) => item.msg);
  }

  listConversations(userId: string): ConversationSummary[] {
    const results: ConversationSummary[] = [];

    for (const [convId, messages] of this.conversations.entries()) {
      // Only include conversations belonging to this user
      const userMessages = messages.filter((m) => m.userId === userId);
      if (userMessages.length === 0) continue;

      const lastMsg = userMessages[userMessages.length - 1];
      results.push({
        conversationId: convId,
        lastMessage: lastMsg.content,
        lastMessageAt: lastMsg.createdAt,
        messageCount: messages.length,
      });
    }

    // Sort by most recent first
    results.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
    return results;
  }

  deleteConversation(conversationId: string): number {
    const messages = this.conversations.get(conversationId);
    if (!messages) return 0;
    const count = messages.length;
    this.conversations.delete(conversationId);
    return count;
  }

  getKnownUsers(): string[] {
    return [...this.knownUsers];
  }

  cleanupOldConversations(hoursOld: number = 24): number {
    const cutoff = Date.now() - hoursOld * 60 * 60 * 1000;
    let deleted = 0;

    for (const [convId, messages] of this.conversations.entries()) {
      const lastMessage = messages[messages.length - 1];
      if (!convId.startsWith("mado-user:") && lastMessage && lastMessage.createdAt.getTime() < cutoff) {
        this.conversations.delete(convId);
        deleted += messages.length;
      }
    }

    return deleted;
  }

  close(): void {
    this.conversations.clear();
  }
}
