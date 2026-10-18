import { describe, it, expect } from "vitest";
import { isActionCommand, isSimpleRequest, mayBeOrder, selectThreadReasoning } from "./model-router.js";

describe("isSimpleRequest", () => {
  it.each([
    "Allume la lumière du salon",
    "éteins tout au rez-de-chaussée",
    "Igor, ferme les volets de la chambre",
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

describe("isActionCommand", () => {
  it("knows an order that opens with its verb", () => {
    expect(isActionCommand("éteins toutes les lumières")).toBe(true);
    expect(isActionCommand("Peux-tu allumer le salon ?")).toBe(true);
    expect(isActionCommand("coupe la lumière de la cuisine")).toBe(true);
  });

  it("knows an order whose verb comes later", () => {
    expect(isActionCommand("Non, je te demandais d'éteindre les lumières de la maison.")).toBe(true);
    expect(isActionCommand("les volets du salon, ferme-les")).toBe(true);
    expect(isActionCommand("Il faudrait allumer la terrasse")).toBe(true);
  });

  it("leaves questions, states and requests to build something", () => {
    expect(isActionCommand("La lumière est-elle éteinte ?")).toBe(false);
    expect(isActionCommand("la porte est fermée ?")).toBe(false);
    expect(isActionCommand("Pourquoi la lumière s'est allumée hier ?")).toBe(false);
    expect(isActionCommand("Crée une automatisation qui éteint tout à minuit et allume l'entrée")).toBe(false);
    expect(isActionCommand("")).toBe(false);
  });
});

describe("mayBeOrder", () => {
  it("takes short plain messages, not explanations, builds or long texts", () => {
    expect(mayBeOrder("Plonge la maison dans le noir")).toBe(true);
    expect(mayBeOrder("Pourquoi le salon est allumé ?")).toBe(false);
    expect(mayBeOrder("x".repeat(400))).toBe(false);
  });
});


describe("selectThreadReasoning", () => {
  it("turns reasoning off for greetings and simple home commands", () => {
    expect(selectThreadReasoning("Bonjour", "high")).toBe("none");
    expect(selectThreadReasoning("Allume la lumière du salon", "high")).toBe("none");
    expect(selectThreadReasoning("Quelle est la température dans le salon ?", "high")).toBe("none");
  });

  it("uses low effort for ordinary conversation", () => {
    expect(selectThreadReasoning("Raconte-moi ce que tu peux faire", "high")).toBe("low");
    expect(selectThreadReasoning("Raconte-moi ce que tu peux faire", "medium")).toBe("low");
  });

  it("keeps the configured ceiling for explicitly demanding tasks", () => {
    expect(selectThreadReasoning("Analyse pourquoi la consommation a augmenté", "high")).toBe("high");
    expect(selectThreadReasoning("Analyse ce problème", "high")).toBe("high");
    expect(selectThreadReasoning("Compare les deux options", "medium")).toBe("medium");
  });

  it("respects none and lower configured ceilings", () => {
    expect(selectThreadReasoning("Analyse ce problème en détail", "none")).toBe("none");
    expect(selectThreadReasoning("Discussion ordinaire", "low")).toBe("low");
  });
});
