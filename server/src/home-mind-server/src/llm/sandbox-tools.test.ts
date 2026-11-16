import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/vmSsh.js", () => ({
  runVmCommand: vi.fn(),
}));

import { runVmCommand } from "../utils/vmSsh.js";
import { SANDBOX_TOOLS, SANDBOX_TOOL_NAMES, handleSandboxTool } from "./sandbox-tools.js";

const runVmCommandMock = vi.mocked(runVmCommand);

describe("sandbox tools", () => {
  beforeEach(() => {
    runVmCommandMock.mockReset();
  });

  it("declares exactly one tool: run_on_sandbox", () => {
    expect(SANDBOX_TOOL_NAMES).toEqual(new Set(["run_on_sandbox"]));
    expect(SANDBOX_TOOLS.map((t) => t.name)).toEqual(["run_on_sandbox"]);
    expect(SANDBOX_TOOLS[0].parameters.required).toEqual(["cmd"]);
  });

  it("returns exit code, stdout and stderr from the SSH bridge", async () => {
    runVmCommandMock.mockResolvedValue({
      ok: true,
      exitCode: 0,
      stdout: "hello\n",
      stderr: "",
      durationMs: 42,
    });

    const result = await handleSandboxTool("run_on_sandbox", { cmd: "echo hello" });
    expect(runVmCommandMock).toHaveBeenCalledWith("echo hello");
    expect(result).toEqual({
      ok: true,
      exit_code: 0,
      stdout: "hello\n",
      stderr: "",
      duration_ms: 42,
    });
  });

  it("passes failures through so the model can read them", async () => {
    runVmCommandMock.mockResolvedValue({
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "pytest: command not found",
      durationMs: 10,
    });

    const result = await handleSandboxTool("run_on_sandbox", { cmd: "pytest" });
    expect(result).toMatchObject({ ok: false, exit_code: 1, stderr: "pytest: command not found" });
  });

  it("requires a cmd", async () => {
    const result = await handleSandboxTool("run_on_sandbox", {});
    expect(result).toEqual({ error: expect.stringContaining("requires a 'cmd'") });
    expect(runVmCommandMock).not.toHaveBeenCalled();
  });

  it("rejects unknown sandbox tools", async () => {
    const result = await handleSandboxTool("rm_rf_everything", { cmd: "true" });
    expect(result).toEqual({ error: "Unknown sandbox tool: rm_rf_everything" });
    expect(runVmCommandMock).not.toHaveBeenCalled();
  });
});
