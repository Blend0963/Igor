/**
 * The house watch: Igor speaking up when something is wrong, on the same
 * channel as reminders.
 *
 * Two stages, so watching costs almost nothing. Every few minutes plain code
 * reads the house and flags what may need attention (a water leak, smoke, a
 * window open for half an hour, a dying battery, a device gone unavailable,
 * an automation that failed, everyone out with lights on). Only when
 * something new is flagged does one short call on the cheap model judge it
 * with some context (weather, who is home) and write the notification, or
 * decide it is normal and stay quiet. Safety alarms always go out.
 *
 * Each flag is told once per cooldown (urgent 1 h, warning 6 h, info 24 h);
 * quiet hours hold back all but urgent ones; a daily cap bounds the rest.
 * The optional "lively" check asks the model once a day, at a set time,
 * whether there is one genuinely useful thing to say ("il va geler cette
 * nuit et la fenêtre du garage est ouverte").
 *
 * Alerts are also written into the "Veille de la maison" thread, where the
 * user can answer them like any message.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AutomationTrace, EntityState } from "../ha/client.js";
import type { IConversationStore } from "../memory/types.js";
import type { OneShot } from "../llm/one-shot.js";
import { localParts, notificationText } from "./scheduler.js";

export const WATCH_THREAD = "mado-thread:house-watch";
export const WATCH_THREAD_TITLE = "Veille de la maison";

export type WatchLevel = "urgent" | "warn" | "info";

export interface WatchFinding {
  key: string;
  level: WatchLevel;
  text: string;
}

const COOLDOWN_MS: Record<WatchLevel, number> = { urgent: 3_600_000, warn: 6 * 3_600_000, info: 24 * 3_600_000 };
const OPEN_MINUTES = 30;
const UNAVAILABLE_MINUTES = 60;
const BATTERY_LOW = 15;
const COLD = 5;
const HOT = 35;
const AWAY_LIGHTS_MINUTES = 15;
const TRACE_CHECK_MS = 30 * 60_000;

const SAFETY_CLASSES = new Set(["moisture", "smoke", "gas", "carbon_monoxide", "safety", "heat"]);
const OPENING_CLASSES = new Set(["door", "window", "garage_door", "opening"]);
const WATCHED_DOMAINS = new Set([
  "light", "switch", "climate", "lock", "cover", "binary_sensor", "sensor", "camera",
  "alarm_control_panel", "water_heater", "fan", "vacuum", "valve",
]);

const nameOf = (s: EntityState) => (typeof s.attributes.friendly_name === "string" && s.attributes.friendly_name) || s.entity_id;
const minutesSince = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / 60_000;
const domainOf = (id: string) => id.split(".")[0];

function sinceText(iso: string, now: Date): string {
  const m = Math.round(minutesSince(iso, now));
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} jours`;
}

/**
 * What the plain-code stage flags in a reading of the house. `seenAvailable`
 * carries, from one reading to the next, the entities seen working: only
 * those count as "gone unavailable" (a device that never worked is not news).
 */
