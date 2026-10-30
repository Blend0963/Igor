import { describe, it, expect } from "vitest";
import { parsePhrasebook } from "./phrasebook.js";
import { buildLocalDataset } from "./local-dataset.js";

const book = `# mes phrases
passe l'aspirateur => vacuum.start vacuum.robot
mets la lumière du salon à fond => light.turn_on light.salon {"brightness_pct": 100}
allume le salon et la cuisine => light.turn_on light.salon,light.cuisine
il fait combien dehors => get_state sensor.dehors
ferme tout et dis-moi quand c'est fait => cover.close_cover cover.salon + light.turn_off light.salon >dire
qui a gagné le match => web
raconte-moi une blague => libre
allume le jacuzzi => light.turn_on light.jacuzzi
n'importe quoi
`;

describe("parsePhrasebook", () => {
  const known = new Set(["vacuum.robot", "light.salon", "light.cuisine", "sensor.dehors", "cover.salon"]);
  const { phrases, errors } = parsePhrasebook(book, known);

  it("reads phrases, actions, data and lines", () => {
    expect(phrases).toHaveLength(7);
    expect(phrases[0]).toEqual({ words: "passe l'aspirateur", calls: [{ name: "call_service", args: { domain: "vacuum", service: "start", entity_id: "vacuum.robot" } }], line: "-" });
    expect(phrases[1].calls[0].args.data).toEqual({ brightness_pct: 100 });
    expect(phrases[3]).toMatchObject({ calls: [{ name: "get_state", args: { entity_id: "sensor.dehors" } }], line: ">rep" });
    expect(phrases[4]).toMatchObject({ line: ">dire" });
    expect(phrases[4].calls).toHaveLength(2);
    expect(phrases[5]).toEqual({ words: "qui a gagné le match", calls: [], line: ">web" });
  });

  it("says what it could not read", () => {
    expect(errors).toEqual([
      "ligne 9 : entité inconnue light.jacuzzi",
      "ligne 10 : il manque « => » (n'importe quoi)",
    ]);
  });

  it("puts the phrases in the training set, a sixth held out", () => {
    const { train, test, counts } = buildLocalDataset({ devices: [{ id: "light.salon", name: "Lumière salon", area: "Salon" }], scripts: [] }, { seed: 1, size: 200, phrases });
    expect(counts.phrase).toBe(7);
    const all = [...train, ...test].filter((e) => e.kind === "phrase");
    expect(all.length).toBeGreaterThanOrEqual(7);
    const blague = all.find((e) => /blague/i.test((e.messages.at(-2) as { content: string }).content))!;
    expect((blague.messages.at(-1) as { content: string }).content).toBe(">libre");
  });
});
