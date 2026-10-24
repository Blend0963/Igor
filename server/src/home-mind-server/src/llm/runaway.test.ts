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

  it("keeps a written phrase said again: table cells, list steps, headings", () => {
    const samples = [
      "Voici le comparatif.\n\n| Modèle | Prix | Avis |\n|---|---|---|\n| A | 10 €. | Bon rapport qualité-prix. |\n| B | 12 €. | Bon rapport qualité-prix. |\n\nEn résumé, prenez A 🌙.",
      "Étapes :\n1. Ouvrez les paramètres.\n2. Cliquez sur Enregistrer.\n3. Ouvrez les paramètres.\n4. Fin.",
      "## Lundi\nAucun rendez-vous prévu.\n\n## Mardi\nAucun rendez-vous prévu.\n\nVoilà pour la semaine.",
      "```js\nlog(\"Valeur lue. \");\nlog(\"Valeur lue. \");\nlog(\"Valeur lue. \");\nlog(\"Valeur lue. \");\n```\nC'est tout.",
    ];
    for (const text of samples) {
      const guard = new SpokenGuard(false);
      const said = text.match(/.{1,7}/gs)!.map((c) => guard.push(c)).join("") + guard.flush();
      expect(said).toBe(text);
      expect(guard.stopped).toBe(false);
    }
  });

  it("shows a written reply as it comes, a table before any sentence end", () => {
    const guard = new SpokenGuard(false);
    const chunks = ["Je vous recommande donc :\n\n| Offre | Prix |\n", "|---|---|\n| Octopus | 0,219 € |"];
    expect(chunks.map((c) => guard.push(c))).toEqual(chunks);
    expect(guard.flush()).toBe("");
  });

  it("cuts a written reply that starts over, three sentences in the same order", () => {
    const guard = new SpokenGuard(false);
    const block = "La lumière est allumée. Le chauffage est à 20 degrés. Les volets sont fermés. ";
    const said = [block, "Voici le détail complet. ", block, block].map((c) => guard.push(c)).join("") + guard.flush();
    expect(said).toBe(`${block}Voici le détail complet. `);
    expect(guard.reason).toBe("loop");
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

  it("leaves near repeats alone in written replies", () => {
    const guard = new SpokenGuard(false);
    const text = "Le minuteur de trente minutes est lancé. Le minuteur de trente minutes est bien lancé. *Note.*";
    expect(guard.push(text) + guard.flush()).toBe(text);
  });
});

describe("SpokenGuard, NOT_FOR_ME", () => {
  it("holds the start back and turns NOT_FOR_ME into silence, however it is chunked", () => {
    for (const chunks of [["NOT_FOR_ME"], ["N", "OT_", "FOR", "_ME"], ["NOT", "_FOR_ME."], ['"NOT_FOR_ME"']]) {
      const guard = new SpokenGuard(true);
      const said = chunks.map((c) => guard.push(c)).join("") + guard.flush();
      expect(said).toBe("");
      expect(guard.silent).toBe(true);
    }
  });

  it("says nothing more once NOT_FOR_ME shows up later in the reply", () => {
    const guard = new SpokenGuard(true);
    const said = ["Cette phrase ne m'est pas adress", "ée. NOT_FOR", "_ME"].map((c) => guard.push(c)).join("") + guard.flush();
    expect(said).toBe("");
    expect(guard.silent).toBe(true);
  });

  it("lets a normal answer through, even one starting with N", () => {
    const guard = new SpokenGuard(true);
    const said = ["N", "on, le salon est éteint."].map((c) => guard.push(c)).join("") + guard.flush();
    expect(said).toBe("Non, le salon est éteint.");
    expect(guard.silent).toBe(false);
  });

  it("is a spoken-only signal: written replies keep the text", () => {
    const guard = new SpokenGuard(false);
    expect(guard.push("NOT_FOR_ME") + guard.flush()).toBe("NOT_FOR_ME");
  });
});

describe("SpokenGuard, a spoken reply going on after a colon", () => {
  it("keeps emphasis right after a colon or a line that ends with one", () => {
    for (const [text, said] of [
      ["Résultat : *Octopus Eco* est le moins cher.", "Résultat : Octopus Eco est le moins cher."],
      ["Trois lampes sont allumées :\n*Salon*, *Cuisine* et *Bureau*.", "Trois lampes sont allumées :\nSalon, Cuisine et Bureau."],
    ]) {
      const guard = new SpokenGuard(true);
      expect(text.match(/.{1,5}/gs)!.map((c) => guard.push(c)).join("") + guard.flush()).toBe(said);
      expect(guard.stopped).toBe(false);
    }
  });

  it("still ends a reply at an aside opening a sentence", () => {
    const guard = new SpokenGuard(true);
    const said = ["Minuteur lancé. ", "*Je corrige :* Minuteur lancé."].map((c) => guard.push(c)).join("") + guard.flush();
    expect(said.trim()).toBe("Minuteur lancé.");
    expect(guard.reason).toBe("aside");
  });
});

describe("SpokenGuard, bold and italics in a spoken reply", () => {
  const run = (chunks: string[]) => {
    const guard = new SpokenGuard(true);
    return { said: chunks.map((c) => guard.push(c)).join("") + guard.flush(), guard };
  };

  it("keeps the whole answer and drops the bold marks (0.11.6 cut it at the first *)", () => {
    const text = "Le numéro de **Jean Martin** est le 06 12 34 56 78. Je ne trouve **pas** d'autre Jean.";
    for (const chunks of [[text], text.match(/.{1,3}/gs)!, text.split("")]) {
      const { said, guard } = run(chunks);
      expect(said).toBe("Le numéro de Jean Martin est le 06 12 34 56 78. Je ne trouve pas d'autre Jean.");
      expect(guard.stopped).toBe(false);
    }
  });

  it("keeps a sentence that starts in bold, and italics inside a sentence", () => {
    const { said } = run(["**Priorité** : faites vérifier le relais. C'est *très* simple."]);
    expect(said).toBe("Priorité : faites vérifier le relais. C'est très simple.");
  });

  it("still ends at an aside that opens a sentence", () => {
    const { said, guard } = run(["Le minuteur est lancé. *Je corrige :* Le minuteur est lancé."]);
    expect(said.trim()).toBe("Le minuteur est lancé.");
    expect(guard.reason).toBe("aside");
  });
});

describe("SpokenGuard, a spoken reply kept short", () => {
  const say = (text: string, max?: number) => {
    const guard = new SpokenGuard(true, false, max);
    return { said: text.match(/.{1,6}/gs)!.map((c) => guard.push(c)).join("") + guard.flush(), guard };
  };

  it("ends after whole sentences, never in the middle of one, and reads no list numbers", () => {
    const reply =
      "Oui, c'est une très mauvaise idée. Voici pourquoi :\n\n1. Choc thermique : le fond peut se déformer. " +
      "2. Altération : l'acier s'affaiblit avec le temps. 3. Sécurité : la vapeur brûle";
    const { said, guard } = say(reply, 3);
    expect(said).toBe(
      "Oui, c'est une très mauvaise idée. Voici pourquoi :\n\nChoc thermique : le fond peut se déformer. Altération : l'acier s'affaiblit avec le temps. "
    );
    expect(guard.reason).toBe("length");
  });

  it("says a short reply whole, and a long one when there is no limit", () => {
    expect(say("Oui. Ça peut la déformer.", 3).said).toBe("Oui. Ça peut la déformer.");
    const long = "Un. Deux. Trois. Quatre. Cinq.";
    expect(say(long).said).toBe(long);
  });
});
