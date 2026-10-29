import { describe, expect, it } from "vitest";
import { canonicalService } from "./service-aliases.js";

describe("canonicalService", () => {
  it("maps the names models get wrong to Home Assistant's", () => {
    expect(canonicalService("cover", "open")).toBe("open_cover");
    expect(canonicalService("cover", "set_position")).toBe("set_cover_position");
    expect(canonicalService("cover", "turn_off")).toBe("close_cover");
    expect(canonicalService("cover", "turn_on")).toBe("open_cover");
    expect(canonicalService("media_player", "play")).toBe("media_play");
  });

  it("leaves real services and other domains alone", () => {
    expect(canonicalService("lock", "open")).toBe("open");
    expect(canonicalService("cover", "open_cover")).toBe("open_cover");
    expect(canonicalService("script", "minuteur")).toBe("minuteur");
    expect(canonicalService(undefined, "open")).toBe("open");
  });
});
