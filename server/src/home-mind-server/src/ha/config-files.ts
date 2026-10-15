/**
 * Read-only access to Home Assistant's YAML for read_config_file: the
 * configuration folder the add-on maps at /config, so MaDo can review
 * automations, scripts and packages written by hand, not only those the UI
 * editor stores.
 *
 * Bounded on purpose. Only .yaml / .yml files, inside the folder (no "..",
 * no symlink leading out). secrets.yaml is never read, and a value under a
 * key that names a password, token or key is masked, so a hard-coded secret
 * does not reach the model or its provider; `!secret name` references stay
 * as they are, they reveal nothing. Folders of code, caches and backups are
 * left out of listings. Writing is not offered: changes go through the
 * automation tools and their preview-and-confirm step.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([".storage", "custom_components", "deps", "www", "tts", "backups", "node_modules", ".cloud", ".git", "image", "nives", "__pycache__"]);
const MAX_LIST = 300;
const MAX_CHARS = 60_000;
const SECRET_KEY = /(password|passwd|token|api_?key|secret|private_?key|access_?key|webhook_id|credentials?)/i;
const SECRET_EXACT = new Set(["code", "pin", "passcode"]);

/** Masks the value of every key that names a secret, except `!secret` references. */
export function maskSecrets(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => {
      const m = /^(\s*(?:-\s+)?)([A-Za-z0-9_.-]+)(\s*:\s*)(\S.*)$/.exec(line);
      if (!m) return line;
      const [, indent, key, sep, value] = m;
      if (!(SECRET_KEY.test(key) || SECRET_EXACT.has(key.toLowerCase()))) return line;
      if (/^!secret\b/.test(value) || /^[|>]/.test(value)) return line;
      return `${indent}${key}${sep}«masqué»`;
    })
    .join("\n");
}

function isYaml(name: string): boolean {
  return /\.ya?ml$/i.test(name);
}

function isSecrets(name: string): boolean {
  return /^secrets\.ya?ml$/i.test(path.basename(name));
}

/** The YAML files under the folder, as relative paths. */
export function listConfigFiles(base: string, dir = ""): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    if (out.length >= MAX_LIST || depth > 4) return;
    let entries: string[];
    try {
      entries = readdirSync(path.join(base, rel)).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const child = rel ? `${rel}/${name}` : name;
      let st;
      try {
        st = statSync(path.join(base, child));
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith(".")) walk(child, depth + 1);
      } else if (isYaml(name) && !isSecrets(name)) {
        out.push(child);
        if (out.length >= MAX_LIST) return;
      }
    }
  };
  walk(dir, 0);
  return out;
}

/** A path inside the folder, or an error explaining why not. */
function resolveInside(base: string, rel: string): string {
  const clean = rel.replace(/^\/+/, "").replace(/^config\//, "");
  if (clean.split(/[\\/]/).includes("..")) throw new Error("Paths must stay inside the Home Assistant configuration folder.");
  const full = path.resolve(base, clean);
  const realBase = realpathSync(base);
  const real = existsSync(full) ? realpathSync(full) : full;
  if (real !== realBase && !real.startsWith(realBase + path.sep)) throw new Error("Paths must stay inside the Home Assistant configuration folder.");
  return real;
}

export type ConfigFileResult =
  | { listing: string[]; folder: string; note?: string }
  | { path: string; content: string; truncated?: boolean }
  | { error: string };

export function readConfigFile(base: string, rel: string): ConfigFileResult {
  if (!existsSync(base)) return { error: "The Home Assistant configuration folder is not available to MaDo." };
  const target = (rel ?? "").trim();
  const full = target ? resolveInside(base, target) : realpathSync(base);
  if (!existsSync(full)) return { error: `${target} does not exist. Call read_config_file without a path to list the YAML files.` };
  if (statSync(full).isDirectory()) {
    const folder = path.relative(realpathSync(base), full);
    const listing = listConfigFiles(base, folder);
    return { folder: folder || ".", listing, ...(listing.length >= MAX_LIST ? { note: `Only the first ${MAX_LIST}; list a subfolder.` } : {}) };
  }
  const name = path.relative(realpathSync(base), full);
  if (isSecrets(name)) return { error: "secrets.yaml is never read." };
  if (!isYaml(name)) return { error: "Only YAML files (.yaml, .yml) can be read." };
  const text = maskSecrets(readFileSync(full, "utf8"));
  return text.length > MAX_CHARS ? { path: name, content: text.slice(0, MAX_CHARS), truncated: true } : { path: name, content: text };
}
