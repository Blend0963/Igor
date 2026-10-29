import { describe, it, expect } from "vitest";
import { buildLocalDataset, readableSample, toJsonl, type HouseInventory } from "./local-dataset.js";
import { localPersona, LOCAL_REMINDER } from "../llm/local-llm.js";

/** A made-up house. */
export const SAMPLE_HOUSE: HouseInventory = {
  devices: [
    { id: "light.salon", name: "Lumière salon", area: "Salon", light: { brightness: true, white: "color_temp", color: true } },
    { id: "light.cuisine", name: "Plafonnier cuisine", area: "Cuisine", light: { brightness: true, white: "rgbw", color: true } },
    { id: "light.chambre", name: "Lampe chevet", area: "Chambre", light: { brightness: true, white: "none", color: false } },
    { id: "light.bureau", name: "Lampe bureau", area: "Bureau", light: { brightness: false, white: "none", color: false } },
    { id: "switch.sapin", name: "Prise sapin", area: "Salon" },
    { id: "cover.salon", name: "Volet salon", area: "Salon" },
    { id: "cover.chambre", name: "Volet chambre", area: "Chambre" },
    { id: "cover.chambre_2", name: "Volet chambre fenêtre", area: "Chambre" },
    { id: "climate.salon", name: "Thermostat salon", area: "Salon" },
    { id: "media_player.salon", name: "Télé salon", area: "Salon" },
    { id: "scene.tamisee", name: "Tamisée" },
    { id: "lock.entree", name: "Serrure entrée", area: "Entrée" },
    { id: "vacuum.robot", name: "Aspirateur", area: "Salon" },
    { id: "sensor.temp_salon", name: "Température salon", area: "Salon", deviceClass: "temperature", unit: "°C" },
    { id: "sensor.hum_salon", name: "Humidité salon", area: "Salon", deviceClass: "humidity", unit: "%" },
    { id: "sensor.conso", name: "Consommation maison", unit: "kWh" },
    { id: "binary_sensor.porte", name: "Porte d'entrée", area: "Entrée", deviceClass: "door" },
    { id: "person.jean", name: "Jean" },
    { id: "weather.maison", name: "Maison" },
  ],
  scripts: [{ id: "script.arrosage", name: "Arrosage" }],
};

const options = { persona: localPersona("RÈGLES."), language: "fr", seed: 7, size: 1500 };

type Msg = { role: string; content?: string; training?: boolean; tool_calls?: { function: { name: string; arguments: string } }[] };

describe("buildLocalDataset", () => {
  const { train, test, counts } = buildLocalDataset(SAMPLE_HOUSE, options);
  const all = [...train, ...test];

  it("builds the requested number of examples, with a held-out test set", () => {
    expect(all.length).toBe(1500);
    expect(test.length).toBeGreaterThan(100);
    expect(test.length).toBeLessThan(300);
    for (const kind of ["on_off", "cover", "state", "reminder", "not_home", "follow_up", "absent", "memory", "scene", "climate"]) {
      expect(counts[kind], kind).toBeGreaterThan(0);
    }
  });

  it("is the same for the same seed", () => {
    expect(JSON.stringify(buildLocalDataset(SAMPLE_HOUSE, options).train.slice(0, 20))).toBe(JSON.stringify(train.slice(0, 20)));
  });

  it("ends every example with the model's answer, and marks past messages as not trained on", () => {
    for (const e of all) {
      const msgs = e.messages as Msg[];
      expect(msgs[0].role).toBe("system");
      const last = msgs[msgs.length - 1];
      expect(last.role).toBe("assistant");
      const userAt = msgs.map((m) => m.role).lastIndexOf("user");
      expect(msgs[userAt - 1].content).toContain(LOCAL_REMINDER);
      for (const m of msgs.slice(1, userAt)) if (m.role !== "system") expect(m.training).toBe(false);
    }
  });

  it("only calls entities the house has, with valid arguments", () => {
    const ids = new Set(SAMPLE_HOUSE.devices.map((d) => d.id));
    for (const e of all) {
      for (const m of e.messages as Msg[]) {
        for (const c of m.tool_calls ?? []) {
          const args = JSON.parse(c.function.arguments);
          if (c.function.name === "call_service" && args.entity_id) {
            for (const id of String(args.entity_id).split(",")) expect(ids.has(id), id).toBe(true);
          }
          if (c.function.name === "get_state") expect(ids.has(args.entity_id)).toBe(true);
        }
      }
    }
  });

  it("answers '-' to what is not about the home, and never writes a reply", () => {
    const answers = all.map((e) => (e.messages as Msg[]).at(-1)!);
    expect(answers.filter((a) => a.content === "-").length / all.length).toBeGreaterThan(0.15);
    for (const a of answers) expect(a.tool_calls?.length || a.content === "-").toBeTruthy();
  });

  it("knows the house: the right ids for the words", () => {
    const lights = all.filter((e) => e.kind === "white");
    for (const e of lights) {
      const args = JSON.parse((e.messages.at(-1) as Msg).tool_calls![0].function.arguments);
      if (args.entity_id === "light.salon") expect(args.data).toEqual({ color_temp_kelvin: 4000 });
      if (args.entity_id === "light.cuisine") expect(args.data).toEqual({ rgbw_color: [0, 0, 0, 255] });
    }
    expect(lights.some((e) => (e.messages.at(-1) as Msg).tool_calls![0].function.arguments.includes("light.chambre"))).toBe(false);
  });

  it("writes JSONL with the tools and a readable sample", () => {
    const line = JSON.parse(toJsonl(train.slice(0, 1), [{ type: "function", function: { name: "get_state" } }]).trim());
    expect(line.tools[0].function.name).toBe("get_state");
    expect(line.messages.length).toBeGreaterThan(2);
    expect(readableSample(train, 10)).toContain("personne :");
  });
});
