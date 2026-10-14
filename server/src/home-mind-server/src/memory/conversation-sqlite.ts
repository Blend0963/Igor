/**
 * SQLite-backed conversation store.
 * Conversations persist across server restarts.
 * Uses better-sqlite3 (synchronous) for simplicity.
 */

import Database from "better-sqlite3";
import type { ConversationMessage, ConversationSummary, IConversationStore } from "./types.js";
import { summarizeTitle } from "./shared-memory.js";
import {
  DEFAULT_MESSAGE_CAP,
  isThreadId,
  THREAD_MESSAGE_CAP,
  type RecallScope,
} from "./memory-scope.js";

/** The SQL filter for a recall scope, on the `m` alias. */
function scopeClause(scope?: RecallScope): { sql: string; params: string[] } {
  let sql = "";
  const params: string[] = [];
  if (scope?.conversationId !== undefined) {
    sql += " AND m.conversation_id = ?";
    params.push(scope.conversationId);
  }
  if (scope?.excludeConversationPrefix) {
    // substr rather than LIKE: a prefix is matched literally, `_` and `%` included.
    sql += " AND substr(m.conversation_id, 1, ?) != ?";
    params.push(String(scope.excludeConversationPrefix.length), scope.excludeConversationPrefix);
  }
  return { sql, params };
}

