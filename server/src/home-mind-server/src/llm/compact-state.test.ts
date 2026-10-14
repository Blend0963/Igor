import { describe, it, expect } from "vitest";
import type { EntityState } from "../ha/client.js";
import { compactServiceResult, compactState, compactStateList, MAX_LISTED_ENTITIES } from "./compact-state.js";

// A real-world WLED strip: the shape that made search_entities expensive.
const wled: EntityState = {
  entity_id: "light.salon_ruban",
  state: "on",
  attributes: {
    friendly_name: "Ruban salon",
    supported_color_modes: ["rgbw"],
    color_mode: "rgbw",
    brightness: 128,
    rgbw_color: [255, 160, 60, 0],
    rgb_color: [255, 160, 60],
    hs_color: [31.8, 76.5],
    xy_color: [0.55, 0.39],
    effect: "Solid",
    effect_list: Array.from({ length: 180 }, (_, i) => `Effect number ${i}`),
    icon: "mdi:led-strip-variant",
    supported_features: 44,
  },
  last_changed: "2026-10-14T10:00:00+00:00",
  last_updated: "2026-10-14T10:00:00+00:00",
};

describe("compactState", () => {
  it("keeps what the model acts on and drops UI noise", () => {
    const c = compactState(wled) as { name: string; attributes: Record<string, unknown> };
    expect(c).toMatchObject({ entity_id: "light.salon_ruban", state: "on", name: "Ruban salon" });
    expect(c.attributes).toMatchObject({ supported_color_modes: ["rgbw"], brightness: 128, rgbw_color: [255, 160, 60, 0] });
    for (const key of ["icon", "effect_list", "hs_color", "xy_color", "supported_features", "friendly_name"]) {
      expect(c.attributes, key).not.toHaveProperty(key);
    }
  });

  it("is a fraction of the size of the raw state", () => {
    const raw = JSON.stringify(wled, null, 2).length;
    const compact = JSON.stringify(compactState(wled)).length;
    expect(compact).toBeLessThan(raw / 5);
  });

  it("cuts long arrays and strings it keeps, saying how long they were", () => {
    const c = compactState({
      entity_id: "sensor.x",
      state: "1",
      attributes: { readings: Array.from({ length: 50 }, (_, i) => i), note: "x".repeat(1000) },
      last_changed: "",
      last_updated: "",
    }) as { attributes: { readings: unknown[]; note: string } };
    expect(c.attributes.readings).toHaveLength(13);
    expect(c.attributes.readings[12]).toBe("…(50 in total)");
    expect(c.attributes.note.length).toBeLessThan(310);
  });

  it("keeps the timestamps only for a single-entity read", () => {
    expect(compactState(wled)).not.toHaveProperty("last_changed");
    expect(compactState(wled, true)).toHaveProperty("last_changed", "2026-10-14T10:00:00+00:00");
  });
});

describe("compactStateList", () => {
  it("stays a plain array up to the ceiling", () => {
    expect(Array.isArray(compactStateList([wled, wled]))).toBe(true);
  });

  it("past the ceiling, shows the first ones and asks the model to narrow", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ ...wled, entity_id: `light.l${i}` }));
    const r = compactStateList(many) as { total: number; shown: number; entities: unknown[]; note: string };
    expect(r.total).toBe(80);
    expect(r.entities).toHaveLength(MAX_LISTED_ENTITIES);
    expect(r.note).toMatch(/Narrow the query/);
  });
});

describe("compactServiceResult", () => {
  it("compacts changed states and passes a service response through whole", () => {
    const response = { contacts: [{ name: "Christophe Dupont", mobile: "0612345678" }] };
    const r = compactServiceResult({ changed_states: [wled], service_response: response }) as {
      changed_states: unknown[];
      service_response: unknown;
    };
    expect(r.service_response).toBe(response);
    expect(JSON.stringify(r.changed_states)).not.toContain("effect_list");
    expect(compactServiceResult({ success: true })).toEqual({ success: true });
  });
});
