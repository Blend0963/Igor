import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
import { execFile } from "node:child_process";
import { runVmCommand } from "../utils/vmSsh";
import { vmExecHandler } from "./vmExec";

const execFileMock = vi.mocked(execFile);

beforeEach(() => {
  execFileMock.mockReset();
  process.env.VM_SSH_HOST = "10.45.100.1";
  process.env.VM_SSH_USER = "agent";
  process.env.VM_SSH_KEY_PATH = "/run/secrets/vm_ssh_key";
});

describe("runVmCommand", () => {
  it("appelle ssh avec la bonne cible, la clé et la commande en dernier arg", async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb: any) => { cb(null, "hello\n", ""); return {} as any; });
    const res = await runVmCommand("echo hello");
    expect(res).toMatchObject({ ok: true, exitCode: 0, stdout: "hello\n" });
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args).toContain("agent@10.45.100.1");
    expect(args).toContain("-i");
    expect(args).toContain("/run/secrets/vm_ssh_key");
    expect(args.at(-1)).toBe("echo hello");
  });

  it("propage le code de sortie et stderr en cas d'échec", async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb: any) => {
      const err: any = new Error("exit 1"); err.code = 1; cb(err, "", "boom"); return {} as any;
    });
    const res = await runVmCommand("false");
    expect(res).toMatchObject({ ok: false, exitCode: 1, stderr: "boom" });
  });

  it("tronque une sortie trop longue", async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb: any) => { cb(null, "x".repeat(50_000), ""); return {} as any; });
    const res = await runVmCommand("cat big");
    expect(res.stdout.length).toBeLessThan(21_000);
    expect(res.stdout).toContain("tronqué");
  });
});

describe("vmExecHandler", () => {
  it("refuse une commande vide", async () => {
    const res = await vmExecHandler({ command: "   " });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("command");
  });

  it("bloque un rm -rf /", async () => {
    const res = await vmExecHandler({ command: "rm -rf /" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("refusée");
  });

  it("limite le timeout entre 5 et 600", async () => {
    execFileMock.mockImplementation((_c, _a, opts: any, cb: any) => { cb(null, "", ""); return {} as any; });
    await runVmCommand("sleep 1", 99999);
    const opts = execFileMock.mock.calls[0][2] as any;
    expect(opts.timeout).toBe(600_000);
  });
});
