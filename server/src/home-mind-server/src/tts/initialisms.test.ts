import { describe, it, expect } from "vitest";
import { spellInitialismsForSpeech } from "./initialisms.js";

describe("spellInitialismsForSpeech", () => {
  it("spells the case that started this, so the written reply can keep PM2,5", () => {
    // The prompt used to make the model write "Pe em dve celi pet" into the reply itself,
    // which Home Assistant then showed in the chat log. The voice now gets it from here.
    expect(spellInitialismsForSpeech("Delci PM2,5 so 8,5 mikrograma.", "sl")).toBe(
      "Delci pe em 2,5 so 8,5 mikrograma."
    );
    expect(spellInitialismsForSpeech("PM2.5 je visok", "sl")).toBe("pe em 2,5 je visok");
  });

  it("spells letters and attached whole numbers", () => {
    expect(spellInitialismsForSpeech("VOC je 156 enot", "sl")).toBe("ve o ce je 156 enot");
    expect(spellInitialismsForSpeech("CO2 je 780", "sl")).toBe("ce o dva je 780");
    expect(spellInitialismsForSpeech("PM10 in NO2 in O3", "sl")).toBe("pe em deset in en o dva in o tri");
  });

  it("knows the Slovene letter names, including č š ž and the borrowed letters", () => {
    expect(spellInitialismsForSpeech("ČŠŽ", "sl")).toBe("če eš že");
    expect(spellInitialismsForSpeech("UV in RSSI", "sl")).toBe("u ve in er es es i");
    expect(spellInitialismsForSpeech("QWXY", "sl")).toBe("ku dvojni ve iks ipsilon");
  });

  it("leaves words in capitals alone when they are read as words", () => {
    expect(spellInitialismsForSpeech("LED trak je OK", "sl")).toBe("LED trak je OK");
    // Brand names in capitals are device names, spoken as words.
    expect(spellInitialismsForSpeech("TUYA vtičnica in SONY TV", "sl")).toBe("TUYA vtičnica in SONY te ve");
    // Five letters or more is a name the voice reads as a word anyway.
    expect(spellInitialismsForSpeech("GLEDOPTO in ZIGBEE", "sl")).toBe("GLEDOPTO in ZIGBEE");
  });

  it("does not touch capitals inside a word, a single letter, or °C", () => {
    expect(spellInitialismsForSpeech("WiFi in iPhone", "sl")).toBe("WiFi in iPhone");
    expect(spellInitialismsForSpeech("19 °C in C je črka", "sl")).toBe("19 °C in C je črka");
    expect(spellInitialismsForSpeech("Nives", "sl")).toBe("Nives");
  });

  it("does nothing outside Slovene", () => {
    expect(spellInitialismsForSpeech("PM2.5 is high", "en")).toBe("PM2.5 is high");
    expect(spellInitialismsForSpeech("PM2,5 je visok", undefined)).toBe("PM2,5 je visok");
  });

  it("accepts a full locale tag", () => {
    expect(spellInitialismsForSpeech("VOC", "sl-SI")).toBe("ve o ce");
  });
});
