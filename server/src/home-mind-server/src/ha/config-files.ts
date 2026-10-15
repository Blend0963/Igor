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
 * left out of listings. Writing (write_config_file, below) is previewed,
 * confirmed by the user in a later turn, and checked by Home Assistant.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const SKIP_DIRS = new Set([".storage", "custom_components", "deps", "www", "tts", "backups", "node_modules", ".cloud", ".git", "image", "nives", "__pycache__"]);
const MAX_LIST = 300;
const MAX_CHARS = 60_000;
const SECRET_KEY = /(password|passwd|token|api_?key|secret|private_?key|access_?key|webhook_id|credentials?)/i;
const SECRET_EXACT = new Set(["code", "pin", "passcode"]);

const isSecretKey = (key: string) => SECRET_KEY.test(key) || SECRET_EXACT.has(key.toLowerCase());
const MASK_TEXT = "«masqué»";

/**
 * Masks secret values, keeping one output line per input line (restoreMasked
 * relies on it):
 * - `password: hunter2` and `- token: abc` → the value is masked;
 * - `password: |` or `api_keys:` followed by more-indented lines → every line
 *   of that block is masked (multi-line values, lists of keys);
 * - flow mappings `{password: x, user: y}` → the secret entries are masked;
 * - `!secret name` references are kept: they reveal nothing.
 */
