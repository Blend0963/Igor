import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleToolCall, type ToolContext } from "./tool-handler.js";
import { setConfigDir } from "./home-tools.js";
import { setConfigEdits } from "./tool-policy.js";
import { lineDiff, restoreMasked } from "../ha/config-files.js";
import type { HomeAssistantClient } from "../ha/client.js";

let base: string;
const ORIGINAL = "volets_soir:\n  alias: Volets du soir\n  sequence:\n    - action: cover.close_cover\n      target:\n        entity_id: cover.salon\nalarme:\n  alias: Alarme\n  sequence:\n    - action: alarm_control_panel.alarm_arm_away\n      data:\n        code: 1234\n";

const ctx = (turnId: string): ToolContext => ({ conversationId: "mado-thread:t1", turnId, userId: "u", memory: {} as ToolContext["memory"] });
const haWith = (result: string) =>
  ({
    checkConfig: vi.fn().mockResolvedValue({ result, errors: result === "valid" ? null : "Invalid config for script: bad" }),
    callService: vi.fn().mockResolvedValue([]),
  }) as unknown as HomeAssistantClient & { checkConfig: ReturnType<typeof vi.fn>; callService: ReturnType<typeof vi.fn> };

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), "mado-write-"));
  writeFileSync(path.join(base, "scripts.yaml"), ORIGINAL);
  writeFileSync(path.join(base, "secrets.yaml"), "x: 1\n");
  setConfigDir(base);
  setConfigEdits("yaml");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  setConfigDir("/config");
  setConfigEdits("automations");
});

describe("write_config_file", () => {
  // What the model read: the alarm code masked.
  const asRead = ORIGINAL.replace("code: 1234", "code: «masqué»");
  const edited = asRead.replace("cover.salon", "cover.salon_et_cuisine");

  it("previews without writing, then writes what was shown after the user's yes, restoring masked values", async () => {
    const ha = haWith("valid");
    const preview = (await handleToolCall(ha, "write_config_file", { path: "scripts.yaml", content: edited }, ctx("turn-1"))) as Record<string, string>;
    expect(preview.confirmation_required).toBe(true);
    expect(preview.changes).toContain("-         entity_id: cover.salon");
    expect(preview.changes).toContain("+         entity_id: cover.salon_et_cuisine");
    expect(preview.changes).not.toContain("1234");
    expect(readFileSync(path.join(base, "scripts.yaml"), "utf8")).toBe(ORIGINAL);

    const sameTurn = (await handleToolCall(ha, "write_config_file", { path: "scripts.yaml", confirm: true }, ctx("turn-1"))) as Record<string, string>;
    expect(sameTurn.error).toMatch(/not answered/);

    const done = (await handleToolCall(ha, "write_config_file", { path: "scripts.yaml", confirm: true, backup: false }, ctx("turn-2"))) as Record<string, string>;
    expect(done.success).toBe(true);
    const written = readFileSync(path.join(base, "scripts.yaml"), "utf8");
    expect(written).toContain("cover.salon_et_cuisine");
    expect(written).toContain("code: 1234");
    expect(readdirSync(base).some((f) => f.endsWith(".bak"))).toBe(false);
    expect(ha.callService).toHaveBeenCalledWith("script", "reload");
  });

  it("keeps a backup only when asked", async () => {
    const ha = haWith("valid");
    await handleToolCall(ha, "write_config_file", { path: "scripts.yaml", content: edited }, ctx("a"));
    const done = (await handleToolCall(ha, "write_config_file", { path: "scripts.yaml", confirm: true, backup: true }, ctx("b"))) as Record<string, string>;
    expect(done.backup).toMatch(/^scripts\.yaml\.mado-\d{8}-\d{6}\.bak$/);
    expect(readFileSync(path.join(base, done.backup), "utf8")).toBe(ORIGINAL);
  });

  it("puts the old content back when Home Assistant's check fails", async () => {
    const ha = haWith("invalid");
    await handleToolCall(ha, "write_config_file", { path: "scripts.yaml", content: edited }, ctx("a"));
    const done = (await handleToolCall(ha, "write_config_file", { path: "scripts.yaml", confirm: true }, ctx("b"))) as Record<string, string>;
    expect(done.error).toMatch(/FAILED/);
    expect(done.check_errors).toContain("Invalid config");
    expect(readFileSync(path.join(base, "scripts.yaml"), "utf8")).toBe(ORIGINAL);
  });

  it("removes a new file the check rejected", async () => {
    const ha = haWith("invalid");
    await handleToolCall(ha, "write_config_file", { path: "packages/new.yaml", content: "bad: [" }, ctx("a"));
    await handleToolCall(ha, "write_config_file", { path: "packages/new.yaml", confirm: true }, ctx("b"));
    expect(existsSync(path.join(base, "packages", "new.yaml"))).toBe(false);
  });

  it("refuses without a preview, when the file changed since, without a conversation, and for secrets.yaml", async () => {
    const ha = haWith("valid");
    expect(await handleToolCall(ha, "write_config_file", { path: "scripts.yaml", confirm: true }, ctx("x"))).toHaveProperty("error");
    await handleToolCall(ha, "write_config_file", { path: "scripts.yaml", content: edited }, ctx("a"));
    writeFileSync(path.join(base, "scripts.yaml"), ORIGINAL + "# edited by hand\n");
    const changed = (await handleToolCall(ha, "write_config_file", { path: "scripts.yaml", confirm: true }, ctx("b"))) as Record<string, string>;
    expect(changed.error).toMatch(/changed since the preview/);
    expect(await handleToolCall(ha, "write_config_file", { path: "scripts.yaml", content: edited }, { userId: "u", memory: {} } as ToolContext)).toHaveProperty("error");
    expect(await handleToolCall(ha, "write_config_file", { path: "secrets.yaml", content: "x: 2\n" }, ctx("a"))).toHaveProperty("error");
    expect(await handleToolCall(ha, "write_config_file", { path: "../evil.yaml", content: "x: 2\n" }, ctx("a"))).toHaveProperty("error");
  });
});

describe("helpers", () => {
  it("refuses a masked value it cannot put back", () => {
    expect(() => restoreMasked("other_code: «masqué»\n", "code: 1234\n")).toThrow(/«masqué»/);
  });

  it("shows only the changed lines with context", () => {
    expect(lineDiff("a\nb\nc\nd\ne\nf\ng", "a\nb\nc\nD\ne\nf\ng", 1)).toBe("@@ around line 3\n  c\n- d\n+ D\n  e");
  });
});
