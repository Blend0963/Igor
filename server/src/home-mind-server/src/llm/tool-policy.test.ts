import { describe, it, expect, afterEach, vi } from "vitest";
import { filterTools, setConfigEdits, toolRefusal } from "./tool-policy.js";
import { handleToolCall, sensitiveServiceIdentity } from "./tool-handler.js";
import type { HomeAssistantClient } from "../ha/client.js";

afterEach(() => setConfigEdits("automations"));

describe("config_edits", () => {
  const names = (list: Array<{ name: string }>) => list.map((t) => t.name);
  const tools = ["get_state", "create_automation", "update_automation", "delete_automation", "write_config_file", "read_config_file"].map((name) => ({ name }));

  it("off: read only; automations (default): no YAML writes; yaml: everything", () => {
    setConfigEdits("off");
    expect(names(filterTools(tools))).toEqual(["get_state", "read_config_file"]);
    setConfigEdits("automations");
    expect(names(filterTools(tools))).toEqual(["get_state", "create_automation", "update_automation", "delete_automation", "read_config_file"]);
    setConfigEdits("yaml");
    expect(names(filterTools(tools))).toEqual(names(tools));
  });

  it("refuses in the handler too, whatever the model asks", async () => {
    setConfigEdits("automations");
    const out = (await handleToolCall({} as HomeAssistantClient, "write_config_file", { path: "x.yaml", content: "a: 1" }, { conversationId: "c", turnId: "t" })) as { error: string };
    expect(out.error).toMatch(/turned off/);
  });
});

describe("unattended runs", () => {
  it("get no tool that needs a person or acts again later", () => {
    setConfigEdits("yaml");
    for (const name of ["create_automation", "write_config_file", "forget_memory", "schedule_task", "notify_when", "use_connector", "cancel_scheduled_task"]) {
      expect(toolRefusal(name, { unattended: true })).toBeDefined();
      expect(toolRefusal(name, {})).toBeUndefined();
    }
    expect(toolRefusal("get_state", { unattended: true })).toBeUndefined();
    expect(toolRefusal("call_service", { unattended: true })).toBeUndefined();
  });

  it("cannot confirm a change across two runs any more", async () => {
    const ha = { createAutomation: vi.fn() } as unknown as HomeAssistantClient;
    const input = { alias: "Volets", trigger: { platform: "time", at: "20:00:00" }, action: { service: "cover.close_cover" } };
    const ctx = (turnId: string) => ({ conversationId: "mado-thread:scheduled-tasks", turnId, unattended: true });
    await handleToolCall(ha, "create_automation", input, ctx("run-1"));
    await handleToolCall(ha, "create_automation", input, ctx("run-2"));
    expect(ha.createAutomation).not.toHaveBeenCalled();
  });
});

describe("sensitive services", () => {
  const ha = () => ({ callService: vi.fn().mockResolvedValue([]) }) as unknown as HomeAssistantClient & { callService: ReturnType<typeof vi.fn> };
  const unlock = { domain: "lock", service: "unlock", entity_id: "lock.porte" };

  it("are recognised with their target", () => {
    expect(sensitiveServiceIdentity(unlock)).toBe("lock.unlock:lock.porte");
    expect(sensitiveServiceIdentity({ domain: "shell_command", service: "anything" })).toBe("shell_command.anything:");
    expect(sensitiveServiceIdentity({ domain: "light", service: "turn_on", entity_id: "light.a" })).toBeUndefined();
  });

  it("need a yes in a later turn", async () => {
    const client = ha();
    const first = (await handleToolCall(client, "call_service", unlock, { conversationId: "c1", turnId: "t1" })) as Record<string, unknown>;
    expect(first.confirmation_required).toBe(true);
    expect(client.callService).not.toHaveBeenCalled();
    await handleToolCall(client, "call_service", unlock, { conversationId: "c1", turnId: "t2" });
    expect(client.callService).toHaveBeenCalledTimes(1);
  });

  it("are refused when nobody can confirm", async () => {
    const client = ha();
    for (const ctx of [undefined, { conversationId: "c2", turnId: "t1", unattended: true }]) {
      const out = (await handleToolCall(client, "call_service", unlock, ctx)) as Record<string, string>;
      expect(out.error).toMatch(/NOTHING was done/);
    }
    expect(client.callService).not.toHaveBeenCalled();
  });
});

describe("code mode (Igor vs Igor Code)", () => {
  it("a classic Igor thread (codeMode false) never gets code/sandbox tools", () => {
    for (const name of ["run_on_sandbox", "run_code", "use_connector"]) {
      expect(toolRefusal(name, { codeMode: false })).toMatch(/classic Igor thread/);
    }
    // write_config_file is refused in classic mode too (config_edits rule fires first)
    expect(toolRefusal("write_config_file", { codeMode: false })).toBeTruthy();
    expect(toolRefusal("get_state", { codeMode: false })).toBeUndefined();
  });
  it("a code thread (codeMode true) and non-panel turns keep them", () => {
    expect(toolRefusal("run_on_sandbox", { codeMode: true })).toBeUndefined();
    expect(toolRefusal("run_on_sandbox", {})).toBeUndefined();
  });
  it("filterTools drops them from the offered list in classic mode", () => {
    const tools = [{ name: "run_on_sandbox" }, { name: "get_state" }];
    expect(filterTools(tools, { codeMode: false }).map((t) => t.name)).toEqual(["get_state"]);
  });
});
