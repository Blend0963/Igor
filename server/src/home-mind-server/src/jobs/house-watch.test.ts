import { describe, it, expect, vi } from "vitest";
import { HouseWatch, findIssues, findFailedAutomations, inQuietHours, parseVerdict, WATCH_THREAD } from "./house-watch.js";
import { InMemoryConversationStore } from "../memory/conversation-memory.js";
import type { EntityState } from "../ha/client.js";

const NOW = new Date("2026-10-14T12:00:00Z"); // 14:00 in Paris
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const st = (entity_id: string, state: string, attributes: Record<string, unknown> = {}, changedMinAgo = 0): EntityState => ({
  entity_id,
  state,
  attributes,
  last_changed: ago(changedMinAgo),
  last_updated: ago(changedMinAgo),
});

describe("findIssues", () => {
  it("flags leaks, long-open windows, low batteries and extreme temperatures", () => {
    const keys = findIssues(
      [
        st("binary_sensor.fuite_cuisine", "on", { device_class: "moisture", friendly_name: "Fuite cuisine" }, 2),
        st("binary_sensor.fenetre_salon", "on", { device_class: "window" }, 45),
        st("binary_sensor.porte_entree", "on", { device_class: "door" }, 5),
        st("sensor.capteur_batterie", "8", { device_class: "battery", unit_of_measurement: "%" }),
        st("sensor.temp_cave", "3.5", { device_class: "temperature", unit_of_measurement: "°C" }),
        st("sensor.temp_salon", "20.5", { device_class: "temperature", unit_of_measurement: "°C" }),
      ],
      NOW,
      new Set()
    ).map((f) => `${f.level}:${f.key}`);
    expect(keys).toEqual([
      "urgent:alarm:binary_sensor.fuite_cuisine",
      "warn:open:binary_sensor.fenetre_salon",
      "info:battery:sensor.capteur_batterie",
      "warn:temp:sensor.temp_cave",
    ]);
  });

  it("counts a device as gone only once it was seen working", () => {
    const seen = new Set<string>();
    expect(findIssues([st("light.cuisine", "unavailable", {}, 120)], NOW, seen)).toEqual([]);
    findIssues([st("light.salon", "on")], NOW, seen);
    const gone = findIssues([st("light.salon", "unavailable", {}, 90)], NOW, seen);
    expect(gone.map((f) => f.key)).toEqual(["unavailable:light.salon"]);
  });

  it("notices lights left on when everyone is out", () => {
    const out = findIssues(
      [st("person.a", "not_home"), st("person.b", "work"), st("light.salon", "on", { friendly_name: "Salon" }, 30)],
      NOW,
      new Set()
    );
    expect(out).toEqual([expect.objectContaining({ key: "away-lights", text: expect.stringContaining("Salon") })]);
    expect(findIssues([st("person.a", "home"), st("light.salon", "on", {}, 30)], NOW, new Set())).toEqual([]);
  });

  it("flags automations whose recent runs failed, by name", () => {
    const out = findFailedAutomations(
      [
        { item_id: "17000", script_execution: "error", error: "Entity not found", timestamp: { start: ago(30) } },
        { item_id: "17000", script_execution: "error", timestamp: { start: ago(60) } },
        { item_id: "17001", script_execution: "finished", timestamp: { start: ago(10) } },
        { item_id: "17002", script_execution: "error", timestamp: { start: ago(3000) } },
      ],
      [st("automation.volets", "on", { id: "17000", friendly_name: "Volets du soir" })],
      NOW
    );
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("Volets du soir");
  });
});

describe("helpers", () => {
  it("knows quiet hours across midnight", () => {
    expect(inQuietHours("22:00-07:00", 23, 30)).toBe(true);
    expect(inQuietHours("22:00-07:00", 6, 59)).toBe(true);
    expect(inQuietHours("22:00-07:00", 7, 0)).toBe(false);
    expect(inQuietHours("13:00-14:00", 13, 30)).toBe(true);
    expect(inQuietHours(undefined, 3, 0)).toBe(false);
  });

  it("reads the model's verdict out of its reply", () => {
    expect(parseVerdict('Voici : {"notify": true, "title": "🪟 Fenêtre", "message": "Ouverte."}')).toEqual({ notify: true, title: "🪟 Fenêtre", message: "Ouverte." });
    expect(parseVerdict("rien")).toBeUndefined();
    expect(parseVerdict('{"notify": "yes"}')).toBeUndefined();
  });
});

