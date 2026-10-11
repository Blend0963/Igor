/**
 * Spell initialisms out as Slovene letter names, on the way to the voice only.
 *
 * The voice runs the letters of a bare initialism together into a non-word: "CO2" comes
 * out as "kod ve", "VOC" as something no Slovene would recognise. Until 2.7.0 the voice
 * prompt asked the model to write the letter names itself ("Pe em dve celi pet" for PM2,5),
 * which fixed the sound and broke the text: Home Assistant shows the same string in the chat
 * log, and nobody who did not hear it spoken can read "Pe em dve celi pet". Spelling is
 * mechanical, so it belongs here, next to the number speller, where the written reply is
 * never touched.
 *
 * What counts as an initialism: a run of two to four capital letters, optionally followed by
 * digits (PM10, CO2, NO2, PM2,5), or a single capital letter that carries digits (O3). Longer
 * runs are read as words by Slovenes as well as by the voice (GLEDOPTO, ZIGBEE) and are left
 * alone, as are a handful of short ones everybody pronounces as a word (LED, OK, LAN).
 */

import { sloveneNumberWords } from "./number-words.js";

const LETTER_NAMES: Record<string, string> = {
  A: "a", B: "be", C: "ce", Č: "če", D: "de", E: "e", F: "ef", G: "ge", H: "ha", I: "i",
  J: "je", K: "ka", L: "el", M: "em", N: "en", O: "o", P: "pe", R: "er", S: "es", Š: "eš",
  T: "te", U: "u", V: "ve", Z: "ze", Ž: "že",
  // Not in the Slovene alphabet, but common in product and unit names.
  Q: "ku", W: "dvojni ve", X: "iks", Y: "ipsilon",
};

/**
 * Short all-caps tokens that are spoken as words, not letter by letter: common words, and
 * the smart-home brands most likely to appear in a device name in capitals. Anything heard
 * spelled out oddly in a real home belongs here; a device name is data, not an initialism.
 */
const SPOKEN_AS_WORDS = new Set([
  "OK", "LED", "LAN", "WLAN", "WIFI", "NAS", "RAM", "HEPA", "IKEA", "HUE",
  "TUYA", "SONY", "NOUS", "TAPO", "RING", "NEST", "ECHO", "BOSE", "ASUS", "ROKU", "XBOX",
  "WIZ", "YALE", "NUKI", "TADO", "EVE", "LIDL",
]);

function letterNames(letters: string): string {
  return letters.split("").map((ch) => LETTER_NAMES[ch] ?? ch.toLowerCase()).join(" ");
}

/**
 * Digits glued to an initialism. A whole number is spelled out (PM10 is "pe em deset", and
 * here 1 and 2 are safe: nothing is being counted). A decimal keeps its digits, written with
 * the Slovene comma, because the voice reads "2,5" correctly as it is.
 */
function attachedDigits(digits: string): string {
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(digits);
  if (!m) return digits;
  const [, whole, fraction] = m;
  if (fraction !== undefined) return `${whole},${fraction}`;
  return sloveneNumberWords(Number(whole)) ?? whole;
}

/**
 * Replace bare initialisms with their letter names. Slovene only: the letter names are
 * Slovene, and in other languages the voice is not known to need this.
 */
export function spellInitialismsForSpeech(text: string, language?: string): string {
  if (!language || language.toLowerCase().split(/[-_]/)[0] !== "sl") return text;

  return text.replace(
    // Not inside a longer word (no letter or digit on either side). Two to four capitals,
    // or one capital that is immediately followed by digits. Digits may carry one decimal.
    /(?<![\p{L}\p{N}])(?:([A-ZČŠŽ]{2,4})|([A-ZČŠŽ])(?=\d))(\d+(?:[.,]\d+)?)?(?![\p{L}\p{N}])/gu,
    (match: string, run: string | undefined, single: string | undefined, digits: string | undefined) => {
      const letters = run ?? single ?? "";
      if (SPOKEN_AS_WORDS.has(letters)) return match;
      const spoken = letterNames(letters);
      return digits ? `${spoken} ${attachedDigits(digits)}` : spoken;
    }
  );
}
