/**
 * The house as the dataset generator (train/local-dataset.ts) reads it:
 * the entities exposed to Assist, their rooms, the lights' capabilities and
 * the scripts that need no field. Read through the same exposure-bounded
 * client as the tools, so the model learns only what it may touch.
 *
 * Exposing everything is fine: what nobody says out loud is left out. That
 * is what the entity registry marks as diagnostic or configuration, or
 * hides, and what reads like it (batteries, signal, firmware, uptime,
 * indicator lights...). Groups keep their members, which only lose the
 * room's words ("la lumière du salon" is the group).
 */

import type { HomeAssistantClient, EntityState, ScriptInfo } from "../ha/client.js";
import type { DeviceScanner } from "../ha/device-scanner.js";
import type { TopologyScanner } from "../ha/topology-scanner.js";
import { wsCommand } from "../ha/websocket.js";
import type { HouseDevice, HouseInventory } from "./local-dataset.js";

/** The domains the local model acts on or reads. */
const DOMAINS = new Set([
  "light", "switch", "fan", "input_boolean", "cover", "climate", "media_player", "scene",
  "lock", "vacuum", "sensor", "binary_sensor", "person", "weather",
]);

/** Domains whose entities can stand for others (a light group, a cover group). */
const GROUPABLE = new Set(["light", "switch", "fan", "cover", "media_player"]);

/** Sensor classes about the device itself, not the house. */
const TECHNICAL_CLASSES = new Set([
  "battery", "signal_strength", "timestamp", "duration", "voltage", "current", "frequency",
  "data_rate", "data_size", "update", "connectivity", "problem", "running", "tamper",
]);

const TECHNICAL_UNITS = new Set(["dBm", "dB", "lqi", "s", "ms", "min", "h", "d", "B", "kB", "MB", "GB", "bit/s", "kbit/s", "Mbit/s", "MiB", "GiB"]);

// Whole words, accents included (\b does not see "é" as a letter).
const TECHNICAL_NAME =
  /(?<![\p{L}\p{N}])(batterie|battery|signal|rssi|lqi|link ?quality|qualité (de (la )?)?liaison|firmware|micrologiciel|uptime|temps de fonctionnement|adresse ip|ip address|wi-?fi|ssid|voyant|indicateur|indicator|led d'état|status led|verrouillage enfant|child lock|mise à jour|update|redémarr|restart|reboot|identif|last seen|dernière (vue|activité|mise)|connectivité|connectivity|calibration|étalonnage|sensibilité|sensitivity|power on behavio|comportement à la mise sous tension|cpu|mémoire|memory|disque|disk|load|charge système|processor|processeur)(?![\p{L}\p{N}])/iu;

/** Entities the registry marks as setup knobs or diagnostics, or hidden: read once per dataset. */
export type RegistryReader = () => Promise<Set<string>>;

export function registryReader(haUrl: string, token: string): RegistryReader {
  return async () => {
    const entries = await wsCommand<{ entity_id: string; entity_category?: string | null; hidden_by?: string | null }[]>(
      haUrl, token, { type: "config/entity_registry/list" }, 30000
    );
    return new Set(entries.filter((e) => e.entity_category || e.hidden_by).map((e) => e.entity_id));
  };
}

/** Something nobody asks for out loud: a battery, a signal, a firmware, an indicator light. */
export function isTechnical(entity: EntityState): boolean {
  const name = typeof entity.attributes.friendly_name === "string" ? entity.attributes.friendly_name : "";
  const deviceClass = entity.attributes.device_class;
  const unit = entity.attributes.unit_of_measurement;
  if (typeof deviceClass === "string" && TECHNICAL_CLASSES.has(deviceClass)) return true;
  if (typeof unit === "string" && TECHNICAL_UNITS.has(unit)) return true;
  return TECHNICAL_NAME.test(name) || TECHNICAL_NAME.test(entity.entity_id.replace(/[._]/g, " "));
}

export async function readHouse(
  ha: HomeAssistantClient,
  topology: TopologyScanner,
  scanner: DeviceScanner,
  registry?: RegistryReader
): Promise<{ house: HouseInventory; scripts: ScriptInfo[]; skipped: number }> {
  await Promise.all([topology.refreshIfStale(), scanner.refreshIfStale()]);
  const [entities, scripts, hidden] = await Promise.all([
    ha.getEntities(),
    ha.listScripts().catch(() => [] as ScriptInfo[]),
    // Without the registry (old Home Assistant, no websocket), the name rules still apply.
    registry ? registry().catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ]);
  const areaOf = new Map<string, string>();
  for (const room of topology.getRooms()) for (const e of room.entities) areaOf.set(e.id, room.name);
  const profiles = new Map(scanner.getProfiles().map((p) => [p.entityId, p]));

  const devices: HouseDevice[] = [];
  let skipped = 0;
  for (const e of entities) {
    const domain = e.entity_id.slice(0, e.entity_id.indexOf("."));
    if (!DOMAINS.has(domain)) continue;
    const name = typeof e.attributes.friendly_name === "string" ? e.attributes.friendly_name.trim() : "";
    if (!name) continue;
    if (hidden.has(e.entity_id) || isTechnical(e)) {
      skipped++;
      continue;
    }
    const device: HouseDevice = { id: e.entity_id, name, area: areaOf.get(e.entity_id) };
    if (typeof e.attributes.device_class === "string") device.deviceClass = e.attributes.device_class;
    if (typeof e.attributes.unit_of_measurement === "string") device.unit = e.attributes.unit_of_measurement;
    const members = e.attributes.entity_id;
    if (GROUPABLE.has(domain) && Array.isArray(members) && members.length > 1) {
      device.members = members.filter((m): m is string => typeof m === "string");
    }
    const p = profiles.get(e.entity_id);
    if (p) device.light = { brightness: p.hasBrightness, white: p.whiteMethod.type, color: p.colorMethod.type !== "none" };
    devices.push(device);
  }
  // A group helper often has no room: it takes its members' room when they share one.
  for (const d of devices) {
    if (d.area || !d.members) continue;
    const rooms = new Set(d.members.map((m) => areaOf.get(m)).filter(Boolean));
    if (rooms.size === 1) d.area = [...rooms][0];
  }
  return {
    house: {
      devices,
      scripts: scripts
        .filter((s) => !s.returns && !s.fields.some((f) => f.required))
        .map((s) => ({ id: s.id, name: s.name || s.id.replace(/^script\./, "").replace(/_/g, " ") })),
    },
    scripts,
    skipped,
  };
}
