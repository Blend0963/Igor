import { describe, it, expect, vi } from "vitest";
import { isTechnical, readHouse } from "./house-inventory.js";
import type { EntityState, HomeAssistantClient } from "../ha/client.js";
import type { DeviceScanner } from "../ha/device-scanner.js";
import type { TopologyScanner } from "../ha/topology-scanner.js";

const state = (entity_id: string, friendly_name: string, attributes: Record<string, unknown> = {}): EntityState => ({
  entity_id, state: "on", attributes: { friendly_name, ...attributes }, last_changed: "", last_updated: "",
});

describe("isTechnical", () => {
  it("leaves out what nobody says out loud", () => {
    expect(isTechnical(state("sensor.capteur_batterie", "Batterie capteur cuisine", { device_class: "battery", unit_of_measurement: "%" }))).toBe(true);
    expect(isTechnical(state("sensor.prise_rssi", "Prise salon RSSI", { unit_of_measurement: "dBm" }))).toBe(true);
    expect(isTechnical(state("switch.prise_led", "Voyant prise salon"))).toBe(true);
    expect(isTechnical(state("switch.prise_lock", "Verrouillage enfant prise"))).toBe(true);
    expect(isTechnical(state("sensor.box_uptime", "Box temps de fonctionnement"))).toBe(true);
    expect(isTechnical(state("number.capteur_cal", "Étalonnage température"))).toBe(true);
  });

  it("keeps the house", () => {
    expect(isTechnical(state("light.bande_led", "Bande LED salon"))).toBe(false);
    expect(isTechnical(state("sensor.temp_salon", "Température salon", { device_class: "temperature", unit_of_measurement: "°C" }))).toBe(false);
    expect(isTechnical(state("sensor.conso", "Consommation maison", { device_class: "energy", unit_of_measurement: "kWh" }))).toBe(false);
    expect(isTechnical(state("switch.sapin", "Prise sapin"))).toBe(false);
  });
});

describe("readHouse", () => {
  it("marks registry diagnostics and technical entities as read-only, and gives a group its members' room", async () => {
    const ha = {
      getEntities: vi.fn().mockResolvedValue([
        state("light.salon", "Lumières salon", { entity_id: ["light.a", "light.b"] }),
        state("light.a", "Ampoule salon gauche"),
        state("light.b", "Ampoule salon droite"),
        state("sensor.bat", "Batterie télécommande", { device_class: "battery" }),
        state("switch.diag", "Prise salon mode", {}),
      ]),
      listScripts: vi.fn().mockResolvedValue([]),
    } as unknown as HomeAssistantClient;
    const topology = {
      refreshIfStale: vi.fn(),
      getRooms: () => [{ name: "Salon", entities: [{ id: "light.a", name: null }, { id: "light.b", name: null }] }],
    } as unknown as TopologyScanner;
    const scanner = { refreshIfStale: vi.fn(), getProfiles: () => [] } as unknown as DeviceScanner;
    const { house, technical } = await readHouse(ha, topology, scanner, async () => new Set(["switch.diag"]));
    expect(house.devices.map((d) => d.id)).toEqual(["light.salon", "light.a", "light.b", "sensor.bat", "switch.diag"]);
    expect(technical).toBe(2);
    expect(house.devices.filter((d) => d.technical).map((d) => d.id)).toEqual(["sensor.bat", "switch.diag"]);
    expect(house.devices[0]).toMatchObject({ area: "Salon", members: ["light.a", "light.b"] });
  });
});

describe("isUnspeakable", () => {
  it("leaves out names carrying a machine id, keeps the rest", async () => {
    const { isUnspeakable } = await import("./house-inventory.js");
    expect(isUnspeakable("input_boolean.material_you_navbar_6926f9e4e63f49d1824a39ead0cc86e1", "Material You navbar")).toBe(true);
    expect(isUnspeakable("media_player.browser_mod_12854781_1591d154", "browser_mod_12854781_1591d154")).toBe(true);
    expect(isUnspeakable("light.10_45_30_4", "Lumière cuisine")).toBe(false);
    expect(isUnspeakable("switch.dreamebot_l10_prime_auto_drying", "Dreamebot L10 Prime séchage automatique")).toBe(false);
    expect(isUnspeakable("sensor.deadbeef", "Capteur")).toBe(false);
  });
});