describe("HouseWatch", () => {
  const setup = (states: EntityState[], judgeReply?: string, options: Partial<ConstructorParameters<typeof HouseWatch>[1]> = {}) => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const judge = vi.fn().mockResolvedValue(judgeReply);
    const conversations = new InMemoryConversationStore();
    const watch = new HouseWatch(
      {
        readStates: async () => states,
        judge: judgeReply === undefined ? undefined : judge,
        notify,
        conversations,
        userId: "default",
        timeZone: async () => "Europe/Paris",
        language: async () => "fr",
      },
      { mode: "on", quietHours: "22:00-07:00", maxPerDay: 5, intervalMinutes: 5, ...options }
    );
    return { watch, notify, judge, conversations };
  };

  it("asks the model once, notifies, and does not repeat within the cooldown", async () => {
    const { watch, notify, judge, conversations } = setup(
      [st("binary_sensor.fenetre", "on", { device_class: "window", friendly_name: "Fenêtre chambre" }, 40)],
      '{"notify": true, "title": "🪟 Fenêtre ouverte", "message": "La fenêtre de la chambre est ouverte depuis 40 min et le chauffage tourne."}'
    );
    await watch.check(NOW);
    await watch.check(new Date(NOW.getTime() + 5 * 60_000));
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0][1]).toContain("Fenêtre chambre");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("🪟 Fenêtre ouverte", expect.stringContaining("chauffage"));
    const thread = await conversations.getConversationHistory(WATCH_THREAD, 10);
    expect(thread[0].content).toContain("Fenêtre ouverte");
  });

  it("stays quiet when the model judges it normal, and does not ask again soon", async () => {
    const { watch, notify, judge } = setup(
      [st("sensor.congelateur", "-18", { device_class: "temperature", unit_of_measurement: "°C" })],
      '{"notify": false, "title": "", "message": ""}'
    );
    await watch.check(NOW);
    await watch.check(new Date(NOW.getTime() + 7 * 3_600_000));
    expect(notify).not.toHaveBeenCalled();
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("always sends a safety alarm, even at night and even if the model says no", async () => {
    const night = new Date("2026-10-14T01:00:00Z"); // 03:00 in Paris
    const { watch, notify } = setup([st("binary_sensor.fumee", "on", { device_class: "smoke", friendly_name: "Détecteur fumée" })], '{"notify": false}');
    await watch.check(night);
    expect(notify).toHaveBeenCalledWith("🚨 Alerte maison", expect.stringContaining("Détecteur fumée"));
  });

  it("holds back ordinary warnings during quiet hours", async () => {
    const night = new Date("2026-10-14T01:00:00Z");
    const { watch, notify } = setup([st("binary_sensor.fenetre", "on", { device_class: "window" }, 120)]);
    await watch.check(night);
    expect(notify).not.toHaveBeenCalled();
  });

  it("works without a model, with the flagged text", async () => {
    const { watch, notify } = setup([st("lock.porte", "jammed", { friendly_name: "Porte" })]);
    await watch.check(NOW);
    expect(notify).toHaveBeenCalledWith("🏠 Veille de la maison", "La serrure Porte est bloquée.");
  });

  it("speaks once a day after the lively time when the model has something useful", async () => {
    const { watch, notify, judge } = setup([st("weather.maison", "clear-night", { temperature: 1 })], '{"notify": true, "title": "❄️ Gel cette nuit", "message": "Fermez la fenêtre du garage."}', {
      livelyTime: "18:00",
    });
    await watch.check(NOW); // 14:00: too early
    expect(judge).not.toHaveBeenCalled();
    const evening = new Date("2026-10-14T16:30:00Z"); // 18:30
    await watch.check(evening);
    await watch.check(new Date(evening.getTime() + 600_000));
    expect(judge).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("❄️ Gel cette nuit", "Fermez la fenêtre du garage.");
  });

  it("does nothing when off", async () => {
    const { watch, notify } = setup([st("binary_sensor.fumee", "on", { device_class: "smoke" })], undefined, { mode: "off" });
    await watch.check(NOW);
    expect(notify).not.toHaveBeenCalled();
  });
});