export function findIssues(states: EntityState[], now: Date, seenAvailable: Set<string>): WatchFinding[] {
  const out: WatchFinding[] = [];
  const persons = states.filter((s) => domainOf(s.entity_id) === "person");
  const everyoneAway = persons.length > 0 && persons.every((p) => p.state !== "home" && p.state !== "unknown" && p.state !== "unavailable");
  const awayLights: string[] = [];

  for (const s of states) {
    const domain = domainOf(s.entity_id);
    const cls = typeof s.attributes.device_class === "string" ? s.attributes.device_class : "";
    const name = nameOf(s);

    if (s.state === "unavailable") {
      if (WATCHED_DOMAINS.has(domain) && seenAvailable.has(s.entity_id) && minutesSince(s.last_changed, now) >= UNAVAILABLE_MINUTES) {
        out.push({ key: `unavailable:${s.entity_id}`, level: "info", text: `${name} (${s.entity_id}) ne répond plus depuis ${sinceText(s.last_changed, now)}.` });
      }
      continue;
    }
    if (s.state !== "unknown") seenAvailable.add(s.entity_id);

    if (domain === "binary_sensor" && s.state === "on") {
      if (SAFETY_CLASSES.has(cls)) {
        out.push({ key: `alarm:${s.entity_id}`, level: "urgent", text: `${name} (${cls}) est en alerte depuis ${sinceText(s.last_changed, now)}.` });
      } else if (OPENING_CLASSES.has(cls) && minutesSince(s.last_changed, now) >= OPEN_MINUTES) {
        out.push({ key: `open:${s.entity_id}`, level: "warn", text: `${name} est ouverte depuis ${sinceText(s.last_changed, now)}.` });
      } else if (cls === "battery") {
        out.push({ key: `battery:${s.entity_id}`, level: "info", text: `${name} signale une batterie faible.` });
      }
    } else if (domain === "alarm_control_panel" && s.state === "triggered") {
      out.push({ key: `alarm:${s.entity_id}`, level: "urgent", text: `L'alarme ${name} est déclenchée.` });
    } else if (domain === "lock" && s.state === "jammed") {
      out.push({ key: `lock:${s.entity_id}`, level: "warn", text: `La serrure ${name} est bloquée.` });
    } else if (domain === "cover" && cls === "garage" && s.state === "open" && minutesSince(s.last_changed, now) >= OPEN_MINUTES) {
      out.push({ key: `open:${s.entity_id}`, level: "warn", text: `${name} est ouverte depuis ${sinceText(s.last_changed, now)}.` });
    } else if (domain === "sensor") {
      const value = Number(s.state);
      if (!Number.isFinite(value)) continue;
      if (cls === "battery" && s.attributes.unit_of_measurement === "%" && value < BATTERY_LOW) {
        out.push({ key: `battery:${s.entity_id}`, level: "info", text: `Batterie de ${name} à ${value} %.` });
      } else if (cls === "temperature" && s.attributes.unit_of_measurement === "°C" && (value < COLD || value > HOT)) {
        out.push({ key: `temp:${s.entity_id}`, level: "warn", text: `${name} indique ${value} °C.` });
      }
    } else if (domain === "light" && s.state === "on" && everyoneAway && minutesSince(s.last_changed, now) >= AWAY_LIGHTS_MINUTES) {
      awayLights.push(name);
    }
  }
  if (awayLights.length) {
    out.push({
      key: "away-lights",
      level: "warn",
      text: `Personne n'est à la maison et ${awayLights.length} lumière(s) sont allumées : ${awayLights.slice(0, 8).join(", ")}.`,
    });
  }
  return out;
}

/** Automations whose recent runs ended in an error, one flag per automation. */
export function findFailedAutomations(traces: AutomationTrace[], automations: EntityState[], now: Date): WatchFinding[] {
  const byId = new Map<string, string>();
  for (const a of automations) if (typeof a.attributes.id === "string") byId.set(a.attributes.id, nameOf(a));
  const out = new Map<string, WatchFinding>();
  for (const t of traces) {
    const failed = t.script_execution === "error" || Boolean(t.error);
    const start = t.timestamp?.start;
    if (!failed || !start || minutesSince(start, now) > 24 * 60) continue;
    const name = byId.get(t.item_id) ?? t.item_id;
    out.set(t.item_id, {
      key: `automation:${t.item_id}`,
      level: "warn",
      text: `L'automatisation « ${name} » a échoué (${new Date(start).toISOString()})${t.error ? ` : ${String(t.error).slice(0, 200)}` : ""}.`,
    });
  }
  return [...out.values()];
}

