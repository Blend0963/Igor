import { describe, it, expect, vi } from "vitest";
import { Scheduler, nextRun, parseWhen, parseDays, notificationText, notificationParts, zonedTime, relativeTime, formatLocal, conditionMet, TASKS_THREAD } from "./scheduler.js";
import { InMemoryConversationStore } from "../memory/conversation-memory.js";
import type { IChatEngine } from "../llm/interface.js";

const TZ = "Europe/Paris";

describe("schedule arithmetic", () => {
  it("reads local times in the house's time zone, summer and winter", () => {
    expect(parseWhen("2026-07-14T19:00", TZ).toISOString()).toBe("2026-07-14T17:00:00.000Z");
    expect(parseWhen("2026-12-24T19:00", TZ).toISOString()).toBe("2026-12-24T18:00:00.000Z");
    expect(parseWhen("2026-12-24T19:00:00Z", TZ).toISOString()).toBe("2026-12-24T19:00:00.000Z");
    expect(zonedTime(2026, 3, 29, 3, 30, TZ).toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("finds the next daily and weekly run", () => {
    const after = new Date("2026-10-14T06:00:00Z"); // Wednesday 08:00 in Paris
    expect(nextRun({ type: "daily", time: "07:30" }, after, TZ)?.toISOString()).toBe("2026-10-15T05:30:00.000Z");
    expect(nextRun({ type: "daily", time: "09:00" }, after, TZ)?.toISOString()).toBe("2026-10-14T07:00:00.000Z");
    expect(nextRun({ type: "weekly", days: [0], time: "18:00" }, after, TZ)?.toISOString()).toBe("2026-10-18T16:00:00.000Z");
    expect(nextRun({ type: "once", at: "2026-10-13T00:00:00Z" }, after, TZ)).toBeUndefined();
  });

  it("reads day names in French and English", () => {
    expect(parseDays(["lundi", "fri", "dim"])).toEqual([0, 1, 5]);
    expect(parseDays("mar, jeudi")).toEqual([2, 4]);
  });

  it("turns an answer into a plain notification", () => {
    expect(notificationText("## Météo\n**Soleil** et ![x](api/media/1) [lien](https://a)\n```chart\n{}\n```")).toBe("Météo\nSoleil et  lien");
  });

  it("splits a long answer into whole notifications instead of cutting it", () => {
    const briefing = Array.from({ length: 18 }, (_, i) => `Information numéro ${i + 1} : la tempête traverse le pays et les départements restent en vigilance orange ce jeudi.`).join(" ");
    const parts = notificationParts(briefing);
    expect(parts.length).toBe(2);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(1500);
    expect(parts.join(" ")).toBe(briefing);
    expect(parts[0]).toMatch(/jeudi\.$/);
    expect(notificationParts("Court.")).toEqual(["Court."]);
  });
});

describe("Scheduler", () => {
  const setup = () => {
    const conversations = new InMemoryConversationStore();
    const notify = vi.fn().mockResolvedValue(undefined);
    const llm = { chat: vi.fn().mockResolvedValue({ response: "Il fait **beau**.", toolsUsed: [], factsLearned: 0 }) } as unknown as IChatEngine;
    const scheduler = new Scheduler({ llm, conversations, notify, timeZone: async () => TZ });
    return { scheduler, notify, llm, conversations };
  };

  it("sends a reminder at its time without calling the model, then forgets it", async () => {
    const { scheduler, notify, llm, conversations } = setup();
    const task = await scheduler.add({ userId: "u", kind: "reminder", text: "Sortir les poubelles", schedule: { type: "once", at: new Date(Date.now() + 60_000).toISOString() } });
    await scheduler.tick(new Date(Date.now() + 120_000));
    expect(notify).toHaveBeenCalledWith("⏰ Rappel", "Sortir les poubelles");
    expect(llm.chat).not.toHaveBeenCalled();
    expect(scheduler.list("u").find((t) => t.id === task.id)).toBeUndefined();
    expect(conversations.listConversations("u")[0]).toMatchObject({ conversationId: TASKS_THREAD, title: "Rappels et tâches" });
  });

  it("runs a task through the model and keeps a repeating one", async () => {
    const { scheduler, notify, llm } = setup();
    await scheduler.add({ userId: "u", kind: "task", text: "bilan énergie", schedule: { type: "daily", time: "18:00" } });
    await scheduler.tick(new Date(Date.now() + 2 * 864e5));
    expect(llm.chat).toHaveBeenCalledWith(expect.objectContaining({ message: "[Tâche programmée] bilan énergie", conversationId: TASKS_THREAD }));
    expect(notify).toHaveBeenCalledWith("Igor", "Il fait beau.");
    expect(scheduler.list("u")).toHaveLength(1);
  });

  it("keeps the briefing out of the model's reach", async () => {
    const { scheduler } = setup();
    await scheduler.configureBriefing({ userId: "u", time: "07:30" });
    expect(scheduler.list("u")[0]).toMatchObject({ id: "morning-briefing", builtin: true });
    expect(scheduler.cancel("u", "morning-briefing")).toBe(false);
    await scheduler.configureBriefing({ userId: "u" });
    expect(scheduler.list("u")).toHaveLength(0);
  });

  it("refuses a past time and an empty text", async () => {
    const { scheduler } = setup();
    await expect(scheduler.add({ userId: "u", kind: "reminder", text: "x", schedule: { type: "once", at: "2020-01-01T00:00:00Z" } })).rejects.toThrow(/past/);
    await expect(scheduler.add({ userId: "u", kind: "reminder", text: " ", schedule: { type: "daily", time: "08:00" } })).rejects.toThrow();
  });
});

describe("relative times (computed by the server, not the model)", () => {
  // Wednesday 14 October 2026, 20:30 in Paris (summer time, UTC+2).
  const now = new Date("2026-10-14T18:30:20Z");

  it("adds minutes and hours as elapsed time", () => {
    expect(relativeTime({ minutes: 5 }, now, TZ).toISOString()).toBe("2026-10-14T18:35:20.000Z");
    expect(relativeTime({ hours: 2 }, now, TZ).toISOString()).toBe("2026-10-14T20:30:20.000Z");
  });

  it("moves the local date for days, at the given time", () => {
    expect(relativeTime({ days: 1, time: "15:00" }, now, TZ).toISOString()).toBe("2026-10-15T13:00:00.000Z");
    // Six days later is still summer time; fourteen days later is past the switch (25 October), UTC+1.
    expect(relativeTime({ days: 6, time: "18:00" }, now, TZ).toISOString()).toBe("2026-10-20T16:00:00.000Z");
    expect(relativeTime({ days: 14, time: "18:00" }, now, TZ).toISOString()).toBe("2026-10-28T17:00:00.000Z");
    expect(relativeTime({ days: 2 }, now, TZ).toISOString()).toBe("2026-10-16T18:30:20.000Z");
  });

  it("reads a time alone as today, or tomorrow once past", () => {
    expect(relativeTime({ time: "21:15" }, now, TZ).toISOString()).toBe("2026-10-14T19:15:00.000Z");
    expect(relativeTime({ time: "15:00" }, now, TZ).toISOString()).toBe("2026-10-15T13:00:00.000Z");
  });

  it("refuses negative and absurd offsets", () => {
    expect(() => relativeTime({ minutes: -5 }, now, TZ)).toThrow();
    expect(() => relativeTime({ days: 400 }, now, TZ)).toThrow();
  });

  it("writes the date back with its weekday", () => {
    expect(formatLocal(new Date("2026-10-20T16:00:00Z"), TZ)).toBe("mardi 20 octobre 2026 à 18:00");
  });
});

describe("notify_when conditions", () => {
  it("compares states and numbers", () => {
    expect(conditionMet("home", "equals", "Home")).toBe(true);
    expect(conditionMet("2.5", "below", "5")).toBe(true);
    expect(conditionMet("12", "below", "5")).toBe(false);
    expect(conditionMet("unavailable", "not_equals", "on")).toBe(false);
    expect(conditionMet("abc", "above", "5")).toBe(false);
  });

  it("fires once the condition has held long enough, then forgets the item", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    let power = "800";
    const scheduler = new Scheduler({
      llm: { chat: vi.fn() } as unknown as IChatEngine,
      notify,
      timeZone: async () => TZ,
      readState: async () => power,
    });
    const until = new Date(Date.now() + 3_600_000).toISOString();
    await scheduler.add({ userId: "u", kind: "reminder", text: "La machine a fini", schedule: { type: "when", entityId: "sensor.lave_linge_power", op: "below", value: "5", forMinutes: 3, until } });
    const t0 = Date.now();
    await scheduler.tick(new Date(t0));
    power = "1.2";
    await scheduler.tick(new Date(t0 + 30_000));
    await scheduler.tick(new Date(t0 + 120_000));
    expect(notify).not.toHaveBeenCalled();
    await scheduler.tick(new Date(t0 + 30_000 + 180_000));
    expect(notify).toHaveBeenCalledWith("⏰ Rappel", "La machine a fini");
    expect(scheduler.list("u")).toHaveLength(0);
  });

  it("drops an item unfired at its deadline", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const scheduler = new Scheduler({ llm: { chat: vi.fn() } as unknown as IChatEngine, notify, timeZone: async () => TZ, readState: async () => "on" });
    await scheduler.add({ userId: "u", kind: "reminder", text: "x", schedule: { type: "when", entityId: "light.a", op: "equals", value: "off", forMinutes: 0, until: new Date(Date.now() + 60_000).toISOString() } });
    await scheduler.tick(new Date(Date.now() + 120_000));
    expect(notify).not.toHaveBeenCalled();
    expect(scheduler.list("u")).toHaveLength(0);
  });

  it("caps notifications the model sends", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const scheduler = new Scheduler({ llm: { chat: vi.fn() } as unknown as IChatEngine, notify, timeZone: async () => TZ });
    for (let i = 0; i < 20; i++) await scheduler.notifyNow("Igor", "m" + i);
    await expect(scheduler.notifyNow("Igor", "trop")).rejects.toThrow(/Too many/);
  });
});
