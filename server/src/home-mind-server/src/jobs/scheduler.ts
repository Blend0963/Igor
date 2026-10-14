/**
 * Reminders and scheduled tasks ("rappelle-moi de sortir les poubelles mardi
 * soir", "chaque dimanche, fais-moi le bilan énergie"), and the morning
 * briefing, which is one of them.
 *
 * - A reminder is a fixed text: at its time it is sent as a notification and
 *   written into the "Rappels et tâches" thread. No model call, no cost.
 * - A task is a request MaDo runs at its time, like a message typed in a
 *   thread; its answer goes to that thread and, shortened, to the phone.
 *
 * Times are the house's local time (Home Assistant's time zone). Kept in a
 * JSON file next to the conversation database; checked every 30 seconds.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IChatEngine } from "../llm/interface.js";
import type { IConversationStore } from "../memory/types.js";

export type Schedule =
  | { type: "once"; at: string }
  | { type: "daily"; time: string }
  | { type: "weekly"; days: number[]; time: string };

export interface ScheduledTask {
  id: string;
  userId: string;
  kind: "reminder" | "task";
  text: string;
  schedule: Schedule;
  nextRunAt: string;
  createdAt: string;
  /** Built in from the add-on options (the morning briefing); not removable by the model. */
  builtin?: boolean;
  lastRunAt?: string;
  lastError?: string;
}

export const TASKS_THREAD = "mado-thread:scheduled-tasks";
export const BRIEFING_THREAD = "mado-thread:morning-briefing";
/** Tasks one user may keep, so a loop of the model cannot fill the store. */
export const MAX_TASKS_PER_USER = 50;
const TICK_MS = 30_000;

const DAY_NAMES: Record<string, number> = {
  sun: 0, sunday: 0, dim: 0, dimanche: 0,
  mon: 1, monday: 1, lun: 1, lundi: 1,
  tue: 2, tuesday: 2, mar: 2, mardi: 2,
  wed: 3, wednesday: 3, mer: 3, mercredi: 3,
  thu: 4, thursday: 4, jeu: 4, jeudi: 4,
  fri: 5, friday: 5, ven: 5, vendredi: 5,
  sat: 6, saturday: 6, sam: 6, samedi: 6,
};

export function parseDays(days: unknown): number[] {
  const list = Array.isArray(days) ? days : typeof days === "string" ? days.split(/[,\s]+/) : [];
  const out = new Set<number>();
  for (const d of list) {
    if (typeof d === "number" && d >= 0 && d <= 6) out.add(d);
    else if (typeof d === "string" && DAY_NAMES[d.toLowerCase()] !== undefined) out.add(DAY_NAMES[d.toLowerCase()]);
  }
  return [...out].sort();
}

// ----- time zone arithmetic (no dependency) -----

interface LocalParts { y: number; m: number; d: number; h: number; mi: number; wd: number }

/** The wall-clock parts of an instant in a time zone. */
export function localParts(date: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), h: Number(get("hour")) % 24, mi: Number(get("minute")), wd };
}

/** The instant at which a time zone's clock shows this local date and time. */
export function zonedTime(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    guess += Date.UTC(y, m - 1, d, h, mi) - shown;
  }
  return new Date(guess);
}

function parseTime(time: string): { h: number; mi: number } {
  const m = /^(\d{1,2})[:hH](\d{2})?$/.exec(time.trim());
  if (!m) throw new Error(`"${time}" is not a time (HH:MM).`);
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (h > 23 || mi > 59) throw new Error(`"${time}" is not a time (HH:MM).`);
  return { h, mi };
}

/** A local date-time ("2026-10-20T19:00", or with an offset) as an instant. */
export function parseWhen(when: string, tz: string): Date {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(when)) {
    const d = new Date(when);
    if (Number.isNaN(d.getTime())) throw new Error(`"${when}" is not a date and time.`);
    return d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(when.trim());
  if (!m) throw new Error(`"${when}" is not a date and time (YYYY-MM-DDTHH:MM).`);
  return zonedTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
}