export class SqliteConversationStore implements IConversationStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
      CREATE TABLE IF NOT EXISTS message_embeddings (
        message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        embedding TEXT NOT NULL
      );

      -- Users we have ever seen. Deliberately separate from messages: message
      -- rows are pruned after 24h by cleanupOldConversations(), so deriving the
      -- user list from them made getKnownUsers() return [] for anyone who had
      -- not chatted that day — which silently disabled the whole fact-cleanup
      -- job. Mirrors InMemoryConversationStore's knownUsers set, but durable.
      -- Names people gave their conversations (the panel's rename). Not
      -- derived from messages, so a renamed thread keeps its name as its
      -- messages roll over.
      CREATE TABLE IF NOT EXISTS conversation_titles (
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        PRIMARY KEY (conversation_id, user_id)
      );

      -- Favourite conversations (the panel's ★).
      CREATE TABLE IF NOT EXISTS conversation_pins (
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (conversation_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Backfill from any messages still present (upgrades from before the users table).
    this.db.exec(
      `INSERT OR IGNORE INTO users (user_id) SELECT DISTINCT user_id FROM messages`
    );
  }

  storeMessage(
    conversationId: string,
    userId: string,
    role: "user" | "assistant",
    content: string
  ): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(
      `INSERT OR IGNORE INTO users (user_id) VALUES (?)`
    ).run(userId);

    this.db.prepare(
      `INSERT INTO messages (id, conversation_id, user_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, conversationId, userId, role, content, now);

    // Keep a longer durable history for MaDo's shared cross-device conversation.
    // Threads keep their own longer cap; other transient conversations roll at 20.
    if (!conversationId.startsWith("mado-user:")) this.db.prepare(
      `DELETE FROM messages WHERE id IN (
        SELECT id FROM messages
        WHERE conversation_id = ?
        ORDER BY rowid DESC
        LIMIT -1 OFFSET ?
      )`
    ).run(conversationId, isThreadId(conversationId) ? THREAD_MESSAGE_CAP : DEFAULT_MESSAGE_CAP);

    return id;
  }

  getConversationHistory(
    conversationId: string,
    limit: number = 10
  ): ConversationMessage[] {
    const rows = this.db.prepare(
      `SELECT id, conversation_id, user_id, role, content, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY rowid DESC
       LIMIT ?`
    ).all(conversationId, limit) as Array<{
      id: string;
      conversation_id: string;
      user_id: string;
      role: "user" | "assistant";
      content: string;
      created_at: string;
    }>;

    // Reverse to get chronological order (oldest first)
    return rows.reverse().map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      userId: row.user_id,
      role: row.role,
      content: row.content,
      createdAt: new Date(row.created_at),
    }));
  }

  getRecentMessages(userId: string, hoursOld: number = 24, limit: number = 12, excludeConversationId?: string): ConversationMessage[] {
    const cutoff = new Date(Date.now() - hoursOld * 60 * 60 * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT id, conversation_id, user_id, role, content, created_at
      FROM messages
      WHERE user_id = ? AND created_at >= ?
        AND (? IS NULL OR conversation_id != ?)
      ORDER BY rowid DESC
      LIMIT ?
    `).all(userId, cutoff, excludeConversationId ?? null, excludeConversationId ?? null, limit) as Array<{
      id: string; conversation_id: string; user_id: string;
      role: "user" | "assistant"; content: string; created_at: string;
    }>;
    return rows.reverse().map((row) => ({
      id: row.id, conversationId: row.conversation_id, userId: row.user_id,
      role: row.role, content: row.content, createdAt: new Date(row.created_at),
    }));
  }

  listConversations(userId: string): ConversationSummary[] {
    const rows = this.db.prepare(
      `SELECT
        m.conversation_id,
        m.content AS last_message,
        m.created_at AS last_message_at,
        counts.cnt AS message_count
      FROM messages m
      JOIN (
        SELECT conversation_id, COUNT(*) AS cnt, MAX(rowid) AS max_rowid
        FROM messages
        WHERE user_id = ?
        GROUP BY conversation_id
      ) counts ON m.conversation_id = counts.conversation_id AND m.rowid = counts.max_rowid
      ORDER BY m.created_at DESC`
    ).all(userId) as Array<{
      conversation_id: string;
      last_message: string;
      last_message_at: string;
      message_count: number;
    }>;

    // The sidebar label: each conversation's first user message, looked up in
    // a second small query (one row per conversation) rather than a JOIN that
    // would make the summary query unreadable. Falls back to the last message
    // for a conversation that somehow has no user message left.
    const titles = new Map<string, string>(
      (
        this.db
          .prepare(
            `SELECT m.conversation_id AS conversation_id, m.content AS content
             FROM messages m
             JOIN (
               SELECT conversation_id, MIN(rowid) AS min_rowid
               FROM messages
               WHERE user_id = ? AND role = 'user'
               GROUP BY conversation_id
             ) firsts ON firsts.min_rowid = m.rowid`
          )
          .all(userId) as Array<{ conversation_id: string; content: string }>
      ).map((row) => [row.conversation_id, row.content])
    );

    const custom = new Map<string, string>(
      (
        this.db
          .prepare(`SELECT conversation_id, title FROM conversation_titles WHERE user_id = ?`)
          .all(userId) as Array<{ conversation_id: string; title: string }>
      ).map((row) => [row.conversation_id, row.title])
    );

    const pinned = new Set<string>(
      (
        this.db
          .prepare(`SELECT conversation_id FROM conversation_pins WHERE user_id = ?`)
          .all(userId) as Array<{ conversation_id: string }>
      ).map((row) => row.conversation_id)
    );

    return rows.map((row) => ({
      conversationId: row.conversation_id,
      pinned: pinned.has(row.conversation_id),
      title:
        custom.get(row.conversation_id) ??
        summarizeTitle(titles.get(row.conversation_id) ?? row.last_message),
      lastMessage: row.last_message,
      lastMessageAt: new Date(row.last_message_at),
      messageCount: row.message_count,
    }));
  }

  setConversationTitle(conversationId: string, userId: string, title: string): void {
    this.db
      .prepare(
        `INSERT INTO conversation_titles (conversation_id, user_id, title) VALUES (?, ?, ?)
         ON CONFLICT(conversation_id, user_id) DO UPDATE SET title = excluded.title`
      )
      .run(conversationId, userId, title);
  }

  setConversationPinned(conversationId: string, userId: string, pinned: boolean): void {
    if (pinned) {
      this.db
        .prepare(`INSERT OR IGNORE INTO conversation_pins (conversation_id, user_id) VALUES (?, ?)`)
        .run(conversationId, userId);
    } else {
      this.db.prepare(`DELETE FROM conversation_pins WHERE conversation_id = ? AND user_id = ?`).run(conversationId, userId);
    }
  }

  deleteConversation(conversationId: string, userId?: string): number {
    this.db
      .prepare(`DELETE FROM conversation_pins WHERE conversation_id = ? AND (? IS NULL OR user_id = ?)`)
      .run(conversationId, userId ?? null, userId ?? null);
    this.db
      .prepare(`DELETE FROM conversation_titles WHERE conversation_id = ? AND (? IS NULL OR user_id = ?)`)
      .run(conversationId, userId ?? null, userId ?? null);
    const result = this.db.prepare(
      `DELETE FROM messages WHERE conversation_id = ? AND (? IS NULL OR user_id = ?)`
    ).run(conversationId, userId ?? null, userId ?? null);
    return result.changes;
  }

  getKnownUsers(): string[] {
    const rows = this.db.prepare(
      `SELECT user_id FROM users ORDER BY first_seen_at`
    ).all() as Array<{ user_id: string }>;

    return rows.map((row) => row.user_id);
  }

  cleanupOldConversations(hoursOld: number = 24): number {
    const cutoff = new Date(Date.now() - hoursOld * 60 * 60 * 1000).toISOString();

    const result = this.db.prepare(
      `DELETE FROM messages WHERE conversation_id IN (
        SELECT conversation_id FROM messages
        -- Web threads (mado-thread:) are user-visible conversations in the
      -- panel: silently deleting one from under its own sidebar is not
      -- cleanup. They keep the 20-message rolling cap; only the shared
      -- Assist conversation and transient ids are pruned by age here.
      WHERE conversation_id NOT LIKE 'mado-user:%'
        AND conversation_id NOT LIKE 'mado-thread:%'
        GROUP BY conversation_id
        HAVING MAX(created_at) < ?
      )`
    ).run(cutoff);

    return result.changes;
  }



  getMessagesWithoutEmbeddings(userId: string, limit: number = 30, scope?: RecallScope): ConversationMessage[] {
    const { sql, params } = scopeClause(scope);
    const rows = this.db.prepare(`
      SELECT m.id, m.conversation_id, m.user_id, m.role, m.content, m.created_at
      FROM messages m LEFT JOIN message_embeddings e ON e.message_id = m.id
      WHERE m.user_id = ? AND m.role = 'user' AND e.message_id IS NULL${sql}
      ORDER BY m.rowid DESC LIMIT ?
    `).all(userId, ...params, limit) as Array<{id:string;conversation_id:string;user_id:string;role:"user"|"assistant";content:string;created_at:string}>;
    return rows.map(row => ({id:row.id,conversationId:row.conversation_id,userId:row.user_id,role:row.role,content:row.content,createdAt:new Date(row.created_at)}));
  }

  storeMessageEmbedding(messageId: string, embedding: number[]): void {
    this.db.prepare(`INSERT OR REPLACE INTO message_embeddings (message_id, embedding) VALUES (?, ?)`)
      .run(messageId, JSON.stringify(embedding));
  }

  searchSimilarMessages(userId: string, embedding: number[], limit: number = 6, scope?: RecallScope): ConversationMessage[] {
    const { sql, params } = scopeClause(scope);
    const rows = this.db.prepare(`
      SELECT m.id, m.conversation_id, m.user_id, m.role, m.content, m.created_at, e.embedding
      FROM messages m JOIN message_embeddings e ON e.message_id = m.id
      WHERE m.user_id = ? AND m.role = 'user'${sql}
      ORDER BY m.rowid DESC
    `).all(userId, ...params) as Array<{id:string;conversation_id:string;user_id:string;role:"user"|"assistant";content:string;created_at:string;embedding:string}>;
    const norm = (v:number[]) => Math.sqrt(v.reduce((sum,n)=>sum+n*n,0));
    const qnorm = norm(embedding);
    if (!qnorm) return [];
    return rows.map(row => {
      const vector = JSON.parse(row.embedding) as number[];
      if (vector.length !== embedding.length) return { row, score: -1 };
      const denom = qnorm * norm(vector);
      const score = denom ? vector.reduce((sum,n,i)=>sum+n*embedding[i],0)/denom : -1;
      return { row, score };
    }).filter(item => item.score > 0.35)
      .sort((a,b)=>b.score-a.score).slice(0, Math.max(0,limit))
      .map(({row})=>({id:row.id,conversationId:row.conversation_id,userId:row.user_id,role:row.role,content:row.content,createdAt:new Date(row.created_at)}));
  }

  close(): void {
    this.db.close();
  }
}
