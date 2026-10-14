/**
 * Where one chat request reads and writes memory.
 *
 * Two worlds, sealed from each other:
 *
 * - **Assist** (voice satellites, the phone, the laptop, any Home Assistant
 *   conversation): one durable conversation per MaDo user and one long-term
 *   fact bucket keyed by the user id, shared by every device.
 * - **A panel thread** (`mado-thread:<id>`): a chat-app conversation with its
 *   own history, its own long-term facts and its own semantic recall. It sees
 *   nothing of Assist or of the other threads, and nothing it learns reaches
 *   them.
 *
 * Messages keep the real user id in the conversation store (ownership checks
 * and the known-users list depend on it), so a thread's fact bucket never
 * shows up as a "known user" and is never merged into the shared memory.
 */

export const THREAD_PREFIX = "mado-thread:";

/**
 * Messages one thread keeps. Other transient conversations roll at 20, which
 * would make a thread forget its own beginning after ten exchanges; the model
 * still sees only the latest turns, and recalls the rest semantically.
 */
export const THREAD_MESSAGE_CAP = 500;
export const DEFAULT_MESSAGE_CAP = 20;

/** Which stored messages semantic recall may draw from. */
export interface RecallScope {
  /** Only messages of this conversation. */
  conversationId?: string;
  /** Never messages whose conversation id starts with this. */
  excludeConversationPrefix?: string;
}

export interface MemoryScope {
  /** The conversation the turn's history is read from and stored in. */
  conversationId: string;
  /** The long-term fact bucket (Shodh user id) for recall, extraction and forget_memory. */
  factBucket: string;
  /** What semantic recall may search. */
  recall: RecallScope;
  isThread: boolean;
}

export function isThreadId(conversationId: string | undefined): conversationId is string {
  return typeof conversationId === "string" && conversationId.startsWith(THREAD_PREFIX);
}

/** The long-term fact bucket of one thread. */
export function threadFactBucket(userId: string, conversationId: string): string {
  return `${userId}@${conversationId}`;
}

export function resolveMemoryScope(userId: string, conversationId?: string): MemoryScope {
  if (isThreadId(conversationId)) {
    return {
      conversationId,
      factBucket: threadFactBucket(userId, conversationId),
      recall: { conversationId },
      isThread: true,
    };
  }
  // Home Assistant sends its own conversation ids (a new one per chat log);
  // those must not fragment the one conversation Assist shares across devices.
  return {
    conversationId: `mado-user:${userId}`,
    factBucket: userId,
    recall: { excludeConversationPrefix: THREAD_PREFIX },
    isThread: false,
  };
}

/** Whether a stored message falls inside a recall scope. */
export function inRecallScope(conversationId: string, scope?: RecallScope): boolean {
  if (!scope) return true;
  if (scope.conversationId !== undefined && conversationId !== scope.conversationId) return false;
  if (scope.excludeConversationPrefix && conversationId.startsWith(scope.excludeConversationPrefix)) {
    return false;
  }
  return true;
}
