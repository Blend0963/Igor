/**
 * Igor's spoken exchanges, as the wall tablet's journal shows them: the
 * words, each step of the local turn (trace), what was done and the answer.
 * One JSON line per exchange, on the house's own disk next to the
 * conversation database; the newest `max` are kept. Read back by
 * GET /api/journal/:userId for the tablet's history.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { TraceStep } from "../llm/interface.js";

export interface JournalEntry {
  at: string;
  user: string;
  words: string;
  answer: string;
  /** Carried out without a word. */
  silent?: boolean;
  /** What was done, as the action chips say it ("Salon allumé"). */
  done: string[];
  trace: TraceStep[];
}

export class VoiceJournal {
  private lines = 0;

  constructor(private readonly path: string, private readonly max = 1000) {
    try {
      if (existsSync(path)) this.lines = readFileSync(path, "utf8").split("\n").filter(Boolean).length;
    } catch {
      this.lines = 0;
    }
  }

  record(entry: Omit<JournalEntry, "at">, now = new Date()): void {
    try {
      appendFileSync(this.path, `${JSON.stringify({ at: now.toISOString(), ...entry })}\n`);
      this.lines++;
      // Keep the newest: rewrite once the file holds twice what is kept.
      if (this.lines > this.max * 2) {
        const kept = readFileSync(this.path, "utf8").split("\n").filter(Boolean).slice(-this.max);
        writeFileSync(this.path, `${kept.join("\n")}\n`);
        this.lines = kept.length;
      }
    } catch (error) {
      console.warn(`[journal] could not record: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** The newest exchanges of one user, newest last, at most `limit`. */
  read(user: string, limit = 50): JournalEntry[] {
    if (!existsSync(this.path)) return [];
    const out: JournalEntry[] = [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as JournalEntry;
        if (e.user === user && typeof e.words === "string") out.push(e);
      } catch {
        // a torn line: skip it
      }
    }
    return out.slice(-Math.max(1, Math.min(limit, this.max)));
  }
}
