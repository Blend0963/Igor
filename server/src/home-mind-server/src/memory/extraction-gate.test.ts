import { describe, it, expect, afterEach } from "vitest";
import { extractionGateEnabled, extractionGateReason } from "./extraction-gate.js";

describe("extractionGateEnabled", () => {
  afterEach(() => {
    delete process.env.EXTRACTION_GATE;
  });

  it("is on when EXTRACTION_GATE is unset", () => {
    delete process.env.EXTRACTION_GATE;
    expect(extractionGateEnabled()).toBe(true);
  });

  it("is on when EXTRACTION_GATE is empty", () => {
    process.env.EXTRACTION_GATE = "";
    expect(extractionGateEnabled()).toBe(true);
  });

  it("is off for off/false/0/no", () => {
    for (const value of ["off", "false", "0", "no", " OFF "]) {
      process.env.EXTRACTION_GATE = value;
      expect(extractionGateEnabled()).toBe(false);
    }
  });
});

describe("extractionGateReason — always extracts (inclusion guarantee)", () => {
  afterEach(() => {
    delete process.env.EXTRACTION_GATE;
  });

  it("extracts explicit remembering requests in English", () => {
    expect(extractionGateReason("remember that I prefer 21 degrees")).toBeNull();
    expect(extractionGateReason("don't forget that my name is Alex")).toBeNull();
    expect(extractionGateReason("save this: the boiler is in the garage")).toBeNull();
  });

  it("extracts explicit remembering requests in French", () => {
    expect(extractionGateReason("Retiens que j'appelle le salon la bibliothèque")).toBeNull();
    expect(extractionGateReason("note que je suis allergique aux arachides")).toBeNull();
    expect(extractionGateReason("n'oublie pas que j'ai rendez-vous chez le dentiste")).toBeNull();
  });

  it("extracts explicit remembering requests in Slovenian", () => {
    expect(extractionGateReason("ne pozabi, da sem alergičen na oreščke")).toBeNull();
    expect(extractionGateReason("zapomni si, da vsak dan vstajam ob šestih")).toBeNull();
    expect(extractionGateReason("moje ime je Tilen")).toBeNull();
  });

  it("extracts first-person preferences even inside a command", () => {
    expect(extractionGateReason("mets le thermostat à 20 comme j'aime le soir")).toBeNull();
    expect(extractionGateReason("set the thermostat to 20 but remember I prefer 19 at night")).toBeNull();
    expect(extractionGateReason("I like the lights dim")).toBeNull();
  });

  it("extracts identity and personal context", () => {
    expect(extractionGateReason("my dog is called Max")).toBeNull();
    expect(extractionGateReason("call me HAL 9000")).toBeNull();
    expect(extractionGateReason("I usually wake up at 7am")).toBeNull();
    expect(extractionGateReason("we usually watch tv at nine")).toBeNull();
    expect(extractionGateReason("I have a cat named Max")).toBeNull();
  });

  it("extracts French self-statements, including with a curly apostrophe", () => {
    expect(extractionGateReason("j’habite à Lyon")).toBeNull(); // U+2019 apostrophe
    expect(extractionGateReason("j'aime le bleu")).toBeNull();
    expect(extractionGateReason("je préfère le salon à 21 degrés")).toBeNull();
    expect(extractionGateReason("j'ai deux filles")).toBeNull();
  });

  it("extracts a question that carries a marker", () => {
    expect(extractionGateReason("est-ce que tu te rappelles que j'adore le bleu ?")).toBeNull();
    expect(extractionGateReason("what's my daughter's name again?")).toBeNull();
  });

  it("extracts an unclassifiable message rather than guessing", () => {
    expect(extractionGateReason("msg")).toBeNull();
    expect(extractionGateReason("on m'a dit que le voisin s'appelle France")).toBeNull();
    expect(extractionGateReason("the thing about me is I never surrender")).toBeNull();
  });
});

describe("extractionGateReason — skips turns that provably teach nothing", () => {
  afterEach(() => {
    delete process.env.EXTRACTION_GATE;
  });

  it("skips pure commands", () => {
    expect(extractionGateReason("éteins la lumière du salon")).not.toBeNull();
    expect(extractionGateReason("turn on the kitchen lights")).not.toBeNull();
    expect(extractionGateReason("prižgi luči v kuhinji")).not.toBeNull();
    expect(extractionGateReason("ugasni luči v spalnici")).not.toBeNull();
    expect(extractionGateReason("lights on")).not.toBeNull();
    expect(extractionGateReason("set the thermostat to 20")).not.toBeNull();
  });

  it("skips polite commands with the politeness stripped first", () => {
    expect(extractionGateReason("peux-tu ouvrir la porte s'il te plaît ?")).not.toBeNull();
    expect(extractionGateReason("could you turn off the living room light")).not.toBeNull();
    expect(extractionGateReason("Naj prižgem luči v kuhinji")).not.toBeNull();
    expect(extractionGateReason("est-ce que tu peux allumer la lumière du salon")).not.toBeNull();
  });

  it("skips pure questions", () => {
    expect(extractionGateReason("quelle est la température ?")).not.toBeNull();
    expect(extractionGateReason("quelle est la température du salon")).not.toBeNull(); // no question mark
    expect(extractionGateReason("what's your name?")).not.toBeNull();
    expect(extractionGateReason("what is the temperature in the bedroom?")).not.toBeNull();
    expect(extractionGateReason("kje je telefon?")).not.toBeNull();
    expect(extractionGateReason("how much solar today?")).not.toBeNull();
  });

  it("skips acknowledgements, thanks and greetings", () => {
    for (const m of [
      "ok", "merci", "yes please", "ne, hvala", "da", "Hello", "bonjour",
      "živjo", "do it", "got it, thanks", "c'est parfait merci", "ok, fais-le",
    ]) {
      expect(extractionGateReason(m)).not.toBeNull();
    }
  });

  it("skips fragments too short to carry a fact", () => {
    expect(extractionGateReason("tv")).not.toBeNull();
    expect(extractionGateReason("20")).not.toBeNull();
    expect(extractionGateReason("")).not.toBeNull();
    expect(extractionGateReason("   ")).not.toBeNull();
  });
});

describe("extractionGateReason — the off switch", () => {
  afterEach(() => {
    delete process.env.EXTRACTION_GATE;
  });

  it("extracts everything when EXTRACTION_GATE is off", () => {
    process.env.EXTRACTION_GATE = "off";
    expect(extractionGateReason("turn on the kitchen lights")).toBeNull();
    expect(extractionGateReason("ok")).toBeNull();
    expect(extractionGateReason("")).toBeNull();
  });
});
