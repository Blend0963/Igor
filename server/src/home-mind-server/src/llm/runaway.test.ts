import { describe, it, expect } from "vitest";
import { SpokenGuard } from "./runaway.js";

function run(chunks: string[]): { said: string; guard: SpokenGuard } {
  const guard = new SpokenGuard();
  let said = "";
  for (const c of chunks) said += guard.push(c);
  said += guard.flush();
  return { said, guard };
}

describe("SpokenGuard", () => {
  it("lets a normal reply through whole, whatever the chunking", () => {
    const text = "Le minuteur de 30 minutes est lancé. Il sonnera à 2 h 56.";
    expect(run([text]).said).toBe(text);
    expect(run(text.split("")).said).toBe(text);
  });

  it("cuts the loop seen on a timer, at its first rule", () => {
    const loop =
      "Le minuteur de 30 minutes est lancé, monsieur. Il sonnera à 2 h 56. Bonne nuit. 🌙 --- *C'est tout. Je m'arrête.* 🌙 " +
      "--- D'accord, je vais être sérieux maintenant. Le minuteur de 30 minutes est lancé, monsieur.";
    const { said, guard } = run(loop.match(/.{1,7}/gs)!);
    expect(said.trimEnd()).toBe("Le minuteur de 30 minutes est lancé, monsieur. Il sonnera à 2 h 56. Bonne nuit.");
    expect(guard.stopped).toBe(true);
    expect(guard.reason).toBe("rule");
  });

  it("cuts a sentence said twice, before any of it is passed on", () => {
    const { said, guard } = run(["Le minuteur est lancé pour trente minutes. ", "Voilà. ", "Le minuteur est lancé pour", " trente minutes. Encore."]);
    expect(said).toBe("Le minuteur est lancé pour trente minutes. Voilà. ");
    expect(guard.reason).toBe("repeat");
  });

  it("keeps short sentences that may honestly come back", () => {
    expect(run(["Oui. C'est allumé. Oui."]).said).toBe("Oui. C'est allumé. Oui.");
  });

  it("drops emojis, which the voice would read by name", () => {
    expect(run(["Bonne nuit 🌙, monsieur ✨."]).said).toBe("Bonne nuit , monsieur .");
  });

  it("cuts repeated sentences in written mode without removing emoji", () => {
    const guard = new SpokenGuard(false);
    let said = "";
    said += guard.push("La lumière est allumée 🌙. ");
    said += guard.push("Voici le détail complet. ");
    said += guard.push("La lumière est allumée 🌙. Encore.");
    said += guard.flush();
    expect(said).toBe("La lumière est allumée 🌙. Voici le détail complet. ");
    expect(guard.reason).toBe("repeat");
  });

  it("preserves Markdown separators in written mode", () => {
    const guard = new SpokenGuard(false);
    const text = "Première partie.\n\n---\n\nDeuxième partie.";
    expect(guard.push(text) + guard.flush()).toBe(text);
    expect(guard.stopped).toBe(false);
  });

  it("does not cut on a decimal point or a time", () => {
    expect(run(["Il fait 21.5 degrés. Il est 2 h 56."]).said).toBe("Il fait 21.5 degrés. Il est 2 h 56.");
  });
});

describe("SpokenGuard, reworded loops", () => {
  it("cuts the same answer said again in other words", () => {
    const guard = new SpokenGuard(true);
    let said = guard.push("Le minuteur de trente minutes est lancé, monsieur. Il sonnera à 2 h 56. ");
    said += guard.push("Le minuteur de trente minutes est bien lancé. Encore une phrase.");
    said += guard.flush();
    expect(said.trim()).toBe("Le minuteur de trente minutes est lancé, monsieur. Il sonnera à 2 h 56.");
    expect(guard.reason).toBe("near_repeat");
  });

  it("cuts an aside about its own answer", () => {
    const guard = new SpokenGuard(true);
    let said = guard.push("Le minuteur est lancé. *Je ne peux pas m'empêcher de rajouter des émojis… je corrige :* ");
    said += guard.push("Le minuteur est lancé.");
    said += guard.flush();
    expect(said.trim()).toBe("Le minuteur est lancé.");
    expect(guard.reason).toBe("aside");
  });

  it("keeps different sentences about similar things", () => {
    const guard = new SpokenGuard(true);
    const text = "La température du salon est de 21 degrés. La température de la chambre est de 20 degrés.";
    expect(guard.push(text) + guard.flush()).toBe(text);
  });

  it("leaves written replies to the exact-repeat rule only", () => {
    const guard = new SpokenGuard(false);
    const text = "Le minuteur de trente minutes est lancé. Le minuteur de trente minutes est bien lancé. *Note.*";
    expect(guard.push(text) + guard.flush()).toBe(text);
  });
});
