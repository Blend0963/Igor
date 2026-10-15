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

  it("computes 'dans 5 minutes' itself and reads the date back", async () => {
    const scheduler = new Scheduler({ llm: {} as IChatEngine, notify: vi.fn(), timeZone: async () => "Europe/Paris" });
    setScheduler(scheduler);
    const before = Date.now();
    const made = (await handleHomeTool({} as HomeAssistantClient, "schedule_task", { kind: "reminder", text: "linge", in_minutes: 5 }, { ownerId: "u" })) as { when: string };
    const at = new Date(scheduler.list("u")[0].nextRunAt).getTime();
    expect(at - before).toBeGreaterThanOrEqual(5 * 60_000);
    expect(at - before).toBeLessThan(5 * 60_000 + 5_000);
    expect(made.when).toMatch(/^\w+ \d+ \w+ \d{4} à \d{2}:\d{2}$/u);
  });

  it("watches an entity for notify_when, refusing what MaDo may not see", async () => {
    const scheduler = new Scheduler({ llm: {} as IChatEngine, notify: vi.fn(), timeZone: async () => "Europe/Paris", readState: async () => "900" });
    setScheduler(scheduler);
    const ha = { getState: vi.fn().mockResolvedValue({ state: "900" }) } as unknown as HomeAssistantClient;
    const made = (await handleHomeTool(ha, "notify_when", { entity_id: "sensor.lave_linge_power", condition: "below", value: 5, for_minutes: 3, text: "Le linge est prêt" }, { ownerId: "u" })) as { watching: string };
    expect(made.watching).toMatch(/^quand sensor\.lave_linge_power passe sous 5 pendant 3 min/);
    const hidden = { getState: vi.fn().mockRejectedValue(new Error("not exposed")) } as unknown as HomeAssistantClient;
    await expect(handleHomeTool(hidden, "notify_when", { entity_id: "sensor.x", condition: "equals", value: "on", text: "x" }, { ownerId: "u" })).rejects.toThrow();
    expect(scheduler.list("u")).toHaveLength(1);
  });

  it("summarises automation traces, failing ones first", async () => {
    const ha = {
      listAutomations: vi.fn().mockResolvedValue([
        { entity_id: "automation.volets", state: "on", attributes: { id: "1", friendly_name: "Volets" } },
        { entity_id: "automation.lumiere", state: "on", attributes: { id: "2", friendly_name: "Lumière" } },
        { entity_id: "automation.jamais", state: "on", attributes: { id: "3" } },
      ]),
      getAutomationTraces: vi.fn().mockResolvedValue([
        { item_id: "2", script_execution: "finished", timestamp: { start: "2026-10-14T10:00:00Z" } },
        { item_id: "1", script_execution: "error", error: "light.x not found", timestamp: { start: "2026-10-14T09:00:00Z" } },
      ]),
    } as unknown as HomeAssistantClient;
    const out = (await handleHomeTool(ha, "get_automation_traces", {})) as { automations_that_ran: Array<{ name: string; errors: number }>; no_run_since_restart: string[] };
    expect(out.automations_that_ran[0]).toMatchObject({ name: "Volets", errors: 1, last_error: "light.x not found" });
    expect(out.no_run_since_restart).toEqual(["automation.jamais"]);
  });

  it("reads an automation's config by its entity_id", async () => {
    const ha = {
      getStatesForWatch: vi.fn().mockResolvedValue([{ entity_id: "automation.volets", state: "on", attributes: { id: "1" } }]),
      getAutomationConfig: vi.fn().mockResolvedValue({ alias: "Volets", triggers: [] }),
    } as unknown as HomeAssistantClient;
    expect(await handleHomeTool(ha, "get_config_item", { entity_id: "automation.volets" })).toEqual({ entity_id: "automation.volets", config: { alias: "Volets", triggers: [] } });
    expect(await handleHomeTool(ha, "get_config_item", { entity_id: "light.x" })).toHaveProperty("error");
  });
});
