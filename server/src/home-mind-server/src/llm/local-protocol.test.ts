import { describe, it, expect } from "vitest";
import { buildLocalPrompt, LOCAL_PROTOCOL, LOCAL_REMINDER, needsWord, onlineBrief, readLocalTag } from "./local-protocol.js";
import { readZip, writeZip } from "../files/zip.js";

describe("readLocalTag", () => {
  it("reads the line, wherever the model put it", () => {
    expect(readLocalTag("-")).toEqual({ tag: "silence" });
    expect(readLocalTag(">rep")).toEqual({ tag: "rep" });
    expect(readLocalTag("\n> web  résultat PSG\n")).toEqual({ tag: "web", note: "résultat PSG" });
    expect(readLocalTag(">DEMANDE")).toEqual({ tag: "demande" });
  });

  it("ignores anything else", () => {
    expect(readLocalTag("")).toBeUndefined();
    expect(readLocalTag("C'est allumé.")).toBeUndefined();
    expect(readLocalTag(">chante")).toBeUndefined();
  });
});

describe("onlineBrief", () => {
  it("says what was done and read in a few terse lines, then the words", () => {
    const brief = onlineBrief("rep", undefined, [
      { name: "call_service", input: { domain: "light", service: "turn_on", entity_id: "light.salon" }, result: { changed_states: [{ entity_id: "light.salon", state: "on", name: "Lumière salon" }] } },
      { name: "get_state", input: { entity_id: "sensor.tele_bat" }, result: { entity_id: "sensor.tele_bat", state: "64", attributes: { friendly_name: "Batterie télécommande", unit_of_measurement: "%" } } },
    ], "allume le salon et dis-moi la batterie de la télécommande");
    expect(brief).toBe(
      ">rep\n" +
      "fait : light.salon (Lumière salon)=on\n" +
      "lu : sensor.tele_bat (Batterie télécommande)=64 %\n" +
      "dit : « allume le salon et dis-moi la batterie de la télécommande »"
    );
  });

  it("says when a search found nothing, and what failed", () => {
    const brief = onlineBrief("rep", undefined, [
      { name: "search_entities", input: { query: "jacuzzi" }, result: [] },
      { name: "call_service", input: { domain: "cover", service: "open_cover", entity_id: "cover.x" }, result: { error: "not exposed" } },
    ], "allume le jacuzzi");
    expect(brief).toContain("lu : rien pour « jacuzzi »");
    expect(brief).toContain("échec : call_service");
    expect(brief).toContain("not exposed");
  });

  it("needs a word for a failure or a confirmation", () => {
    expect(needsWord([{ name: "call_service", input: {}, result: { error: "x" } }])).toBe("echec");
    expect(needsWord([{ name: "call_service", input: {}, result: { confirmation_required: true } }])).toBe("demande");
    expect(needsWord([{ name: "call_service", input: {}, result: { changed_states: [] } }])).toBeUndefined();
  });
});

describe("buildLocalPrompt", () => {
  it("keeps the standing part short and puts the date, memories and reminder after it", () => {
    const p = buildLocalPrompt({ rules: "MINUTEUR : script.minuteur.", cheatSheet: "## Scripts", facts: ["Il aime le jazz."], withMemory: true, date: "jeudi 29 octobre 2026" });
    expect(p.stable.startsWith(LOCAL_PROTOCOL)).toBe(true);
    expect(p.stable).toContain("RÈGLES DU PROPRIÉTAIRE :\nMINUTEUR");
    expect(p.stable).toContain("## Scripts");
    expect(p.volatile).toBe(`date : jeudi 29 octobre 2026\nmémoire :\n- Il aime le jazz.\n\n${LOCAL_REMINDER}`);
    expect(LOCAL_PROTOCOL.length).toBeLessThan(1600);
  });
});

describe("writeZip deflate", () => {
  it("reads back what it compressed", () => {
    const data = Buffer.from("abc".repeat(5000));
    const zip = writeZip([{ name: "a.txt", data }], { deflate: true });
    expect(zip.length).toBeLessThan(1000);
    expect(readZip(zip)[0].data.equals(data)).toBe(true);
  });
});
