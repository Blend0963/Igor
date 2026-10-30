import { describe, it, expect } from "vitest";
import { buildLocalDataset, readableSample, toJsonl, type HouseInventory } from "./local-dataset.js";
import { LOCAL_REMINDER } from "../llm/local-protocol.js";

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

const options = { rules: "RÈGLES.", seed: 7, size: 1500 };

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

  it("ends every answer with one line for the voice, never a reply", () => {
    const lines = ["-", ">dire", ">rep", ">web", ">libre", ">demande"];
    for (const e of all) expect(lines, e.kind).toContain((e.messages.at(-1) as Msg).content);
    const line = (kind: string) => new Set(all.filter((e) => e.kind === kind).map((e) => (e.messages.at(-1) as Msg).content));
    expect(line("not_home")).toEqual(new Set([">libre"]));
    expect(line("web")).toEqual(new Set([">web"]));
    expect(line("state")).toEqual(new Set([">rep"]));
    expect(line("reminder")).toEqual(new Set([">dire"]));
    expect(line("absent")).toEqual(new Set([">rep"]));
    expect(line("on_off")).toEqual(new Set(["-", ">dire"]));
    // An order with a confirmation asked for is announced.
    for (const e of all.filter((e) => e.kind === "on_off" && (e.messages.at(-1) as Msg).content === ">dire")) {
      expect((e.messages.at(-2) as Msg).content).toMatch(/confirm|dis-moi|préviens-moi/i);
    }
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

describe("groups", () => {
  const house: HouseInventory = {
    devices: [
      { id: "light.salon", name: "Lumières salon", area: "Salon", members: ["light.a", "light.b"] },
      { id: "light.a", name: "Ampoule gauche", area: "Salon" },
      { id: "light.b", name: "Ampoule droite", area: "Salon" },
      { id: "light.cuisine", name: "Plafonnier cuisine", area: "Cuisine" },
    ],
    scripts: [],
  };
  const { train } = buildLocalDataset(house, { ...options, size: 600 });
  const calls = (kind: string) =>
    train.filter((e) => e.kind === kind).map((e) => ({ words: (e.messages.at(-2) as Msg).content!, args: JSON.parse((e.messages.at(-1) as Msg).tool_calls![0].function.arguments) }));

  it("gives the room's words to the group, and keeps the members' own names", () => {
    const onOff = calls("on_off");
    const salon = onOff.filter((c) => /du salon/i.test(c.words));
    expect(salon.length).toBeGreaterThan(0);
    for (const c of salon) expect(c.args.entity_id).toBe("light.salon");
    expect(onOff.some((c) => c.args.entity_id === "light.a" && /ampoule gauche/i.test(c.words))).toBe(true);
    for (const c of calls("area_lights").filter((c) => /salon/i.test(c.words))) expect(c.args.entity_id).toBe("light.salon");
  });
});

describe("technical entities", () => {
  const house: HouseInventory = {
    devices: [
      { id: "switch.prise_salon", name: "Prise salon", area: "Salon" },
      { id: "switch.prise_salon_voyant", name: "Voyant prise salon", area: "Salon", technical: true },
      { id: "sensor.telecommande_batterie", name: "Batterie télécommande", area: "Salon", deviceClass: "battery", unit: "%", technical: true },
      { id: "sensor.processor_use", name: "Charge processeur", unit: "%", technical: true },
    ],
    scripts: [],
  };
  const { train } = buildLocalDataset(house, { ...options, size: 600 });
  const last = (e: { messages: unknown[] }) => e.messages.at(-1) as Msg;

  it("reads them when asked, and switches them only by their full name", () => {
    const reads = train.filter((e) => e.kind === "technical");
    expect(reads.length).toBeGreaterThan(5);
    expect(reads.some((e) => /batterie de la télécommande|batterie à la télécommande/i.test((e.messages.at(-2) as Msg).content!))).toBe(true);
    for (const e of train) {
      for (const c of last(e).tool_calls ?? []) {
        if (c.function.name === "call_service" && c.function.arguments.includes("voyant")) {
          expect(e.kind).toBe("technical_order");
          expect((e.messages.at(-2) as Msg).content).toMatch(/voyant prise salon/i);
        }
        if (c.function.name === "call_service") expect(c.function.arguments).not.toMatch(/batterie|processor/);
      }
    }
    expect(train.some((e) => e.kind === "technical_order")).toBe(true);
  });

  it("leaves the room's words to the real device", () => {
    const salon = train.filter((e) => e.kind === "on_off" && /la prise du salon/i.test((e.messages.at(-2) as Msg).content!));
    expect(salon.length).toBeGreaterThan(0);
    for (const e of salon) expect(last(e).tool_calls![0].function.arguments).toContain('"switch.prise_salon"');
  });

  it("looks up a reading it was not trained on, and leaves the answer to the online model", () => {
    const found = train.filter((e) => e.kind === "search_found");
    expect(found.length).toBeGreaterThan(0);
    for (const e of found) {
      expect(e.messages.at(-3)).toMatchObject({ role: "assistant" });
      expect(e.messages.at(-2)).toMatchObject({ role: "tool" });
      expect(last(e).content).toBe(">rep");
    }
  });
});

describe("real requests and usage", () => {
  const house: HouseInventory = {
    devices: [
      { id: "light.salon", name: "Lumière salon", area: "Salon", usage: 400 },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `light.l${i}`, name: `Lampe ${i}`, area: `Pièce ${i}` })),
    ],
    scripts: [],
  };
  const real = [
    { at: "2026-10-30T10:00:00Z", words: "coupe-moi le salon", history: [], calls: [{ name: "call_service", args: { domain: "light", service: "turn_off", entity_id: "light.salon" }, ok: true }], line: "-", passes: 1 },
    { at: "2026-10-30T10:01:00Z", words: "raté", history: [], calls: [{ name: "call_service", args: { domain: "light", service: "turn_on" }, ok: false }], line: ">echec", passes: 1 },
    { at: "2026-10-30T10:02:00Z", words: "corrigé", history: [], calls: [], line: ">libre", passes: 0, corrected: true },
    { at: "2026-10-30T10:03:00Z", words: "qui a gagné hier", history: [], calls: [], line: ">web", passes: 0 },
  ];
  const { train, test, counts } = buildLocalDataset(house, { ...options, size: 800, real });
  const all = [...train, ...test];

  it("replays the real requests that worked, and only those", () => {
    expect(counts.real).toBe(2);
    const words = all.filter((e) => e.kind === "real").map((e) => (e.messages.at(-2) as Msg).content);
    expect(words).toContain("coupe-moi le salon");
    expect(words).toContain("qui a gagné hier");
    expect(words).not.toContain("raté");
    expect(words).not.toContain("corrigé");
    const salon = all.find((e) => e.kind === "real" && (e.messages.at(-2) as Msg).content === "coupe-moi le salon")!;
    expect((salon.messages.at(-1) as Msg).content).toBe("-");
    expect((salon.messages.at(-1) as Msg).tool_calls![0].function.arguments).toContain("light.salon");
  });

  it("gives the devices used most more examples", () => {
    const onSalon = train.filter((e) => e.kind === "on_off" && (e.messages.at(-1) as Msg).tool_calls![0].function.arguments.includes('"light.salon"')).length;
    const onOthers = train.filter((e) => e.kind === "on_off").length - onSalon;
    // 1 + √400 = 21 against 1 for each of 20 lamps: about half.
    expect(onSalon).toBeGreaterThan(onOthers / 3);
  });

  it("lists the requests to review", async () => {
    const { reviewList } = await import("./local-dataset.js");
    const text = reviewList(real);
    expect(text).toContain("échec");
    expect(text).toContain("corrigée");
    expect(text).not.toContain("coupe-moi");
  });
});

