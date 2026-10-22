import { describe, expect, it, vi } from "vitest";
import { checkAddressee, needsAddresseeCheck, readAddresseeVerdict } from "./addressee-check.js";

describe("needsAddresseeCheck", () => {
  it("skips sentences that open with the name, or do not name Igor", () => {
    for (const text of ["Igor, allume le salon.", "Hey Igor, quelle heure est-il ?", "Dis Mado, mets de la musique", "Allume le salon.", "Hugo est passé hier."]) {
      expect(needsAddresseeCheck(text)).toBe(false);
    }
  });

  it("checks sentences where the name comes later, misspelled or not", () => {
    for (const text of ["C'est Igor qui a éteint.", "Demande à Igor.", "Éteins le salon, Igor.", "Tu as vu ce que Madeau a fait ?", "avec Ma do c'est pareil"]) {
      expect(needsAddresseeCheck(text)).toBe(true);
    }
  });
});

describe("readAddresseeVerdict", () => {
  it("reads the JSON field or a bare word, and nothing else", () => {
    expect(readAddresseeVerdict('{"pour_igor": false}')).toBe(false);
    expect(readAddresseeVerdict('```json\n{"pour_igor":true}\n```')).toBe(true);
    expect(readAddresseeVerdict("non")).toBe(false);
    expect(readAddresseeVerdict("This message is not addressed to me.")).toBeUndefined();
  });
});

describe("checkAddressee", () => {
  it("counts an unclear reply, an error or a timeout as for Igor", async () => {
    expect((await checkAddressee(async () => ({ text: "hmm" }))).forMe).toBe(true);
    expect((await checkAddressee(async () => { throw new Error("down"); })).forMe).toBe(true);

    vi.useFakeTimers();
    const slow = checkAddressee((signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await slow).forMe).toBe(true);
    vi.useRealTimers();
  });

  it("passes a clear no through", async () => {
    expect((await checkAddressee(async () => ({ text: '{"pour_igor": false}' }))).forMe).toBe(false);
  });
});