export function maskSecrets(yaml: string): string {
  const lines = yaml.split("\n");
  let blockIndent = -1;
  return lines
    .map((line) => {
      const indent = line.length - line.trimStart().length;
      if (blockIndent >= 0) {
        if (line.trim() === "" || indent > blockIndent) {
          if (line.trim() === "" || /!secret\b/.test(line)) return line;
          const lead = /^(\s*(?:-\s+)?)/.exec(line)?.[1] ?? "";
          return `${lead}${MASK_TEXT}`;
        }
        blockIndent = -1;
      }
      let out = line;
      const m = /^(\s*(?:-\s+)?)([A-Za-z0-9_.-]+)(\s*:\s*)(.*)$/.exec(line);
      if (m && isSecretKey(m[2])) {
        const value = m[4].trim();
        if (value === "" || /^[|>][-+0-9]*$/.test(value)) {
          blockIndent = indent;
          return line;
        }
        if (!/^!secret\b/.test(value)) out = `${m[1]}${m[2]}${m[3]}${MASK_TEXT}`;
      }
      if (out.includes("{")) {
        out = out.replace(/([{,]\s*)([A-Za-z0-9_.-]+)(\s*:\s*)([^,}]+)/g, (all, pre, key, sep, value) =>
          isSecretKey(key) && !/^\s*!secret\b/.test(value) ? `${pre}${key}${sep}${MASK_TEXT}` : all
        );
      }
      return out;
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
  // A path that does not exist yet is judged by its nearest existing folder,
  // resolved through any symlink: "x/new.yaml" with x → / must not pass.
  let existing = full;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    rest.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const real = path.join(realpathSync(existing), ...rest);
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

// ----- writing (write_config_file) -----
//
// A change is two calls in two turns. The first hands the full new content;
// nothing is written, the server keeps it and returns the lines that change
// (computed on the masked texts, so no secret reaches the model). The user
// answers; the second call only says "confirm", and what is written is the
// content that was shown, never a re-generated one. Before writing: an
// optional backup copy (the user chooses), and refusal if the file changed in
// between. After writing, the caller runs Home Assistant's configuration check
// and puts the old content back if it fails.

const MAX_WRITE_CHARS = 300_000;
const PENDING_TTL_MS = 15 * 60_000;
const MASK = "«masqué»";

interface PendingWrite {
  path: string;
  full: string;
  content: string;
  original: string | null;
  turnId: string;
  at: number;
}

const pendingWrites = new Map<string, PendingWrite>();

const sha = (s: string | null) => (s === null ? "" : createHash("sha256").update(s).digest("hex"));

/**
 * The model only ever saw masked values; a line it kept as it read it
 * ("password: «masqué»") gets its real value back from the file. Any mask
 * left after that (a masked line the model moved or edited) is refused.
 */
export function restoreMasked(next: string, original: string | null): string {
  if (!next.includes(MASK)) return next;
  const originalLines = (original ?? "").split("\n");
  const maskedLines = maskSecrets(original ?? "").split("\n");
  const byMasked = new Map<string, string[]>();
  maskedLines.forEach((masked, i) => {
    if (masked !== originalLines[i]) byMasked.set(masked, [...(byMasked.get(masked) ?? []), originalLines[i]]);
  });
  const out = next.split("\n").map((line) => {
    if (!line.includes(MASK)) return line;
    const candidates = byMasked.get(line);
    return candidates?.length ? (candidates.shift() as string) : line;
  });
  const result = out.join("\n");
  if (result.includes(MASK)) {
    throw new Error(`The new content still contains ${MASK} where a secret value was hidden. Keep such lines exactly as they were read, or replace the value with a !secret reference.`);
  }
  return result;
}

/**
 * What MaDo may never add to the configuration, whatever the user confirms:
 * ways to run commands or code on the host, to call out to arbitrary URLs, to
 * reach the Supervisor, or to loosen Home Assistant's own login. Lines that
 * were already there are left alone (editing a file that has a shell_command
 * elsewhere is fine); only new occurrences are refused.
 */
const FORBIDDEN_ADDITIONS: Array<[RegExp, string]> = [
  [/^\s*(shell_command|command_line|python_script|pyscript|rest_command)\s*:/gm, "a shell_command, command_line, python_script, pyscript or rest_command block"],
  [/\bplatform\s*:\s*(command_line|shell_command|rest|pyscript)\b/g, "a command_line, rest or pyscript platform"],
  [/\b(shell_command|python_script|pyscript|rest_command|command_line)\.[a-z0-9_]+/g, "a call to shell_command, python_script, pyscript, rest_command or command_line"],
  [/\bhassio\.[a-z0-9_]+/g, "a hassio (Supervisor) action"],
  [/\bhomeassistant\.stop\b/g, "homeassistant.stop"],
  [/\b(auth_providers|trusted_networks|trusted_proxies|allow_bypass_login|use_x_forwarded_for|allowlist_external_dirs|allowlist_external_urls)\b/g, "a change to Home Assistant's login, proxy or file access settings"],
];

/** What the new content adds that MaDo may not write, as phrases; empty when none. */
export function forbiddenAdditions(next: string, original: string | null): string[] {
  const found: string[] = [];
  for (const [pattern, label] of FORBIDDEN_ADDITIONS) {
    const count = (text: string) => (text.match(pattern) ?? []).length;
    if (count(next) > count(original ?? "")) found.push(label);
  }
  return found;
}

/** The changed lines with a little context, as "- old" / "+ new". */
export function lineDiff(a: string, b: string, context = 2, maxChars = 8000): string {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x.length * y.length > 9_000_000) return `(${x.length} → ${y.length} lines; too long to compare line by line)`;
  const n = x.length;
  const m = y.length;
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = x[i] === y[j] ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
    }
  }
  const ops: Array<{ t: " " | "-" | "+"; s: string; line: number }> = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) ops.push({ t: " ", s: x[i++], line: j++ + 1 });
    else if (i < n && (j >= m || lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1])) ops.push({ t: "-", s: x[i++], line: j + 1 });
    else ops.push({ t: "+", s: y[j], line: ++j });
  }
  const keep = new Set<number>();
  ops.forEach((op, k) => {
    if (op.t !== " ") for (let c = Math.max(0, k - context); c <= Math.min(ops.length - 1, k + context); c++) keep.add(c);
  });
  if (!keep.size) return "(no change)";
  const lines: string[] = [];
  let last = -2;
  for (const k of [...keep].sort((p, q) => p - q)) {
    if (k !== last + 1) lines.push(`@@ around line ${ops[k].line}`);
    lines.push(`${ops[k].t} ${ops[k].s}`);
    last = k;
  }
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (diff cut)` : text;
}

function writableTarget(base: string, rel: string): { full: string; name: string } {
  if (!existsSync(base)) throw new Error("The Home Assistant configuration folder is not available to MaDo.");
  const target = (rel ?? "").trim();
  if (!target) throw new Error("write_config_file needs a path.");
  const full = resolveInside(base, target);
  const name = path.relative(realpathSync(base), full);
  if (isSecrets(name)) throw new Error("secrets.yaml is never written.");
  if (!isYaml(name)) throw new Error("Only YAML files (.yaml, .yml) can be written.");
  if (name.split(path.sep).some((part) => SKIP_DIRS.has(part) || part.startsWith("."))) {
    throw new Error("That folder is not part of the YAML configuration MaDo may change.");
  }
  if (existsSync(full) && statSync(full).isDirectory()) throw new Error(`${name} is a folder.`);
  return { full, name };
}

export interface WritePreview {
  confirmation_required: true;
  path: string;
  new_file: boolean;
  changes: string;
}

/** First call: keeps the content and returns what would change. Writes nothing. */
export function prepareConfigWrite(base: string, rel: string, content: string, conversationId: string, turnId: string): WritePreview {
  if (typeof content !== "string" || !content.trim()) throw new Error("write_config_file needs the full new content of the file.");
  if (content.length > MAX_WRITE_CHARS) throw new Error("That content is too long.");
  const { full, name } = writableTarget(base, rel);
  const original = existsSync(full) ? readFileSync(full, "utf8") : null;
  const restored = restoreMasked(content.endsWith("\n") ? content : `${content}\n`, original);
  if (original !== null && restored === original) throw new Error("The new content is identical to the file: nothing to change.");
  const forbidden = forbiddenAdditions(restored, original);
  if (forbidden.length) {
    throw new Error(
      `MaDo may not add ${forbidden.join("; ")} to the configuration. NOTHING was prepared. Tell the user this part must be written by hand if they really want it.`
    );
  }
  pendingWrites.set(`${conversationId}\u0000${name}`, { path: name, full, content: restored, original, turnId, at: Date.now() });
  return {
    confirmation_required: true,
    path: name,
    new_file: original === null,
    changes: lineDiff(maskSecrets(original ?? ""), maskSecrets(restored)),
  };
}

export interface AppliedWrite {
  path: string;
  full: string;
  backup?: string;
  original: string | null;
}

/** Second call, in a later turn: writes what was previewed (and a backup if asked). */
export function applyConfigWrite(base: string, rel: string, conversationId: string, turnId: string, backup: boolean, now = new Date()): AppliedWrite {
  const { name } = writableTarget(base, rel);
  const key = `${conversationId}\u0000${name}`;
  const pending = pendingWrites.get(key);
  if (!pending || Date.now() - pending.at > PENDING_TTL_MS) {
    pendingWrites.delete(key);
    throw new Error("There is no previewed change for this file (or it is older than 15 minutes). Call write_config_file with the full content first to preview it.");
  }
  if (pending.turnId === turnId) {
    throw new Error("The user has not answered the preview yet. Show them the changes, ask, and wait for their reply.");
  }
  const current = existsSync(pending.full) ? readFileSync(pending.full, "utf8") : null;
  if (sha(current) !== sha(pending.original)) {
    pendingWrites.delete(key);
    throw new Error("The file changed since the preview. Read it again and preview the change again.");
  }
  pendingWrites.delete(key);
  let backupPath: string | undefined;
  if (backup && pending.original !== null) {
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
    backupPath = `${pending.full}.mado-${stamp}.bak`;
    writeFileSync(backupPath, pending.original);
  }
  mkdirSync(path.dirname(pending.full), { recursive: true });
  const tmp = `${pending.full}.mado-tmp`;
  writeFileSync(tmp, pending.content);
  renameSync(tmp, pending.full);
  return { path: pending.path, full: pending.full, original: pending.original, ...(backupPath ? { backup: path.relative(realpathSync(base), backupPath) } : {}) };
}

/** Puts the previous content back (or removes a file that did not exist). */
export function revertConfigWrite(applied: AppliedWrite): void {
  if (applied.original === null) {
    try {
      unlinkSync(applied.full);
    } catch {
      // Best effort: the check already failed and is reported.
    }
    return;
  }
  writeFileSync(applied.full, applied.original);
}
