/**
 * The house as the dataset generator (train/local-dataset.ts) reads it:
 * the entities exposed to Assist, their rooms, the lights' capabilities and
 * the scripts that need no field. Read through the same exposure-bounded
 * client as the tools, so the model learns only what it may touch.
 *
 * Exposing everything is fine. What is about a device rather than the house
 * (what the entity registry marks as diagnostic or configuration, or hides,
 * and what reads like it: batteries, signal, firmware, CPU load, indicator
 * lights...) is kept but marked technical: the model learns to read it when
 * asked, never to act on it, and it never takes the room's words from a
 * real device. Groups keep their members, which only lose the room's words
 * ("la lumière du salon" is the group).
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
  /(?<![\p{L}\p{N}])(batterie|battery|signal|rssi|lqi|link ?quality|qualité (de (la )?)?liaison|firmware|micrologiciel|uptime|temps de fonctionnement|adresse ip|ip address|wi-?fi|ssid|voyant|indicateur|indicator|led d'état|status led|verrouillage enfant|child lock|mise à jour|update|redémarr|restart|reboot|identif|last seen|dernière (vue|activité|mise)|connectivité|connectivity|calibration|étalonnage|sensibilité|sensitivity|power on behavio|comportement à la mise sous tension|cpu|mémoire|memory|disque|disk|load|charge système|processor|processeur|material you|browser_mod|thème|theme)(?![\p{L}\p{N}])/iu;

/**
 * A name nobody can say: it carries a machine id ("browser_mod_c8a993dd",
 * "navbar 6926f9e4e63f…"), a run of 8+ hex characters mixing letters and
 * digits. Such entities (per-browser helpers, generated ones) are left out.
 */
export function isUnspeakable(entityId: string, name: string): boolean {
  return [entityId, name].some((t) => (t.match(/[0-9a-f]{8,}/gi) ?? []).some((run) => /\d/.test(run) && /[a-f]/i.test(run)));
}

/**
 * What the entity registry says, read once per dataset: the entities marked
 * as setup knobs or diagnostics, or hidden; and the aliases the owner gave
 * for Assist (Settings → Voice assistants → Expose → the entity → Aliases),
 * the words they really use ("aspirateur", "robot").
 */
export interface RegistryInfo {
  hidden: Set<string>;
  aliases: Map<string, string[]>;
}

export type RegistryReader = () => Promise<RegistryInfo>;

export function registryReader(haUrl: string, token: string): RegistryReader {
  return async () => {
    const entries = await wsCommand<{ entity_id: string; entity_category?: string | null; hidden_by?: string | null; aliases?: unknown }[]>(
      haUrl, token, { type: "config/entity_registry/list" }, 30000
    );
    const aliases = new Map<string, string[]>();
    for (const e of entries) {
      const list = Array.isArray(e.aliases) ? e.aliases.filter((a): a is string => typeof a === "string" && a.trim() !== "") : [];
      if (list.length) aliases.set(e.entity_id, list.map((a) => a.trim()));
    }
    return { hidden: new Set(entries.filter((e) => e.entity_category || e.hidden_by).map((e) => e.entity_id)), aliases };
  };
}

/** About the device rather than the house: a battery, a signal, a firmware, the CPU load, an indicator light. */
export function isTechnical(entity: EntityState): boolean {
  const name = typeof entity.attributes.friendly_name === "string" ? entity.attributes.friendly_name : "";
  const deviceClass = entity.attributes.device_class;
  const unit = entity.attributes.unit_of_measurement;
  if (typeof deviceClass === "string" && TECHNICAL_CLASSES.has(deviceClass)) return true;
  if (typeof unit === "string" && TECHNICAL_UNITS.has(unit)) return true;
  // A name no one would say whole: "Météo-France forecast for city Paris (75) freeze chance", "Disk pve: Samsung SSD…".
  // …or carries an account or serial number ("BNP Paribas FR7630004…").
  if (name.length > 45 || /[():]/.test(name) || /\d{10,}/.test(name)) return true;
  return TECHNICAL_NAME.test(name) || TECHNICAL_NAME.test(entity.entity_id.replace(/[._]/g, " "));
}

export async function readHouse(
  ha: HomeAssistantClient,
  topology: TopologyScanner,
  scanner: DeviceScanner,
  registry?: RegistryReader,
  /** Times each entity was switched by a person lately (logbook, voice). */
  usage?: Map<string, number>
): Promise<{ house: HouseInventory; scripts: ScriptInfo[]; technical: number; unspeakable: number }> {
  await Promise.all([topology.refreshIfStale(), scanner.refreshIfStale()]);
  const [entities, scripts, { hidden, aliases }] = await Promise.all([
    ha.getEntities(),
    ha.listScripts().catch(() => [] as ScriptInfo[]),
    // Without the registry (old Home Assistant, no websocket), the name rules still apply.
    registry
      ? registry().catch(() => ({ hidden: new Set<string>(), aliases: new Map<string, string[]>() }))
      : Promise.resolve({ hidden: new Set<string>(), aliases: new Map<string, string[]>() }),
  ]);
  const areaOf = new Map<string, string>();
  for (const room of topology.getRooms()) for (const e of room.entities) areaOf.set(e.id, room.name);
  const profiles = new Map(scanner.getProfiles().map((p) => [p.entityId, p]));

  const devices: HouseDevice[] = [];
  let technical = 0;
  let unspeakable = 0;
  for (const e of entities) {
    const domain = e.entity_id.slice(0, e.entity_id.indexOf("."));
    if (!DOMAINS.has(domain)) continue;
    const name = typeof e.attributes.friendly_name === "string" ? e.attributes.friendly_name.trim() : "";
    if (!name) continue;
    if (isUnspeakable(e.entity_id, name)) {
      unspeakable++;
      continue;
    }
    const device: HouseDevice = { id: e.entity_id, name, area: areaOf.get(e.entity_id) };
    const said = aliases.get(e.entity_id);
    if (said?.length) device.aliases = said;
    const used = usage?.get(e.entity_id);
    if (used) device.usage = used;
    if (hidden.has(e.entity_id) || isTechnical(e)) {
      device.technical = true;
      technical++;
    }
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
    technical,
    unspeakable,
  };
}
