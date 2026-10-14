import type { RecallScope } from "./memory-scope.js";

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
  // Sidebar label for the thread: the conversation's first user message,
  // flattened to one line and truncated. Falls back to the last message
  // when no user message is stored, so a summary never renders blank.
  title: string;
  lastMessage: string;
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
  /** With `userId`, deletes only that user's messages in the conversation. */
  deleteConversation(conversationId: string, userId?: string): number | Promise<number>;
  getKnownUsers(): string[];
  cleanupOldConversations(hoursOld?: number): number | Promise<number>;
  storeMessageEmbedding?(messageId: string, embedding: number[]): void | Promise<void>;
  searchSimilarMessages?(userId: string, embedding: number[], limit?: number, scope?: RecallScope): ConversationMessage[] | Promise<ConversationMessage[]>;
  getMessagesWithoutEmbeddings?(userId: string, limit?: number, scope?: RecallScope): ConversationMessage[] | Promise<ConversationMessage[]>;
  close(): void;
}
