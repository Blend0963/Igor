import { describe, it, expect } from "vitest";
import { isSimpleRequest } from "./model-router.js";

describe("isSimpleRequest", () => {
  it.each([
    "Allume la lumière du salon",
    "éteins tout au rez-de-chaussée",
    "MaDo, ferme les volets de la chambre",
    "peux-tu baisser le chauffage à 19",
    "Quelle est la température dans le salon ?",
    "est-ce que la porte du garage est fermée ?",
    "turn off the kitchen lights",
  ])("routes %s to the fast model", (message) => {
    expect(isSimpleRequest({ message })).toBe(true);
  });

  it.each([
    "Pourquoi la chambre est froide le matin ?",
    "Crée une automatisation qui allume le salon au coucher du soleil",
    "Allume le salon et explique-moi comment marche le thermostat",
    "Montre-moi l'historique de température de la semaine",
    "Compare ma consommation d'hier et d'aujourd'hui",
    "Bonjour, comment vas-tu ?",
    "a".repeat(200),
  ])("keeps %s on the main model", (message) => {
    expect(isSimpleRequest({ message })).toBe(false);
  });

  it("keeps reminders and alerts on the main model, which computes the time and calls the tool", () => {
    expect(isSimpleRequest({ message: "mets-moi un rappel dans 1 minute pour les courses" })).toBe(false);
    expect(isSimpleRequest({ message: "lance un minuteur de 10 minutes" })).toBe(false);
    expect(isSimpleRequest({ message: "préviens-moi quand la machine a fini" })).toBe(false);
  });

  it("never routes a request with an image or a file", () => {
    expect(isSimpleRequest({ message: "allume la lampe", hasImages: true })).toBe(false);
    expect(isSimpleRequest({ message: "allume la lampe", hasDocuments: true })).toBe(false);
  });
});
