import { describe, expect, it } from "vitest";
import { spokenSentenceCap } from "./lean.js";

describe("spokenSentenceCap", () => {
  it("keeps spoken replies short unless detail or an SMS is asked for", () => {
    expect(spokenSentenceCap("Est-ce que c'est mauvais pour la poêle ?")).toBe(3);
    for (const m of ["Détaille-moi ça", "Explique-moi en détail", "Donne-moi les étapes", "Envoie un SMS à Jean", "Relis le message"]) {
      expect(spokenSentenceCap(m)).toBeUndefined();
    }
  });
});