/** The next run of a schedule strictly after `after`, or undefined when it is over. */
export function nextRun(schedule: Schedule, after: Date, tz: string): Date | undefined {
  if (schedule.type === "once") {
    const at = new Date(schedule.at);
    return at.getTime() > after.getTime() ? at : undefined;
  }
  const { h, mi } = parseTime(schedule.time);
  const today = localParts(after, tz);
  for (let offset = 0; offset <= 8; offset++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + offset));
    const wd = day.getUTCDay();
    if (schedule.type === "weekly" && !schedule.days.includes(wd)) continue;
    const candidate = zonedTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, tz);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return undefined;
}

export function describeSchedule(s: Schedule, tz: string): string {
  const names = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  if (s.type === "once") {
    return new Date(s.at).toLocaleString("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  }
  if (s.type === "daily") return `tous les jours à ${s.time}`;
  return `chaque ${s.days.map((d) => names[d]).join(", ")} à ${s.time}`;
}

// ----- the scheduler -----

export interface SchedulerDeps {
  llm: IChatEngine;
  conversations?: IConversationStore;
  notify: (title: string, message: string) => Promise<void>;
  timeZone: () => Promise<string>;
  /** JSON file the tasks live in; undefined keeps them in memory. */
  storePath?: string;
}

export interface BriefingOptions {
  userId: string;
  time?: string;
  prompt?: string;
}

export const DEFAULT_BRIEFING_PROMPT =
  "Fais mon résumé du matin, court et clair : la météo du jour (entité weather), les températures intérieures, " +
  "la consommation électrique d'hier si un capteur d'énergie existe, et tout ce qui sort de l'ordinaire dans la maison " +
  "(portes ou fenêtres ouvertes, batteries faibles, appareils restés allumés). Ne mentionne pas ce qui est normal.";

/** Plain text for a phone notification: no Markdown, links or charts, and short. */
export function notificationText(text: string, max = 900): string {
  const plain = text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export class Scheduler {
  private tasks: ScheduledTask[] = [];
  private timer?: NodeJS.Timeout;
  private running = new Set<string>();

  constructor(private deps: SchedulerDeps) {
    if (deps.storePath && existsSync(deps.storePath)) {
      try {
        const raw = JSON.parse(readFileSync(deps.storePath, "utf8"));
        if (Array.isArray(raw)) this.tasks = raw;
      } catch (error) {
        console.warn("[scheduler] could not read the task file:", error instanceof Error ? error.message : error);
      }
    }
  }

  private save(): void {
    if (!this.deps.storePath) return;
    try {
      writeFileSync(this.deps.storePath, JSON.stringify(this.tasks, null, 1), { mode: 0o600 });
    } catch (error) {
      console.warn("[scheduler] could not save tasks:", error instanceof Error ? error.message : error);
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The morning briefing from the add-on options: added, moved or removed. */
  async configureBriefing(options: BriefingOptions): Promise<void> {
    const existing = this.tasks.find((t) => t.builtin && t.id === "morning-briefing");
    if (!options.time) {
      if (existing) {
        this.tasks = this.tasks.filter((t) => t !== existing);
        this.save();
      }
      return;
    }
    const tz = await this.deps.timeZone();
    const schedule: Schedule = { type: "daily", time: options.time };
    const next = nextRun(schedule, new Date(), tz);
    if (!next) return;
    const task: ScheduledTask = {
      id: "morning-briefing",
      userId: options.userId,
      kind: "task",
      text: options.prompt?.trim() || DEFAULT_BRIEFING_PROMPT,
      schedule,
      nextRunAt: next.toISOString(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      builtin: true,
    };
    this.tasks = [...this.tasks.filter((t) => t !== existing), task];
    this.save();
    console.log(`[scheduler] morning briefing every day at ${options.time} (${tz})`);
  }

  async add(input: { userId: string; kind: "reminder" | "task"; text: string; schedule: Schedule }): Promise<ScheduledTask> {
    const text = input.text.trim().slice(0, 2000);
    if (!text) throw new Error("The reminder or task needs a text.");
    if (this.list(input.userId).filter((t) => !t.builtin).length >= MAX_TASKS_PER_USER) {
      throw new Error(`There are already ${MAX_TASKS_PER_USER} scheduled items; cancel some first.`);
    }
    const tz = await this.deps.timeZone();
    const next = nextRun(input.schedule, new Date(), tz);
    if (!next) throw new Error("That time is already past.");
    const task: ScheduledTask = {
      id: randomUUID().slice(0, 8),
      userId: input.userId,
      kind: input.kind,
      text,
      schedule: input.schedule,
      nextRunAt: next.toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(task);
    this.save();
    return task;
  }

  list(userId: string): ScheduledTask[] {
    return this.tasks.filter((t) => t.userId === userId).sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
  }

  /** Removes one; the built-in briefing only through `allowBuiltin` (the panel), never the model. */
  cancel(userId: string, id: string, allowBuiltin = false): boolean {
    const task = this.tasks.find((t) => t.userId === userId && t.id === id);
    if (!task || (task.builtin && !allowBuiltin)) return false;
    this.tasks = this.tasks.filter((t) => t !== task);
    this.save();
    return true;
  }

  async timeZone(): Promise<string> {
    return this.deps.timeZone();
  }

  /** Runs everything due now. Public for tests. */
  async tick(now = new Date()): Promise<void> {
    const due = this.tasks.filter((t) => new Date(t.nextRunAt).getTime() <= now.getTime() && !this.running.has(t.id));
    for (const task of due) {
      this.running.add(task.id);
      try {
        await this.run(task);
        task.lastError = undefined;
      } catch (error) {
        task.lastError = error instanceof Error ? error.message : String(error);
        console.warn(`[scheduler] ${task.id} failed: ${task.lastError}`);
      } finally {
        this.running.delete(task.id);
      }
      task.lastRunAt = now.toISOString();
      const next = nextRun(task.schedule, now, await this.deps.timeZone());
      if (next) task.nextRunAt = next.toISOString();
      else this.tasks = this.tasks.filter((t) => t !== task);
      this.save();
    }
  }

  private async run(task: ScheduledTask): Promise<void> {
    const thread = task.builtin ? BRIEFING_THREAD : TASKS_THREAD;
    if (task.kind === "reminder") {
      console.log(`[scheduler] reminder ${task.id}`);
      this.deps.conversations?.storeMessage(thread, task.userId, "assistant", `⏰ **Rappel** : ${task.text}`);
      await this.ensureTitle(thread, task.userId, "Rappels et tâches");
      await this.deps.notify("⏰ Rappel", task.text);
      return;
    }
    console.log(`[scheduler] task ${task.id}`);
    const response = await this.deps.llm.chat({
      message: task.builtin ? task.text : `[Tâche programmée] ${task.text}`,
      userId: task.userId,
      conversationId: thread,
    });
    await this.ensureTitle(thread, task.userId, task.builtin ? "Résumé du matin" : "Rappels et tâches");
    if (response.response.trim()) {
      await this.deps.notify(task.builtin ? "☀️ Résumé du matin" : "MaDo", notificationText(response.response));
    }
  }

  private async ensureTitle(thread: string, userId: string, title: string): Promise<void> {
    const store = this.deps.conversations;
    if (!store?.setConversationTitle) return;
    const listed = (await store.listConversations(userId)).find((c) => c.conversationId === thread);
    if (listed && listed.title !== title) await store.setConversationTitle(thread, userId, title);
  }
}

let shared: Scheduler | undefined;
export function setScheduler(s: Scheduler | undefined): void {
  shared = s;
}
export function getScheduler(): Scheduler | undefined {
  return shared;
}
