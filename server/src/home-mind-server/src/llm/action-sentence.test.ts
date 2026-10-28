import { describe, expect, it } from "vitest";
import { actionSentence } from "./action-sentence.js";

const changed = (...states: object[]) => ({ changed_states: states });

describe("actionSentence", () => {
  it("says what Home Assistant changed, agreeing in gender and number", () => {
    expect(actionSentence([{ name: "call_service", input: { domain: "light", service: "turn_on", entity_id: "light.salon" },
      result: changed({ entity_id: "light.salon", state: "on", name: "Lumière salon" }) }])).toBe("Lumière salon allumée.");
    expect(actionSentence([{ name: "call_service", input: { domain: "cover", service: "close_cover", entity_id: "cover.volets_salon" },
      result: changed({ entity_id: "cover.volets_salon", state: "closed", attributes: { friendly_name: "Volets salon" } }) }])).toBe("Volets salon fermés.");
    expect(actionSentence([{ name: "call_service", input: { domain: "light", service: "turn_off", entity_id: "light.plafonnier" },
      result: changed({ entity_id: "light.plafonnier", state: "off", name: "Plafonnier cuisine" }) }])).toBe("Plafonnier cuisine éteint.");
  });

  it("joins several devices and a reminder", () => {
    expect(actionSentence([
      { name: "call_service", input: { domain: "light", service: "turn_off", entity_id: ["light.a", "light.b"] },
        result: changed({ entity_id: "light.a", state: "off", name: "Lampe canapé" }, { entity_id: "light.b", state: "off", name: "Salon" }) },
      { name: "schedule_task", input: { kind: "reminder", text: "poubelles" }, result: { success: true, kind: "reminder", when: "mercredi 29 octobre à 19:00" } },
    ])).toBe("Lampe canapé éteinte, Salon éteint et rappel programmé pour mercredi 29 octobre à 19:00.");
  });

  it("gives the thermostat's new set point", () => {
    expect(actionSentence([{ name: "call_service", input: { domain: "climate", service: "set_temperature", entity_id: "climate.chambre", data: { temperature: 19.5 } },
      result: changed({ entity_id: "climate.chambre", state: "heat", name: "Chauffage chambre", attributes: { temperature: 19.5 } }) }])).toBe("Chauffage chambre réglé sur 19,5 degrés.");
  });

  it("leaves the wording to the model when the outcome is not fully known", () => {
    // A script may return something to read.
    expect(actionSentence([{ name: "call_service", input: { domain: "script", service: "minuteur", data: { recipient: 600 } }, result: { changed_states: [] } }])).toBeUndefined();
    // The aimed device did not report its new state.
    expect(actionSentence([{ name: "call_service", input: { domain: "light", service: "turn_on", entity_id: "light.salon" }, result: changed() }])).toBeUndefined();
    // A preview to confirm, an error, another tool.
    expect(actionSentence([{ name: "call_service", input: { domain: "lock", service: "unlock", entity_id: "lock.porte" }, result: { confirmation_required: true } }])).toBeUndefined();
    expect(actionSentence([{ name: "get_state", input: { entity_id: "sensor.t" }, result: { state: "20" } }])).toBeUndefined();
    expect(actionSentence([])).toBeUndefined();
  });
});
