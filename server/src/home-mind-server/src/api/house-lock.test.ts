import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Request } from "express";
import { HouseLock, LOCKED_MESSAGE } from "./house-lock.js";

const panel = (headers: Record<string, string> = { "x-remote-user-id": "id-mur", "x-remote-user-name": "mur" }) =>
  ({ headers, socket: { remoteAddress: "172.30.32.2" } }) as unknown as Request;
const withToken = () => ({ headers: { authorization: "Bearer x" }, socket: { remoteAddress: "172.30.32.1" } }) as unknown as Request;

describe("HouseLock", () => {
  let key: string | undefined;
  let fail = false;
  const read = async () => {
    if (fail) throw new Error("HA down");
    return key;
  };
  beforeEach(() => {
    key = "off";
    fail = false;
  });

  it("lets everything through while no key is configured", async () => {
    const lock = new HouseLock(undefined, read);
    expect(await lock.refusal(panel())).toBeNull();
  });

  it("refuses a panel request while the key is away, unknown or unreadable", async () => {
    const lock = new HouseLock(undefined, read);
    lock.set({ key_entity: "binary_sensor.cle", allowed_users: ["Moi"], lock_threads: true });
    for (const k of ["off", "unavailable", "unknown", undefined]) {
      key = k;
      expect(await lock.refusal(panel())).toBe(LOCKED_MESSAGE);
    }
    fail = true;
    expect(await lock.refusal(panel())).toBe(LOCKED_MESSAGE);
  });

  it("answers again once the key is back", async () => {
    const lock = new HouseLock(undefined, read);
    lock.set({ key_entity: "binary_sensor.cle", lock_threads: true });
    key = "on";
    expect(await lock.refusal(panel())).toBeNull();
  });

  it("still answers the allowed users, by id, name or display name, whatever the case", async () => {
    const lock = new HouseLock(undefined, read);
    lock.set({ key_entity: "binary_sensor.cle", allowed_users: ["moi", "abc123"], lock_threads: true });
    expect(await lock.refusal(panel({ "x-remote-user-id": "x", "x-remote-user-name": "Moi" }))).toBeNull();
    expect(await lock.refusal(panel({ "x-remote-user-id": "ABC123" }))).toBeNull();
    expect(await lock.refusal(panel({ "x-remote-user-id": "x", "x-remote-user-display-name": "MOI" }))).toBeNull();
    expect(await lock.refusal(panel({ "x-remote-user-id": "x", "x-remote-user-name": "mur" }))).toBe(LOCKED_MESSAGE);
  });

  it("leaves the threads open while the key is away unless asked to lock them", async () => {
    const lock = new HouseLock(undefined, read);
    lock.set({ key_entity: "binary_sensor.cle" });
    expect(await lock.refusal(panel())).toBeNull();
    lock.set({ key_entity: "binary_sensor.cle", lock_threads: false });
    expect(await lock.refusal(panel())).toBeNull();
    lock.set({ key_entity: "binary_sensor.cle", lock_threads: true });
    expect(await lock.refusal(panel())).toBe(LOCKED_MESSAGE);
  });

  it("does not judge token requests (the integration checked; the app holds the token)", async () => {
    const lock = new HouseLock(undefined, read);
    lock.set({ key_entity: "binary_sensor.cle" });
    expect(await lock.refusal(withToken())).toBeNull();
  });

  it("does not trust user headers from another address than the ingress proxy", async () => {
    const lock = new HouseLock(undefined, read);
    lock.set({ key_entity: "binary_sensor.cle", allowed_users: ["moi"] });
    const forged = { headers: { "x-remote-user-name": "moi" }, socket: { remoteAddress: "172.30.33.5" } } as unknown as Request;
    // Not ingress: the auth middleware wants the token there; the lock leaves it to it.
    expect(await lock.refusal(forged)).toBeNull();
  });

  it("keeps its settings across a restart and ignores a malformed entity id", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-"));
    const file = path.join(dir, "house-lock.json");
    new HouseLock(file, read).set({ key_entity: "binary_sensor.cle", allowed_users: ["moi"] });
    const again = new HouseLock(file, read);
    expect(again.settings()).toEqual({ keyEntity: "binary_sensor.cle", allowedUsers: ["moi"] });
    expect(again.set({ key_entity: "../etc" }).keyEntity).toBeUndefined();
    fs.rmSync(dir, { recursive: true });
  });
});
