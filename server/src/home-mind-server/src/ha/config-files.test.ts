import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { forbiddenAdditions, maskSecrets, readConfigFile, restoreMasked } from "./config-files.js";

let base: string;
let outside: string;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "igor-config-"));
  outside = mkdtempSync(path.join(tmpdir(), "igor-outside-"));
  writeFileSync(path.join(base, "configuration.yaml"), "homeassistant:\n  name: Maison\nhttp:\n  api_password: hunter2\nmqtt:\n  password: !secret mqtt_pw\n");
  writeFileSync(path.join(base, "secrets.yaml"), "mqtt_pw: hunter2\n");
  mkdirSync(path.join(base, "packages"));
  writeFileSync(path.join(base, "packages", "chauffage.yaml"), "automation:\n  - alias: Chauffage\n");
  mkdirSync(path.join(base, ".storage"));
  writeFileSync(path.join(base, ".storage", "auth.yaml"), "x: 1\n");
  writeFileSync(path.join(base, "notes.txt"), "hello\n");
  writeFileSync(path.join(outside, "stolen.yaml"), "a: 1\n");
  symlinkSync(path.join(outside, "stolen.yaml"), path.join(base, "link.yaml"));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("read_config_file", () => {
  it("lists YAML files, without secrets.yaml or hidden folders", () => {
    const out = readConfigFile(base, "") as { listing: string[] };
    expect(out.listing).toContain("configuration.yaml");
    expect(out.listing).toContain("packages/chauffage.yaml");
    expect(out.listing).not.toContain("secrets.yaml");
    expect(out.listing.some((f) => f.startsWith(".storage"))).toBe(false);
  });

  it("reads a file with secret values masked and !secret references kept", () => {
    const out = readConfigFile(base, "configuration.yaml") as { content: string };
    expect(out.content).toContain("name: Maison");
    expect(out.content).toContain("api_password: «masqué»");
    expect(out.content).toContain("password: !secret mqtt_pw");
    expect(out.content).not.toContain("hunter2");
  });

  it("refuses secrets.yaml, other file types and paths leaving the folder", () => {
    expect(readConfigFile(base, "secrets.yaml")).toHaveProperty("error");
    expect(readConfigFile(base, "notes.txt")).toHaveProperty("error");
    expect(() => readConfigFile(base, "../etc/passwd")).toThrow();
    expect(() => readConfigFile(base, "link.yaml")).toThrow();
  });

  it("says so when there is no configuration folder", () => {
    expect(readConfigFile(path.join(base, "nope"), "")).toHaveProperty("error");
  });
});

describe("maskSecrets", () => {
  it("masks keys that name a secret, in lists too", () => {
    expect(maskSecrets("- token: abc\n  code: 1234\n  name: x")).toBe("- token: «masqué»\n  code: «masqué»\n  name: x");
  });
});

describe("maskSecrets, harder cases", () => {
  it("masks multi-line values and lists under a secret key, and flow mappings", () => {
    const yaml = "mqtt:\n  password: |\n    line1\n    line2\n  user: bob\napi_keys:\n  - abc\n  - !secret k\nauth: {password: hunter2, user: bob}\n";
    const masked = maskSecrets(yaml);
    expect(masked).not.toContain("line1");
    expect(masked).not.toContain("abc");
    expect(masked).not.toContain("hunter2");
    expect(masked).toContain("user: bob");
    expect(masked).toContain("!secret k");
    expect(masked.split("\n")).toHaveLength(yaml.split("\n").length);
    // What was masked comes back from the file when the model keeps the line.
    expect(restoreMasked(masked, yaml)).toBe(yaml);
  });
});

describe("forbiddenAdditions", () => {
  it("refuses new ways to run commands or loosen the login, not existing ones", () => {
    expect(forbiddenAdditions("shell_command:\n  x: rm -rf /\n", "")).toHaveLength(1);
    expect(forbiddenAdditions("script:\n  a:\n    sequence:\n      - action: hassio.addon_stop\n", "")).toEqual(["a hassio (Supervisor) action"]);
    expect(forbiddenAdditions("homeassistant:\n  auth_providers:\n    - type: trusted_networks\n", "")).toHaveLength(1);
    const existing = "shell_command:\n  backup: ./b.sh\n";
    expect(forbiddenAdditions(existing + "light:\n", existing)).toEqual([]);
  });
});

describe("paths through a symlinked folder", () => {
  it("refuses a new file under a folder that links outside", () => {
    symlinkSync(outside, path.join(base, "escape"));
    expect(() => readConfigFile(base, "escape/new.yaml")).toThrow(/inside/);
  });
});
