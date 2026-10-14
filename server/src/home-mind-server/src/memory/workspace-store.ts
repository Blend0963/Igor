/**
 * What the chat panel organises around the conversations: projects (groups
 * of threads with their own instructions) and the cost counter (tokens and
 * estimated price per day and per thread). One small SQLite file next to the
 * conversation database, or in memory.
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { RequestUsage } from "../llm/interface.js";
import { estimateCost } from "../llm/prices.js";

export interface Project {
  id: string;
  name: string;
  instructions: string;
  createdAt: string;
}

export interface UsageDay {
  day: string;
  calls: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  cost: number;
  /** Requests on a model with no known price. */
  unpriced: number;
}

export const PROJECT_LIMITS = { name: 80, instructions: 8000, perUser: 50 } as const;

export class WorkspaceStore {
  private db: Database.Database;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        instructions TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_projects (
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        PRIMARY KEY (conversation_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS usage (
        day TEXT NOT NULL,
        user_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        model TEXT NOT NULL,
        calls INTEGER NOT NULL,
        prompt INTEGER NOT NULL,
        cached INTEGER NOT NULL,
        completion INTEGER NOT NULL,
        cost REAL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_user_day ON usage(user_id, day);
    `);
  }

  // ----- projects -----

  listProjects(userId: string): Project[] {
    return (
      this.db
        .prepare(`SELECT id, name, instructions, created_at FROM projects WHERE user_id = ? ORDER BY name COLLATE NOCASE`)
        .all(userId) as Array<{ id: string; name: string; instructions: string; created_at: string }>
    ).map((r) => ({ id: r.id, name: r.name, instructions: r.instructions, createdAt: r.created_at }));
  }

  getProject(userId: string, id: string): Project | undefined {
    return this.listProjects(userId).find((p) => p.id === id);
  }

  createProject(userId: string, name: string, instructions = ""): Project {
    if (this.listProjects(userId).length >= PROJECT_LIMITS.perUser) throw new Error("Too many projects.");
    const project = { id: randomUUID(), name, instructions, createdAt: new Date().toISOString() };
    this.db
      .prepare(`INSERT INTO projects (id, user_id, name, instructions, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(project.id, userId, name, instructions, project.createdAt);
    return project;
  }

  updateProject(userId: string, id: string, changes: { name?: string; instructions?: string }): boolean {
    const p = this.getProject(userId, id);
    if (!p) return false;
    this.db
      .prepare(`UPDATE projects SET name = ?, instructions = ? WHERE id = ? AND user_id = ?`)
      .run(changes.name ?? p.name, changes.instructions ?? p.instructions, id, userId);
    return true;
  }

  /** Deletes the project; its threads stay, outside any project. */
  deleteProject(userId: string, id: string): boolean {
    const changes = this.db.prepare(`DELETE FROM projects WHERE id = ? AND user_id = ?`).run(id, userId).changes;
    this.db.prepare(`DELETE FROM conversation_projects WHERE project_id = ? AND user_id = ?`).run(id, userId);
    return changes > 0;
  }

  setConversationProject(userId: string, conversationId: string, projectId: string | null): void {
    if (projectId === null) {
      this.db.prepare(`DELETE FROM conversation_projects WHERE conversation_id = ? AND user_id = ?`).run(conversationId, userId);
      return;
    }
    if (!this.getProject(userId, projectId)) throw new Error("No such project.");
    this.db
      .prepare(
        `INSERT INTO conversation_projects (conversation_id, user_id, project_id) VALUES (?, ?, ?)
         ON CONFLICT(conversation_id, user_id) DO UPDATE SET project_id = excluded.project_id`
      )
      .run(conversationId, userId, projectId);
  }

  /** conversation id → project id, for this user. */
  conversationProjects(userId: string): Map<string, string> {
    return new Map(
      (
        this.db.prepare(`SELECT conversation_id, project_id FROM conversation_projects WHERE user_id = ?`).all(userId) as Array<{
          conversation_id: string;
          project_id: string;
        }>
      ).map((r) => [r.conversation_id, r.project_id])
    );
  }

  projectOf(userId: string, conversationId: string): Project | undefined {
    const row = this.db
      .prepare(`SELECT project_id FROM conversation_projects WHERE conversation_id = ? AND user_id = ?`)
      .get(conversationId, userId) as { project_id: string } | undefined;
    return row ? this.getProject(userId, row.project_id) : undefined;
  }

  forgetConversation(userId: string, conversationId: string): void {
    this.db.prepare(`DELETE FROM conversation_projects WHERE conversation_id = ? AND user_id = ?`).run(conversationId, userId);
  }

  // ----- cost counter -----

  recordUsage(userId: string, conversationId: string, usage: RequestUsage, now = new Date()): void {
    if (!usage.calls) return;
    const cost = estimateCost(usage);
    this.db
      .prepare(
        `INSERT INTO usage (day, user_id, conversation_id, model, calls, prompt, cached, completion, cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        now.toISOString().slice(0, 10),
        userId,
        conversationId,
        usage.model,
        usage.calls,
        usage.promptTokens,
        usage.cachedTokens,
        usage.completionTokens,
        cost ?? null,
        now.toISOString()
      );
    // A year is plenty for a household counter.
    this.db.prepare(`DELETE FROM usage WHERE day < ?`).run(new Date(now.getTime() - 366 * 864e5).toISOString().slice(0, 10));
  }

  usageByDay(userId: string, days = 30, now = new Date()): UsageDay[] {
    const since = new Date(now.getTime() - (days - 1) * 864e5).toISOString().slice(0, 10);
    return (
      this.db
        .prepare(
          `SELECT day, SUM(calls) calls, SUM(prompt) prompt, SUM(cached) cached, SUM(completion) completion,
                  SUM(COALESCE(cost, 0)) cost, SUM(cost IS NULL) unpriced
           FROM usage WHERE user_id = ? AND day >= ? GROUP BY day ORDER BY day`
        )
        .all(userId, since) as Array<{ day: string; calls: number; prompt: number; cached: number; completion: number; cost: number; unpriced: number }>
    ).map((r) => ({
      day: r.day,
      calls: r.calls,
      promptTokens: r.prompt,
      cachedTokens: r.cached,
      completionTokens: r.completion,
      cost: Math.round(r.cost * 1e6) / 1e6,
      unpriced: r.unpriced,
    }));
  }

  usageByConversation(userId: string, days = 30, now = new Date()): Array<{ conversationId: string; calls: number; cost: number; tokens: number }> {
    const since = new Date(now.getTime() - (days - 1) * 864e5).toISOString().slice(0, 10);
    return (
      this.db
        .prepare(
          `SELECT conversation_id, SUM(calls) calls, SUM(COALESCE(cost, 0)) cost, SUM(prompt + completion) tokens
           FROM usage WHERE user_id = ? AND day >= ? GROUP BY conversation_id ORDER BY cost DESC LIMIT 20`
        )
        .all(userId, since) as Array<{ conversation_id: string; calls: number; cost: number; tokens: number }>
    ).map((r) => ({ conversationId: r.conversation_id, calls: r.calls, cost: Math.round(r.cost * 1e6) / 1e6, tokens: r.tokens }));
  }

  usageByModel(userId: string, days = 30, now = new Date()): Array<{ model: string; calls: number; cost: number }> {
    const since = new Date(now.getTime() - (days - 1) * 864e5).toISOString().slice(0, 10);
    return (
      this.db
        .prepare(
          `SELECT model, SUM(calls) calls, SUM(COALESCE(cost, 0)) cost FROM usage
           WHERE user_id = ? AND day >= ? GROUP BY model ORDER BY cost DESC`
        )
        .all(userId, since) as Array<{ model: string; calls: number; cost: number }>
    ).map((r) => ({ ...r, cost: Math.round(r.cost * 1e6) / 1e6 }));
  }

  close(): void {
    this.db.close();
  }
}
