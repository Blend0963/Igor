/**
 * In-memory conversation store.
 * Extracted from ShodhMemoryStore — preserves the original behavior exactly.
 * Conversations are lost on server restart.
 */

import type { ConversationMessage, ConversationSummary, IConversationStore, ThreadSummary } from "./types.js";
import { THREAD_PREFIX } from "./types.js";

export class InMemoryConversationStore implements IConversationStore {
  private conversations = new Map<string, ConversationMessage[]>();
  private knownUsers = new Set<string>();
  private embeddings = new Map<string, number[]>();
  private threads = new Map<string, { userId: string; title: string; createdAt: Date }>();

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

    // Keep a longer durable history for MaDo's own conversations (the shared
    // cross-device Assist conversation and every web-UI thread); other
    // conversations retain the existing 20-message cap.
    if (
      !conversationId.startsWith("mado-user:") &&
      !conversationId.startsWith(THREAD_PREFIX) &&
      messages.length > 20
    ) {
      messages.shift();
    }

    // A thread's sidebar entry shows its first user message until renamed.
    if (conversationId.startsWith(THREAD_PREFIX) && role === "user") {
      const thread = this.threads.get(conversationId);
      if (thread && thread.title === "") thread.title = content.slice(0, 80);
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
    if (!messages) {
      // A thread can exist with no messages at all.
      this.threads.delete(conversationId);
      return 0;
    }
    const count = messages.length;
    this.conversations.delete(conversationId);
    this.threads.delete(conversationId);
    return count;
  }

  getKnownUsers(): string[] {
    return [...this.knownUsers];
  }


  getMessagesWithoutEmbeddings(userId: string, limit: number = 30): ConversationMessage[] {
    return [...this.conversations.values()].flat()
      .filter(message => message.userId === userId && message.role === "user" && !this.embeddings.has(message.id))
      .sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime())
      .slice(0,Math.max(0,limit));
  }

  storeMessageEmbedding(messageId: string, embedding: number[]): void {
    this.embeddings.set(messageId, embedding);
  }

  searchSimilarMessages(userId: string, embedding: number[], limit: number = 6, conversationId?: string): ConversationMessage[] {
    const norm = (v:number[]) => Math.sqrt(v.reduce((sum,n)=>sum+n*n,0));
    const qnorm = norm(embedding);
    if (!qnorm) return [];
    const ranked: Array<{message: ConversationMessage; score:number}> = [];
    for (const messages of this.conversations.values()) for (const message of messages) {
      if (message.userId !== userId || message.role !== "user") continue;
      // A thread asks for its own distant past only; without a scope the
      // shared conversation keeps recalling across everything, as before.
      if (conversationId && message.conversationId !== conversationId) continue;
      const vector = this.embeddings.get(message.id);
      if (!vector || vector.length !== embedding.length) continue;
      const denom = qnorm * norm(vector);
      const score = denom ? vector.reduce((sum,n,i)=>sum+n*embedding[i],0)/denom : -1;
      if (score > 0.35) ranked.push({message,score});
    }
    return ranked.sort((a,b)=>b.score-a.score).slice(0,Math.max(0,limit)).map(x=>x.message);
  }

  createThread(userId: string, title?: string): ThreadSummary {
    this.knownUsers.add(userId);
    const id = `${THREAD_PREFIX}${crypto.randomUUID()}`;
    const createdAt = new Date();
    const cleanTitle = title?.trim() ?? "";
    this.threads.set(id, { userId, title: cleanTitle, createdAt });
    return { conversationId: id, title: cleanTitle, createdAt, lastMessageAt: createdAt, messageCount: 0 };
  }

  listThreads(userId: string): ThreadSummary[] {
    const results: ThreadSummary[] = [];
    for (const [conversationId, thread] of this.threads.entries()) {
      if (thread.userId !== userId) continue;
      const messages = this.conversations.get(conversationId) || [];
      const last = messages.length > 0 ? messages[messages.length - 1].createdAt : thread.createdAt;
      results.push({
        conversationId,
        title: thread.title,
        createdAt: thread.createdAt,
        lastMessageAt: last,
        messageCount: messages.length,
      });
    }
    return results.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  }

  renameThread(conversationId: string, title: string): boolean {
    const clean = title.trim();
    const thread = this.threads.get(conversationId);
    if (!thread || !clean) return false;
    thread.title = clean;
    return true;
  }

  cleanupOldConversations(hoursOld: number = 24): number {
    const cutoff = Date.now() - hoursOld * 60 * 60 * 1000;
    let deleted = 0;

    for (const [convId, messages] of this.conversations.entries()) {
      const lastMessage = messages[messages.length - 1];
      if (
        !convId.startsWith("mado-user:") &&
        !convId.startsWith(THREAD_PREFIX) &&
        lastMessage &&
        lastMessage.createdAt.getTime() < cutoff
      ) {
        this.conversations.delete(convId);
        deleted += messages.length;
      }
    }

    return deleted;
  }

  close(): void {
    this.conversations.clear();
    this.embeddings.clear();
    this.threads.clear();
  }
}
