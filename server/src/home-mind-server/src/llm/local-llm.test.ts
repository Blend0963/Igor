import { describe, expect, it } from "vitest";
import { localBaseUrl, shareMemory } from "./local-llm.js";

describe("localBaseUrl", () => {
  it("ends the address with /v1 whatever form it was given in", () => {
    expect(localBaseUrl("http://192.168.1.20:8180")).toBe("http://192.168.1.20:8180/v1");
    expect(localBaseUrl("http://192.168.1.20:8180/")).toBe("http://192.168.1.20:8180/v1");
    expect(localBaseUrl(" http://192.168.1.20:8180/v1/ ")).toBe("http://192.168.1.20:8180/v1");
  });
});

describe("shareMemory", () => {
  const known = ["Le prénom de l'utilisateur est Jean.", "Il préfère 21 degrés dans le salon.", "Sa sœur s'appelle Paule."];

  it("hands over only memories Igor holds, as stored", () => {
    expect(shareMemory(["le prénom de l'utilisateur est jean"], known)).toEqual({ shared: [known[0]] });
    expect(shareMemory(["préfère 21 degrés dans le salon"], known)).toEqual({ shared: [known[1]] });
    expect(shareMemory("Sa sœur s'appelle Paule.", known)).toEqual({ shared: [known[2]] });
  });

  it("drops anything invented, too short or not text", () => {
    expect(shareMemory(["Son code de carte bleue est 1234."], known)).toEqual({ shared: [] });
    expect(shareMemory(["Je"], known)).toEqual({ shared: [] });
    expect(shareMemory([42, null], known)).toEqual({ shared: [] });
    expect(shareMemory(undefined, known)).toEqual({ shared: [] });
  });
});
