import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TurnLog } from "./turn-log.js";

const turn = (words: string, ok = true) => ({
  words,
  history: [],
  calls: [{ name: "call_service", args: { domain: "light", service: "turn_on", entity_id: "light.salon,light.cuisine" }, ok }],
  line: "-",
  passes: 1,
});

describe("TurnLog", () => {
  let file: string;
  beforeEach(() => {
    file = path.join(mkdtempSync(path.join(tmpdir(), "turns-")), "local-turns.jsonl");
  });

  it("keeps requests and marks the one a quick correction follows", () => {
    const log = new TurnLog(file);
    const t0 = new Date("2026-10-30T10:00:00Z");
    log.record(turn("allume la lampe"), t0);
    log.record(turn("non, l'autre lampe"), new Date(t0.getTime() + 20_000));
    log.record(turn("annule"), new Date(t0.getTime() + 600_000));
    const read = new TurnLog(file).read();
    expect(read.map((t) => [t.words, Boolean(t.corrected)])).toEqual([
      ["allume la lampe", true],
      ["non, l'autre lampe", false],
      ["annule", false],
    ]);
  });

  it("counts the entities acted on, from requests that worked and stood", () => {
    const log = new TurnLog(file);
    log.record(turn("allume"), new Date("2026-10-30T10:00:00Z"));
    log.record(turn("raté", false), new Date("2026-10-30T11:00:00Z"));
    expect(Object.fromEntries(log.usage())).toEqual({ "light.salon": 1, "light.cuisine": 1 });
  });

  it("keeps only the newest once the file grows", () => {
    const log = new TurnLog(file, 3);
    for (let i = 0; i < 8; i++) log.record(turn(`demande ${i}`), new Date(Date.UTC(2026, 9, 30, 10, i * 5)));
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(log.read().at(-1)!.words).toBe("demande 7");
  });
});