describe("devices one of a kind", () => {
  const { train } = buildLocalDataset({ devices: [
    { id: "vacuum.robot", name: "Dreamebot L10 Prime Dreamebot L10 Prime" },
    { id: "light.salon", name: "Lumière du salon", area: "Salon" },
  ], scripts: [] }, { ...options, size: 400 });
  const words = train.filter((e) => e.kind === "vacuum").map((e) => (e.messages.at(-2) as Msg).content!.toLowerCase());

  it("calls the only vacuum the vacuum, and says a doubled name once", () => {
    expect(words.some((w) => /l'aspirateur|le robot/.test(w))).toBe(true);
    expect(words.some((w) => w.includes("dreamebot l10 prime dreamebot"))).toBe(false);
  });
});

describe("aliases", () => {
  const { train } = buildLocalDataset({ devices: [
    { id: "vacuum.robot", name: "Dreamebot L10 Prime", aliases: ["Ronron"] },
    { id: "light.l1", name: "Lumière salon", area: "Salon", aliases: ["plafonnier"] },
  ], scripts: [] }, { ...options, size: 400 });
  const words = train.map((e) => (e.messages.at(-2) as Msg).content!.toLowerCase());

  it("uses the owner's own words for a device", () => {
    expect(words.some((w) => w.includes("ronron"))).toBe(true);
    expect(words.some((w) => w.includes("le plafonnier"))).toBe(true);
  });
});

describe("the phone, through the owner's scripts", () => {
  const scriptSection = "## Scripts you can run\n- script.appeler. Fields: recipient (required)\n- script.envoyer_sms. Fields: recipient (required); message (required)\n- script.minuteur. Fields: recipient (required)";
  const { train } = buildLocalDataset({ devices: [{ id: "light.salon", name: "Lumière salon", area: "Salon" }], scripts: [] }, { ...options, size: 600, scriptSection });
  const of = (kind: string) => train.filter((e) => e.kind === kind);

  it("finds the contact and hands over, then calls on yes with the confirmed number", () => {
    const calls = of("call");
    expect(calls.some((e) => (e.messages.at(-1) as Msg).content === ">demande" && (e.messages.at(-1) as Msg).tool_calls![0].function.name === "find_contact")).toBe(true);
    const yes = calls.find((e) => (e.messages.at(-1) as Msg).tool_calls?.[0]?.function.name === "call_service")!;
    const asked = (yes.messages.find((m) => m.role === "assistant") as Msg).content!;
    const number = /au ([\d ]+), je l'appelle/.exec(asked)![1].replace(/\s/g, "");
    expect(JSON.parse((yes.messages.at(-1) as Msg).tool_calls![0].function.arguments)).toEqual({ domain: "script", service: "appeler", data: { recipient: number } });
  });

  it("sends the text the voice read back, word for word", () => {
    const sent = of("sms").find((e) => (e.messages.at(-1) as Msg).tool_calls?.[0]?.function.name === "call_service")!;
    const asked = (sent.messages.find((m) => m.role === "assistant") as Msg).content!;
    const text = /« (.*) » \?$/.exec(asked)![1];
    expect(JSON.parse((sent.messages.at(-1) as Msg).tool_calls![0].function.arguments).data.message).toBe(text);
  });

  it("sets a timer in seconds and has it announced", () => {
    const t = of("timer")[0];
    expect((t.messages.at(-1) as Msg).content).toBe(">dire");
    expect(JSON.parse((t.messages.at(-1) as Msg).tool_calls![0].function.arguments).data.recipient).toBeGreaterThan(0);
  });

  it("does none of it in a house without those scripts", () => {
    const plain = buildLocalDataset({ devices: [{ id: "light.salon", name: "Lumière salon", area: "Salon" }], scripts: [] }, { ...options, size: 300 });
    expect(plain.train.some((e) => ["call", "sms", "timer"].includes(e.kind))).toBe(false);
  });
});
