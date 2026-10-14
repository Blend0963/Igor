import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MediaStore, mediaTypeOf } from "./media-store.js";

describe("MediaStore", () => {
  it("stores on disk and reads back by id", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "media-"));
    try {
      const store = new MediaStore(dir);
      const id = store.save(Buffer.from("png"), "image/png")!;
      expect(store.get(id)).toMatchObject({ mime: "image/png", inline: true });
      expect(new MediaStore(dir).get(id)?.data.toString()).toBe("png");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never resolves anything but a uuid", () => {
    const store = new MediaStore();
    expect(store.get("../conversations.db")).toBeUndefined();
    expect(store.get("")).toBeUndefined();
  });

  it("does not serve unknown or scriptable types inline", () => {
    const store = new MediaStore();
    const svg = store.save(Buffer.from("<svg/>"), "image/svg+xml", "x.svg")!;
    expect(store.get(svg)).toMatchObject({ mime: "application/octet-stream", inline: false });
    const csv = store.save(Buffer.from("a,b"), "application/octet-stream", "data.csv")!;
    expect(store.get(csv)).toMatchObject({ mime: "text/csv", inline: false });
  });

  it("refuses empty files", () => {
    expect(new MediaStore().save(Buffer.alloc(0), "image/png")).toBeUndefined();
  });

  it("guesses types from names", () => {
    expect(mediaTypeOf(undefined, "a.JPEG")).toBe("image/jpeg");
    expect(mediaTypeOf("image/png; charset=binary")).toBe("image/png");
  });
});
