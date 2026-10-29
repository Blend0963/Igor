/**
 * The house as the dataset generator (train/local-dataset.ts) reads it:
 * the entities exposed to Assist, their rooms, the lights' capabilities and
 * the scripts that need no field. Read through the same exposure-bounded
 * client as the tools, so the model learns only what it may touch.
 */

import type { HomeAssistantClient, ScriptInfo } from "../ha/client.js";
import type { DeviceScanner } from "../ha/device-scanner.js";
import type { TopologyScanner } from "../ha/topology-scanner.js";
import type { HouseDevice, HouseInventory } from "./local-dataset.js";

/** The domains the local model acts on or reads. */
const DOMAINS = new Set([
  "light", "switch", "fan", "input_boolean", "cover", "climate", "media_player", "scene",
  "lock", "vacuum", "sensor", "binary_sensor", "person", "weather",
]);

export async function readHouse(ha: HomeAssistantClient, topology: TopologyScanner, scanner: DeviceScanner): Promise<{ house: HouseInventory; scripts: ScriptInfo[] }> {
  await Promise.all([topology.refreshIfStale(), scanner.refreshIfStale()]);
  const [entities, scripts] = await Promise.all([ha.getEntities(), ha.listScripts().catch(() => [] as ScriptInfo[])]);
  const areaOf = new Map<string, string>();
  for (const room of topology.getRooms()) for (const e of room.entities) areaOf.set(e.id, room.name);
  const profiles = new Map(scanner.getProfiles().map((p) => [p.entityId, p]));

  const devices: HouseDevice[] = [];
  for (const e of entities) {
    const domain = e.entity_id.slice(0, e.entity_id.indexOf("."));
    if (!DOMAINS.has(domain)) continue;
    const name = typeof e.attributes.friendly_name === "string" ? e.attributes.friendly_name.trim() : "";
    if (!name) continue;
    const device: HouseDevice = { id: e.entity_id, name, area: areaOf.get(e.entity_id) };
    if (typeof e.attributes.device_class === "string") device.deviceClass = e.attributes.device_class;
    if (typeof e.attributes.unit_of_measurement === "string") device.unit = e.attributes.unit_of_measurement;
    const p = profiles.get(e.entity_id);
    if (p) device.light = { brightness: p.hasBrightness, white: p.whiteMethod.type, color: p.colorMethod.type !== "none" };
    devices.push(device);
  }
  return {
    house: {
      devices,
      scripts: scripts
        .filter((s) => !s.returns && !s.fields.some((f) => f.required))
        .map((s) => ({ id: s.id, name: s.name || s.id.replace(/^script\./, "").replace(/_/g, " ") })),
    },
    scripts,
  };
}
