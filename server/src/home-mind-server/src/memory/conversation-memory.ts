/**
 * In-memory conversation store.
 * Extracted from ShodhMemoryStore — preserves the original behavior exactly.
 * Conversations are lost on server restart.
 */

import type { ConversationMessage, ConversationSummary, IConversationStore } from "./types.js";
import {
  DEFAULT_MESSAGE_CAP,
  inRecallScope,
  isThreadId,
  THREAD_MESSAGE_CAP,
  type RecallScope,
} from "./memory-scope.js";
import { summarizeTitle } from "./shared-memory.js";

export class InMemoryConversationStore implements IConversationStore {
  private conversations = new Map<string, ConversationMessage[]>();
  private knownUsers = new Set<string>();
  private embeddings = new Map<string, number[]>();

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
    const cap = isThreadId(conversationId) ? THREAD_MESSAGE_CAP : DEFAULT_MESSAGE_CAP;
    if (!conversationId.startsWith("mado-user:") && messages.length > cap) {
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

  listConversations(userId: string): ConversationSummary[] {
    const results: ConversationSummary[] = [];

    for (const [convId, messages] of this.conversations.entries()) {
      // Only include conversations belonging to this user
      const userMessages = messages.filter((m) => m.userId === userId);
      if (userMessages.length === 0) continue;

      const lastMsg = userMessages[userMessages.length - 1];
      // Sidebar label: the first user message, not the most recent one — a
      // thread about insulating the attic stays labelled by the question
      // that opened it. Falls back to the last message if none exists.
      const firstUser = messages.find((m) => m.userId === userId && m.role === "user");
      results.push({
        conversationId: convId,
        title: summarizeTitle((firstUser ?? lastMsg).content),
        lastMessage: lastMsg.content,
        lastMessageAt: lastMsg.createdAt,
        messageCount: messages.length,
      });
    }

    // Sort by most recent first
    results.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
    return results;
  }

  deleteConversation(conversationId: string, userId?: string): number {
    const messages = this.conversations.get(conversationId);
    if (!messages) return 0;
    if (userId === undefined) {
      this.conversations.delete(conversationId);
      return messages.length;
    }
    const kept = messages.filter((m) => m.userId !== userId);
    const count = messages.length - kept.length;
    if (kept.length) this.conversations.set(conversationId, kept);
    else this.conversations.delete(conversationId);
    return count;
  }

  getKnownUsers(): string[] {
    return [...this.knownUsers];
  }



  getMessagesWithoutEmbeddings(userId: string, limit: number = 30, scope?: RecallScope): ConversationMessage[] {
    return [...this.conversations.values()].flat()
      .filter(message => message.userId === userId && message.role === "user" && !this.embeddings.has(message.id)
        && inRecallScope(message.conversationId, scope))
      .sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime())
      .slice(0,Math.max(0,limit));
  }

  storeMessageEmbedding(messageId: string, embedding: number[]): void {
    this.embeddings.set(messageId, embedding);
  }

  searchSimilarMessages(userId: string, embedding: number[], limit: number = 6, scope?: RecallScope): ConversationMessage[] {
    const norm = (v:number[]) => Math.sqrt(v.reduce((sum,n)=>sum+n*n,0));
    const qnorm = norm(embedding);
    if (!qnorm) return [];
    const ranked: Array<{message: ConversationMessage; score:number}> = [];
    for (const messages of this.conversations.values()) for (const message of messages) {
      if (message.userId !== userId || message.role !== "user") continue;
      if (!inRecallScope(message.conversationId, scope)) continue;
      const vector = this.embeddings.get(message.id);
      if (!vector || vector.length !== embedding.length) continue;
      const denom = qnorm * norm(vector);
      const score = denom ? vector.reduce((sum,n,i)=>sum+n*embedding[i],0)/denom : -1;
      if (score > 0.35) ranked.push({message,score});
    }
    return ranked.sort((a,b)=>b.score-a.score).slice(0,Math.max(0,limit)).map(x=>x.message);
  }

  cleanupOldConversations(hoursOld: number = 24): number {
    const cutoff = Date.now() - hoursOld * 60 * 60 * 1000;
    let deleted = 0;

    for (const [convId, messages] of this.conversations.entries()) {
      const lastMessage = messages[messages.length - 1];
      if (
        // Web threads (mado-thread:) are user-visible in the panel; deleting
        // one by age is not cleanup. They keep the 20-message rolling cap.
        !convId.startsWith("mado-user:") &&
        !convId.startsWith("mado-thread:") &&
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
  }
}
