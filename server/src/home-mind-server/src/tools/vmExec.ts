import { runVmCommand, type VmExecResult } from "../utils/vmSsh";

export const VM_EXEC_TOOL = {
  type: "function",
  function: {
    name: "vm_exec",
    description:
      "Exécute une commande shell sur la VM sandbox (10.45.100.1) en SSH " +
      "(utilisateur 'agent', clé privée). Retourne stdout, stderr, code de sortie et durée.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Commande shell à exécuter sur la VM (ex: 'cd /srv/sandbox && npm test')",
        },
        timeout_sec: {
          type: "number",
          description: "Timeout en secondes, entre 5 et 600 (défaut 120)",
        },
      },
      required: ["command"],
    },
  },
} as const;

// Gardes-fous basiques contre les commandes manifestement destructrices
const FORBIDDEN = [
  /\brm\s+(-[a-z]*[rf][a-z]*)\s+(\/|~|\$HOME|\*)\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, // fork bomb
  /\bmkfs\b/i,
  />\s*\/dev\/sd[a-z]/i,
];

export async function vmExecHandler(args: {
  command?: string;
  timeout_sec?: number;
}): Promise<VmExecResult & { error?: string }> {
  const empty = { ok: false, exitCode: null, stdout: "", stderr: "", durationMs: 0 } as const;

  if (!args.command || typeof args.command !== "string" || !args.command.trim()) {
    return { ...empty, error: "Paramètre 'command' requis et non vide." };
  }
  if (FORBIDDEN.some((re) => re.test(args.command))) {
    return { ...empty, error: "Commande refusée par la policy de sécurité du pont." };
  }
  return runVmCommand(args.command, args.timeout_sec);
}
