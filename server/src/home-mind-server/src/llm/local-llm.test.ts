import { describe, expect, it } from "vitest";
import { localBaseUrl } from "./local-llm.js";

describe("localBaseUrl", () => {
  it("ends the address with /v1 whatever form it was given in", () => {
    expect(localBaseUrl("http://192.168.1.20:8180")).toBe("http://192.168.1.20:8180/v1");
    expect(localBaseUrl("http://192.168.1.20:8180/")).toBe("http://192.168.1.20:8180/v1");
    expect(localBaseUrl(" http://192.168.1.20:8180/v1/ ")).toBe("http://192.168.1.20:8180/v1");
  });
});
