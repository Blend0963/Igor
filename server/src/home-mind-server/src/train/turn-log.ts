/**
 * The local model's real requests, kept on the house's own disk to train it
 * on how its owner actually speaks (train/local-dataset.ts realExamples()).
 *
 * One JSON line per Assist request the local model handled: the words, the
 * exchange before them as the model read it, its tool calls and whether each
 * worked, and its line for the voice. A request followed within two minutes
 * by "non, l'autre…" or "annule" marks the one before as corrected. Only
 * requests that worked and were not corrected become training examples; the
 * others are listed for review. Nothing here leaves the house unless the
 * owner downloads the training set.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { PastMessage } from "./local-dataset.js";

export interface LoggedCall {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface LoggedTurn {
  at: string;
  words: string;
  history: PastMessage[];
  calls: LoggedCall[];
  /** The line the request ended with: "-", ">rep", ">web"… */
  line: string;
  /** Local passes: only one-pass requests can be replayed as examples. */
  passes: number;
  /** Set by a correction that followed. */
  corrected?: boolean;
}

/** "Non, l'autre", "annule", "c'est pas ça": the request before was misunderstood. */
const CORRECTION = /^(igor,?\s*)?(non\b|pas (ça|celle|celui|cette|celle-là)|l'autre|je (t'ai dit|voulais|parlais)|annule|c'est pas|mauvais|tu t'es trompé|pas la bonne|pas le bon)/i;
const CORRECTION_WINDOW_MS = 120_000;

export class TurnLog {
  private last?: { at: number; iso: string };
  private lines = 0;

  constructor(private readonly path: string, private readonly max = 5000) {
    if (existsSync(path)) this.lines = readFileSync(path, "utf8").split("\n").filter(Boolean).length;
  }

  record(turn: Omit<LoggedTurn, "at">, now = new Date()): void {
    try {
      const at = now.toISOString();
      if (this.last && now.getTime() - this.last.at < CORRECTION_WINDOW_MS && CORRECTION.test(turn.words.trim())) {
        appendFileSync(this.path, `${JSON.stringify({ corrected: this.last.iso })}\n`);
        this.lines++;
      }
      appendFileSync(this.path, `${JSON.stringify({ at, ...turn })}\n`);
      this.lines++;
      this.last = { at: now.getTime(), iso: at };
      // Keep the newest: rewrite once the file holds twice what is kept.
      if (this.lines > this.max * 2) {
        const kept = readFileSync(this.path, "utf8").split("\n").filter(Boolean).slice(-this.max);
        writeFileSync(this.path, `${kept.join("\n")}\n`);
        this.lines = kept.length;
      }
    } catch (error) {
      console.warn(`[turn-log] could not record: ${error instanceof Error ? error.message : error}`);
    }
  }

  read(): LoggedTurn[] {
    if (!existsSync(this.path)) return [];
    const turns: LoggedTurn[] = [];
    const corrected = new Set<string>();
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as LoggedTurn & { corrected?: string | boolean };
        if (typeof o.corrected === "string") corrected.add(o.corrected);
        else if (typeof o.words === "string") turns.push(o);
      } catch {
        // a torn line: skip it
      }
    }
    return turns.map((t) => (corrected.has(t.at) ? { ...t, corrected: true } : t));
  }

  /** How often each entity was acted on by voice: one of the usage signals. */
  usage(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const t of this.read()) {
      if (t.corrected) continue;
      for (const c of t.calls) {
        if (c.name !== "call_service" || !c.ok) continue;
        for (const id of String(c.args.entity_id ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
    }
    return counts;
  }
}
