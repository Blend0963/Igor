export type FactCategory =
  | "baseline" // Sensor normal values ("NOx 100ppm is normal")
  | "preference" // User preferences ("prefers 22°C")
  | "identity" // User info ("name is Alex")
  | "device" // Device nicknames ("main light = light.wled_kitchen")
  | "pattern" // Routines ("usually home by 6pm")
  | "correction"; // Corrections ("actually X, not Y")

export interface Fact {
  id: string;
  userId: string;
  content: string;
  category: FactCategory;
  confidence: number;
  createdAt: Date;
  lastUsed: Date;
  useCount: number;
}

export interface ExtractedFact {
  content: string;
  category: FactCategory;
  confidence?: number; // 0.0–1.0, how confident the LLM is this is a lasting fact
  replaces?: string[]; // IDs of existing facts this one supersedes
}

/**
 * Conversation ids with this prefix are web-UI discussion threads, created
 * through the thread API and isolated from the shared Assist conversation.
 * Kept next to the store interfaces so the engine, the stores and the routes
 * all agree on the one spelling.
 */
export const THREAD_PREFIX = "mado-thread:";

export interface ConversationMessage {
  id: string;
  conversationId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export interface ConversationSummary {
  conversationId: string;
  lastMessage: string;
  lastMessageAt: Date;
  messageCount: number;
}

/**
 * A web-UI discussion thread, as the sidebar sees it. Threads are ordinary
 * conversations with a life of their own: a title, and durability — unlike
 * transient conversation ids, a thread survives the 24h cleanup and the
 * 20-message cap, because the whole point of a thread list is coming back
 * to a discussion days later. Long-term facts stay shared across threads;
 * the thread isolates the short-term history and the semantic recall.
 */
export interface ThreadSummary {
  conversationId: string;
  title: string;
  createdAt: Date;
  lastMessageAt: Date;
  messageCount: number;
}

export interface IConversationStore {
  storeMessage(
    conversationId: string,
    userId: string,
    role: "user" | "assistant",
    content: string
  ): string;
  getConversationHistory(
    conversationId: string,
    limit?: number
  ): ConversationMessage[] | Promise<ConversationMessage[]>;
  getRecentMessages(userId: string, hoursOld?: number, limit?: number, excludeConversationId?: string): ConversationMessage[] | Promise<ConversationMessage[]>;
  listConversations(
    userId: string
  ): ConversationSummary[] | Promise<ConversationSummary[]>;
  deleteConversation(conversationId: string): number | Promise<number>;
  getKnownUsers(): string[];
  cleanupOldConversations(hoursOld?: number): number | Promise<number>;
  storeMessageEmbedding?(messageId: string, embedding: number[]): void | Promise<void>;
  searchSimilarMessages?(userId: string, embedding: number[], limit?: number, conversationId?: string): ConversationMessage[] | Promise<ConversationMessage[]>;
  getMessagesWithoutEmbeddings?(userId: string, limit?: number): ConversationMessage[] | Promise<ConversationMessage[]>;
  // Web-UI threads. Optional because stores that predate threads (and test
  // fakes) still satisfy the interface without them; the routes answer 501
  // when the configured store does not implement them.
  createThread?(userId: string, title?: string): ThreadSummary | Promise<ThreadSummary>;
  listThreads?(userId: string): ThreadSummary[] | Promise<ThreadSummary[]>;
  renameThread?(conversationId: string, title: string): boolean | Promise<boolean>;
  close(): void;
}
