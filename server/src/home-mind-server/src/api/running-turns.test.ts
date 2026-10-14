import { describe, it, expect } from "vitest";
import { RunningTurns } from "./running-turns.js";
import { cleanTitle } from "../llm/thread-title.js";

describe("RunningTurns", () => {
  it("keeps the reply so far until it is finished", () => {
    const running = new RunningTurns();
    const turn = running.start("u", "mado-thread:a");
    turn.newTurn();
    turn.status("Réflexion…");
    turn.chunk("Je regarde");
    turn.newTurn();
    turn.chunk("Voilà.");
    expect(running.list("u")).toEqual([expect.objectContaining({ conversationId: "mado-thread:a", status: "Réflexion…" })]);
    expect(running.get("u", "mado-thread:a")?.text).toBe("Je regarde\n\nVoilà.");
    expect(running.list("other")).toEqual([]);
    turn.finish();
    expect(running.get("u", "mado-thread:a")).toBeUndefined();
  });

  it("lets a newer request on the same thread own the entry", () => {
    const running = new RunningTurns();
    const first = running.start("u", "t");
    const second = running.start("u", "t");
    first.finish();
    expect(running.get("u", "t")).toBeDefined();
    second.finish();
    expect(running.get("u", "t")).toBeUndefined();
  });
});

describe("cleanTitle", () => {
  it("keeps one clean line", () => {
    expect(cleanTitle('Titre : « Rempotage du ficus ».\nautre')).toBe("Rempotage du ficus");
    expect(cleanTitle("**Consommation électrique**")).toBe("Consommation électrique");
    expect(cleanTitle("<think>hmm</think>\nRéglage du chauffage")).toBe("Réglage du chauffage");
    expect(cleanTitle("   ")).toBeUndefined();
    expect(cleanTitle("x".repeat(80))?.length).toBe(60);
  });
});
