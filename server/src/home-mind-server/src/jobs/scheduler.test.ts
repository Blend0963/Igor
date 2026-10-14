import { describe, it, expect, vi } from "vitest";
import { Scheduler, nextRun, parseWhen, parseDays, notificationText, zonedTime, TASKS_THREAD } from "./scheduler.js";
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
    expect(notify).toHaveBeenCalledWith("MaDo", "Il fait beau.");
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
