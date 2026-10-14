import { describe, it, expect, vi, afterEach } from "vitest";
import { handleHomeTool } from "./home-tools.js";
import { configureVision } from "./vision.js";
import { Scheduler, setScheduler } from "../jobs/scheduler.js";
import type { HomeAssistantClient } from "../ha/client.js";
import type { IChatEngine } from "./interface.js";

afterEach(() => {
  configureVision(undefined);
  setScheduler(undefined);
});

describe("home tools", () => {
  it("describes a camera snapshot and shows it in a thread", async () => {
    const ha = { getCameraSnapshot: vi.fn().mockResolvedValue({ data: Buffer.from([0xff, 0xd8]), mime: "image/jpeg" }) } as unknown as HomeAssistantClient;
    const vision = vi.fn().mockResolvedValue("Un colis devant la porte.");
    configureVision(vision);
    const ctx = { isThread: true, attachments: [] as string[] };
    const out = (await handleHomeTool(ha, "look_at_camera", { entity_id: "camera.entree", question: "un colis ?" }, ctx)) as Record<string, string>;
    expect(out.description).toBe("Un colis devant la porte.");
    expect(vision.mock.calls[0][0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(vision.mock.calls[0][1]).toBe("un colis ?");
    expect(ctx.attachments[0]).toMatch(/^!\[camera\.entree\]\(api\/media\//);
    const voice = (await handleHomeTool(ha, "look_at_camera", { entity_id: "camera.entree" }, {})) as Record<string, string>;
    expect(voice.image).toBeUndefined();
  });

  it("compacts long-term statistics", async () => {
    const ha = {
      getStatistics: vi.fn().mockResolvedValue({
        "sensor.energy": [{ start: Date.UTC(2026, 9, 1), change: 12.34567, mean: null }, { start: Date.UTC(2026, 9, 2), change: 9.8 }],
      }),
    } as unknown as HomeAssistantClient;
    const out = (await handleHomeTool(ha, "get_statistics", { entity_ids: ["sensor.energy"], start_time: "2026-10-01T00:00:00Z", period: "day", types: ["change"] })) as {
      statistics: Record<string, unknown>;
    };
    expect(out.statistics["sensor.energy"]).toEqual([
      { start: "2026-10-01T00:00:00.000Z", change: 12.346 },
      { start: "2026-10-02T00:00:00.000Z", change: 9.8 },
    ]);
    expect(vi.mocked(ha.getStatistics).mock.calls[0]).toEqual([["sensor.energy"], "2026-10-01T00:00:00Z", undefined, "day", ["change"]]);
  });

  it("schedules, lists and cancels for the real user", async () => {
    const scheduler = new Scheduler({ llm: {} as IChatEngine, notify: vi.fn(), timeZone: async () => "Europe/Paris" });
    setScheduler(scheduler);
    const ha = {} as HomeAssistantClient;
    const made = (await handleHomeTool(ha, "schedule_task", { kind: "reminder", text: "poubelles", repeat: "weekly", days: ["tue"], time: "19:00" }, { ownerId: "u" })) as { id: string; schedule: string };
    expect(made.schedule).toBe("chaque mardi à 19:00");
    expect(await handleHomeTool(ha, "list_scheduled_tasks", {}, { ownerId: "u" })).toHaveLength(1);
    expect(await handleHomeTool(ha, "cancel_scheduled_task", { id: made.id }, { ownerId: "other" })).toHaveProperty("error");
    expect(await handleHomeTool(ha, "cancel_scheduled_task", { id: made.id }, { ownerId: "u" })).toEqual({ success: true });
  });
});
