import { describe, it, expect } from "vitest";
import { formatLiveState } from "./live-state.js";
import type { EntityState } from "../ha/client.js";

const st = (entity_id: string, state: string, friendly_name?: string): EntityState => ({
  entity_id,
  state,
  attributes: friendly_name ? { friendly_name } : {},
  last_changed: "",
  last_updated: "",
});

describe("formatLiveState", () => {
  it("lists what is on or open, by name, and says the rest is off", () => {
    const text = formatLiveState([
      st("light.salon", "on", "Salon"),
      st("light.cuisine", "off", "Cuisine"),
      st("cover.volet", "open", "Volet"),
      st("lock.porte", "locked"),
      st("sensor.temp", "21"),
      st("switch.prise", "unavailable"),
    ])!;
    expect(text).toContain("- Salon — light.salon");
    expect(text).toContain("- Volet — cover.volet (open)");
    expect(text).not.toContain("Cuisine");
    expect(text).not.toContain("lock.porte");
    expect(text).not.toContain("sensor.temp");
    expect(text).toContain("Every other light");
    expect(text).toContain("MUST call a tool");
  });

  it("says when nothing is on", () => {
    expect(formatLiveState([st("light.salon", "off")])).toContain("Nothing is on");
  });

  it("is absent when no such device is visible", () => {
    expect(formatLiveState([st("sensor.temp", "21")])).toBeUndefined();
  });

  it("caps a long list", () => {
    const many = Array.from({ length: 5 }, (_, i) => st(`light.l${i}`, "on"));
    const text = formatLiveState(many, 3)!;
    expect(text).toContain("light.l2");
    expect(text).not.toContain("light.l3");
    expect(text).toContain("… and 2 more");
  });
});
