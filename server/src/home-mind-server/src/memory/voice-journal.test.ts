import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VoiceJournal } from "./voice-journal.js";

const entry = (user: string, words: string) => ({ user, words, answer: "", silent: true, done: ["Salon allumé"], trace: [{ step: "local", detail: "igor-tuned", ms: 600, where: "local" as const }] });

describe("VoiceJournal", () => {
  it("keeps each user's exchanges, newest last, at most the limit", () => {
    const j = new VoiceJournal(path.join(mkdtempSync(path.join(tmpdir(), "journal-")), "j.jsonl"));
    j.record(entry("default", "allume le salon"), new Date("2026-11-01T10:00:00Z"));
    j.record(entry("other", "ferme les volets"));
    j.record(entry("default", "lumière tamisée"), new Date("2026-11-01T10:05:00Z"));
    const read = j.read("default", 10);
    expect(read.map((e) => e.words)).toEqual(["allume le salon", "lumière tamisée"]);
    expect(read[0]).toMatchObject({ at: "2026-11-01T10:00:00.000Z", done: ["Salon allumé"], silent: true });
    expect(j.read("default", 1).map((e) => e.words)).toEqual(["lumière tamisée"]);
    expect(j.read("nobody")).toEqual([]);
  });

  it("keeps only the newest once the file holds twice the maximum", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "journal-")), "j.jsonl");
    const j = new VoiceJournal(file, 3);
    for (let i = 0; i < 7; i++) j.record(entry("default", `phrase ${i}`));
    expect(readFileSync(file, "utf8").split("\n").filter(Boolean).length).toBe(3);
    expect(j.read("default", 10).map((e) => e.words)).toEqual(["phrase 4", "phrase 5", "phrase 6"]);
  });
});
