import { describe, it, expect } from "vitest";
import { addChips, chipsFromServiceCall, chipsFromTool, MAX_CHIPS, type ActionChip } from "./action-chips.js";

const st = (entity_id: string, state: string, friendly_name?: string) => ({
  entity_id,
  state,
  attributes: friendly_name ? { friendly_name } : {},
  last_changed: "",
  last_updated: "",
});

describe("chipsFromServiceCall", () => {
  it("names what Home Assistant reports as changed, aimed entities first", () => {
    const chips = chipsFromServiceCall(
      { domain: "light", service: "turn_off", entity_id: "light.salon, light.cuisine" },
      [st("light.salon", "off", "Salon"), st("light.cuisine", "off", "Cuisine"), st("sensor.power", "12", "Conso")]
    );
    expect(chips).toEqual([
      { kind: "off", label: "Salon · éteint" },
      { kind: "off", label: "Cuisine · éteint" },
    ]);
  });

  it("reads covers, locks and values", () => {
    expect(chipsFromServiceCall({ domain: "cover", service: "open_cover", entity_id: "cover.v" }, [st("cover.v", "open", "Volet")])).toEqual([{ kind: "on", label: "Volet · ouvert" }]);
    expect(chipsFromServiceCall({ domain: "lock", service: "lock", entity_id: "lock.p" }, [st("lock.p", "locked", "Porte")])).toEqual([{ kind: "off", label: "Porte · verrouillé" }]);
    const temp = { ...st("number.t", "21", "Consigne"), attributes: { friendly_name: "Consigne", unit_of_measurement: "°C" } };
    expect(chipsFromServiceCall({ domain: "number", service: "set_value", entity_id: "number.t" }, [temp])).toEqual([{ kind: "set", label: "Consigne · 21 °C" }]);
  });

  it("shows the call itself when nothing was reported", () => {
    expect(chipsFromServiceCall({ domain: "script", service: "turn_on", entity_id: "script.film" }, [])).toEqual([{ kind: "set", label: "script.film · turn on" }]);
  });

  it("takes the domain's states for an area or 'all' target", () => {
    const chips = chipsFromServiceCall({ domain: "light", service: "turn_off", entity_id: "all" }, [st("light.a", "off", "A"), st("switch.b", "off", "B")]);
    expect(chips).toEqual([{ kind: "off", label: "A · éteint" }]);
  });
});

describe("chipsFromTool", () => {
  it("shows reminders and confirmed automation changes, not previews or errors", () => {
    expect(chipsFromTool("schedule_task", {}, { success: true, kind: "reminder", when: "samedi 18 octobre 2026 à 07:00" })).toEqual([{ kind: "reminder", label: "Rappel · samedi 18 octobre 2026 à 07:00" }]);
    expect(chipsFromTool("create_automation", { alias: "Volets du soir" }, { success: true })).toEqual([{ kind: "automation", label: "Volets du soir · créée" }]);
    expect(chipsFromTool("create_automation", { alias: "x" }, { confirmation_required: true, preview: {} })).toEqual([]);
    expect(chipsFromTool("schedule_task", {}, { error: "no" })).toEqual([]);
    expect(chipsFromTool("get_state", {}, { success: true })).toEqual([]);
  });
});

describe("addChips", () => {
  it("keeps the last state of a device once, and stops at the cap", () => {
    const list: ActionChip[] = [];
    addChips(list, [{ kind: "on", label: "Salon · allumé" }]);
    addChips(list, [{ kind: "off", label: "Salon · éteint" }]);
    expect(list).toEqual([{ kind: "off", label: "Salon · éteint" }]);
    addChips(list, Array.from({ length: 20 }, (_, i) => ({ kind: "off" as const, label: `L${i} · éteint` })));
    expect(list).toHaveLength(MAX_CHIPS);
  });
});