/** "22:00-07:00" → whether a local hour:minute falls in it. */
export function inQuietHours(range: string | undefined, h: number, mi: number): boolean {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec((range ?? "").trim());
  if (!m) return false;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  const t = h * 60 + mi;
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

/** The model's verdict: {"notify", "title", "message"} somewhere in its reply. */
export function parseVerdict(raw: string | undefined): { notify: boolean; title: string; message: string } | undefined {
  const match = /\{[\s\S]*\}/.exec(raw ?? "");
  if (!match) return undefined;
  try {
    const v = JSON.parse(match[0]) as Record<string, unknown>;
    if (typeof v.notify !== "boolean") return undefined;
    return {
      notify: v.notify,
      title: typeof v.title === "string" ? v.title.slice(0, 60) : "",
      message: typeof v.message === "string" ? v.message : "",
    };
  } catch {
    return undefined;
  }
}

export interface HouseWatchOptions {
  /** off: nothing; on: the entities Igor may see; all: the whole house. */
  mode: "off" | "on" | "all";
  quietHours?: string;
  maxPerDay: number;
  /** HH:MM of the daily "anything useful to say?" check; undefined = never. */
  livelyTime?: string;
  intervalMinutes: number;
}

export interface HouseWatchDeps {
  readStates: (all: boolean) => Promise<EntityState[]>;
  readTraces?: () => Promise<AutomationTrace[]>;
  /** The weather forecast and similar context for the model, as text lines. */
  context?: (states: EntityState[]) => Promise<string[]>;
  judge?: OneShot;
  notify: (title: string, message: string) => Promise<void>;
  conversations?: IConversationStore;
  userId: string;
  timeZone: () => Promise<string>;
  language: () => Promise<string>;
  storePath?: string;
}

interface WatchMemo {
  notified: Record<string, { at: string; level: WatchLevel }>;
  day?: string;
  sentToday: number;
  livelyDay?: string;
  seenAvailable: string[];
}

const JUDGE_SYSTEM = (lang: string) =>
  "You are Igor, the assistant of a home, watching it for its household. Automatic checks flagged the items below. " +
  "Decide whether to send the household a phone notification now. Notify what deserves their attention; stay quiet about " +
  "what is plainly normal (an outdoor sensor that is cold in winter, a fridge sensor that is cold, an opening that is " +
  "obviously meant to be open). Safety alarms (water leak, smoke, gas, CO, heat, a triggered alarm) are always notified. " +
  "Reply with JSON only: {\"notify\": true or false, \"title\": \"…\", \"message\": \"…\"}. The title: under 40 characters, " +
  "one emoji first. The message: under 300 characters, concrete (what, where, since when), with a useful suggestion when " +
  `there is one, no Markdown. Write in the language whose code is "${lang}".`;

const LIVELY_SYSTEM = (lang: string) =>
  "You are Igor, the assistant of a home. Here is the state of the house and the weather. Is there ONE genuinely useful, " +
  "timely thing to tell the household now? For example: frost or a storm tonight while a window, the garage or an awning " +
  "is open; heating running with a window open; rain coming while laundry or a window is out; everyone away with things " +
  "left on. If there is nothing of the kind, say nothing: no small talk, no weather report for its own sake. " +
  "Reply with JSON only: {\"notify\": true or false, \"title\": \"…\", \"message\": \"…\"} (title under 40 characters with " +
  `one emoji first, message under 300 characters, no Markdown). Write in the language whose code is "${lang}".`;

export class HouseWatch {
  private memo: WatchMemo = { notified: {}, sentToday: 0, seenAvailable: [] };
  private seen = new Set<string>();
  private timer?: NodeJS.Timeout;
  private busy = false;
  private lastTraceCheck = 0;

  constructor(private deps: HouseWatchDeps, private options: HouseWatchOptions) {
    if (deps.storePath && existsSync(deps.storePath)) {
      try {
        this.memo = { ...this.memo, ...JSON.parse(readFileSync(deps.storePath, "utf8")) };
      } catch (error) {
        console.warn("[watch] could not read its memory:", error instanceof Error ? error.message : error);
      }
    }
    this.seen = new Set(this.memo.seenAvailable ?? []);
  }

  private save(): void {
    if (!this.deps.storePath) return;
    this.memo.seenAvailable = [...this.seen].slice(-5000);
    try {
      writeFileSync(this.deps.storePath, JSON.stringify(this.memo), { mode: 0o600 });
    } catch (error) {
      console.warn("[watch] could not save its memory:", error instanceof Error ? error.message : error);
    }
  }

  start(): void {
    if (this.options.mode === "off") return;
    const every = Math.max(1, this.options.intervalMinutes) * 60_000;
    this.timer = setInterval(() => void this.check(), every);
    this.timer.unref?.();
    // A first look shortly after start, once Home Assistant has settled.
    setTimeout(() => void this.check(), 90_000).unref?.();
    console.log(`[watch] watching ${this.options.mode === "all" ? "the whole house" : "the entities Igor may see"} every ${this.options.intervalMinutes} min`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One round: read, flag, judge, notify. Public for tests. */
  async check(now = new Date()): Promise<void> {
    if (this.busy || this.options.mode === "off") return;
    this.busy = true;
    try {
      const tz = await this.deps.timeZone();
      const local = localParts(now, tz);
      const today = `${local.y}-${local.m}-${local.d}`;
      if (this.memo.day !== today) {
        this.memo.day = today;
        this.memo.sentToday = 0;
      }
      const quiet = inQuietHours(this.options.quietHours, local.h, local.mi);
      const capped = this.memo.sentToday >= this.options.maxPerDay;

      const states = await this.deps.readStates(this.options.mode === "all");
      const findings = findIssues(states, now, this.seen);
      if (this.deps.readTraces && now.getTime() - this.lastTraceCheck >= TRACE_CHECK_MS) {
        this.lastTraceCheck = now.getTime();
        try {
          const automations = states.filter((s) => s.entity_id.startsWith("automation."));
          findings.push(...findFailedAutomations(await this.deps.readTraces(), automations, now));
        } catch (error) {
          console.warn("[watch] automation traces unavailable:", error instanceof Error ? error.message : error);
        }
      }

      // A warning that went away may be told again when it comes back.
      const present = new Set(findings.map((f) => f.key));
      for (const [key, entry] of Object.entries(this.memo.notified)) {
        const expired = now.getTime() - new Date(entry.at).getTime() > COOLDOWN_MS[entry.level];
        if (expired || (!present.has(key) && entry.level !== "info" && !key.startsWith("automation:"))) delete this.memo.notified[key];
      }

      const fresh = findings.filter((f) => !this.memo.notified[f.key]);
      const due = fresh.filter((f) => f.level === "urgent" || (!quiet && !capped));
      if (due.length) await this.report(due, states, now, today);
      else if (this.options.livelyTime && !quiet && !capped && this.memo.livelyDay !== today) {
        const [h, mi] = this.options.livelyTime.split(":").map(Number);
        if (local.h * 60 + local.mi >= h * 60 + mi) {
          this.memo.livelyDay = today;
          await this.lively(states, now);
        }
      }
      this.save();
    } catch (error) {
      console.warn("[watch] check failed:", error instanceof Error ? error.message : error);
    } finally {
      this.busy = false;
    }
  }

  private async contextLines(states: EntityState[], now: Date): Promise<string> {
    const tz = await this.deps.timeZone();
    const lines = [`Now: ${now.toLocaleString("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`];
    try {
      lines.push(...((await this.deps.context?.(states)) ?? []));
    } catch {
      // Context is a help to the judgement, never a requirement.
    }
    return lines.join("\n").slice(0, 4000);
  }

  private async report(due: WatchFinding[], states: EntityState[], now: Date, today: string): Promise<void> {
    const urgent = due.some((f) => f.level === "urgent");
    const flagged = due.map((f) => `- [${f.level}] ${f.text}`).join("\n");
    let verdict: { notify: boolean; title: string; message: string } | undefined;
    if (this.deps.judge) {
      const lang = await this.deps.language();
      const raw = await this.deps.judge(JUDGE_SYSTEM(lang), `Flagged:\n${flagged}\n\nContext:\n${await this.contextLines(states, now)}`, 400);
      verdict = parseVerdict(raw);
    }
    for (const f of due) this.memo.notified[f.key] = { at: now.toISOString(), level: f.level };
    const fallback = { notify: true, title: urgent ? "🚨 Alerte maison" : "🏠 Veille de la maison", message: due.map((f) => f.text).join("\n") };
    if (!verdict) verdict = fallback;
    else if (urgent && !verdict.notify) verdict = fallback;
    if (!verdict.notify || !verdict.message.trim()) {
      // Judged normal (a freezer is cold): not worth asking again before a day.
      for (const f of due) this.memo.notified[f.key] = { at: now.toISOString(), level: "info" };
      console.log(`[watch] judged normal: ${due.map((f) => f.key).join(", ")}`);
      return;
    }
    await this.send(verdict.title || fallback.title, verdict.message, today, urgent);
  }

  private async lively(states: EntityState[], now: Date): Promise<void> {
    if (!this.deps.judge) return;
    const lang = await this.deps.language();
    const verdict = parseVerdict(await this.deps.judge(LIVELY_SYSTEM(lang), await this.contextLines(states, now), 400));
    if (!verdict?.notify || !verdict.message.trim()) {
      console.log("[watch] lively check: nothing worth saying");
      return;
    }
    await this.send(verdict.title || "🏠 Igor", verdict.message, this.memo.day ?? "", false);
  }

  private async send(title: string, message: string, today: string, urgent: boolean): Promise<void> {
    const text = notificationText(message, 600);
    console.log(`[watch] notifying: ${title}`);
    await this.deps.notify(title, text);
    if (!urgent && this.memo.day === today) this.memo.sentToday++;
    const store = this.deps.conversations;
    if (!store) return;
    await store.storeMessage(WATCH_THREAD, this.deps.userId, "assistant", `**${title}**\n\n${text}`);
    if (store.setConversationTitle) {
      const listed = (await store.listConversations(this.deps.userId)).find((c) => c.conversationId === WATCH_THREAD);
      if (listed && listed.title !== WATCH_THREAD_TITLE) await store.setConversationTitle(WATCH_THREAD, this.deps.userId, WATCH_THREAD_TITLE);
    }
  }
}

/** Context lines for the judgement: weather, forecast, who is home, what is open or on. */
export async function houseContext(
  states: EntityState[],
  forecast: (entityId: string) => Promise<unknown>
): Promise<string[]> {
  const lines: string[] = [];
  const weather = states.filter((s) => s.entity_id.startsWith("weather."));
  for (const w of weather.slice(0, 2)) {
    const a = w.attributes;
    lines.push(`Weather ${nameOf(w)}: ${w.state}, ${a.temperature ?? "?"}${a.temperature_unit ?? "°"}, humidity ${a.humidity ?? "?"}%, wind ${a.wind_speed ?? "?"}`);
  }
  if (weather[0]) {
    try {
      const raw = (await forecast(weather[0].entity_id)) as Record<string, { forecast?: Array<Record<string, unknown>> }> | undefined;
      const days = raw?.[weather[0].entity_id]?.forecast?.slice(0, 2) ?? [];
      for (const d of days) {
        lines.push(`Forecast ${String(d.datetime ?? "").slice(0, 10)}: ${d.condition ?? "?"}, ${d.templow ?? "?"} to ${d.temperature ?? "?"}°, precipitation ${d.precipitation ?? 0}`);
      }
    } catch {
      // No forecast service or not allowed: the current weather will do.
    }
  }
  const persons = states.filter((s) => s.entity_id.startsWith("person."));
  if (persons.length) lines.push(`People: ${persons.map((p) => `${nameOf(p)} ${p.state}`).join(", ")}`);
  const open = states.filter(
    (s) =>
      (s.entity_id.startsWith("binary_sensor.") && OPENING_CLASSES.has(String(s.attributes.device_class)) && s.state === "on") ||
      (s.entity_id.startsWith("cover.") && s.state === "open")
  );
  if (open.length) lines.push(`Open: ${open.slice(0, 12).map(nameOf).join(", ")}`);
  const lights = states.filter((s) => s.entity_id.startsWith("light.") && s.state === "on");
  if (lights.length) lines.push(`Lights on: ${lights.slice(0, 10).map(nameOf).join(", ")}${lights.length > 10 ? ` (+${lights.length - 10})` : ""}`);
  for (const c of states.filter((s) => s.entity_id.startsWith("climate.")).slice(0, 6)) {
    const a = c.attributes;
    lines.push(`Climate ${nameOf(c)}: ${c.state}, ${a.current_temperature ?? "?"}° → ${a.temperature ?? "?"}°, ${a.hvac_action ?? ""}`);
  }
  const outdoor = states.filter(
    (s) => s.entity_id.startsWith("sensor.") && s.attributes.device_class === "temperature" && /ext|out|dehors|jardin|garden/i.test(`${s.entity_id} ${nameOf(s)}`)
  );
  for (const o of outdoor.slice(0, 3)) lines.push(`Outdoor ${nameOf(o)}: ${o.state} °C`);
  return lines;
}
