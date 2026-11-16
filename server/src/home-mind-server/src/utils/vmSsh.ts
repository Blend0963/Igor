import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

export interface VmExecResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const MAX_OUTPUT = 20_000; // caractères max renvoyés au LLM

export interface VmSshOptions {
  host: string;
  port: number;
  user: string;
  keyPath: string;
  timeoutSec: number;
}

export function getVmSshOptionsFromEnv(): VmSshOptions {
  return {
    host: process.env.VM_SSH_HOST ?? "10.45.100.1",
    port: clampPort(Number(process.env.VM_SSH_PORT ?? 22)),
    user: process.env.VM_SSH_USER ?? "agent",
    keyPath: process.env.VM_SSH_KEY_PATH ?? "/run/secrets/vm_ssh_key",
    timeoutSec: clampTimeout(Number(process.env.VM_SSH_TIMEOUT_SEC ?? 120)),
  };
}

function clampPort(v: number): number {
  if (!Number.isInteger(v) || v < 1 || v > 65535) return 22;
  return v;
}

const warnedMissingKeys = new Set<string>();

function clampTimeout(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 120;
  return Math.min(Math.max(Math.floor(v), 5), 600); // bornes 5s..600s
}

export function runVmCommand(command: string, timeoutSec?: number): Promise<VmExecResult> {
  const opts = getVmSshOptionsFromEnv();
  const timeout = clampTimeout(timeoutSec ?? opts.timeoutSec);
  const started = Date.now();

  if (!existsSync(opts.keyPath) && !warnedMissingKeys.has(opts.keyPath)) {
    warnedMissingKeys.add(opts.keyPath);
    console.warn(
      `[vmSsh] Clé SSH introuvable : ${opts.keyPath}. Dépose la clé privée dans /config ` +
        `et règle vm_ssh_key_path dans la configuration de l'add-on.`
    );
  }

  return new Promise((resolve) => {
    // execFile = pas de shell local : la commande n'est jamais réinterprétée côté serveur
    execFile(
      "ssh",
      [
        "-i", opts.keyPath,
        "-o", "BatchMode=yes",               // jamais de prompt interactif
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=15",
        "-p", String(opts.port),
        `${opts.user}@${opts.host}`,
        command,                              // exécutée par le shell distant (voulu)
      ],
      { timeout: timeout * 1000, maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        const code = error && typeof (error as any).code === "number" ? (error as any).code : null;
        resolve({
          ok: code === 0,
          exitCode: code,
          stdout: truncate(String(stdout)),
          stderr: truncate(String(stderr)),
          durationMs: Date.now() - started,
        });
      }
    );
  });
}

function truncate(s: string): string {
  return s.length > MAX_OUTPUT
    ? s.slice(0, MAX_OUTPUT) + `\n…[tronqué — ${s.length} caractères au total]`
    : s;
}