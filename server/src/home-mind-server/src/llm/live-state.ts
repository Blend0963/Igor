import type { EntityState } from "../ha/client.js";

/**
 * What is on, open or running in the house right now, read from Home
 * Assistant before every turn and handed to the model next to the message.
 *
 * Without it the model only knew the house through its own past replies, and
 * a reply that wrongly said "la lumière est éteinte" was believed on the next
 * turn: "elles sont déjà éteintes". With the live list in front of it, the
 * model cannot take a lit lamp for an unlit one, whatever the wording of the
 * request.
 */

/** Domains listed, with the states that count as "active" for each. */
const ACTIVE: Record<string, (state: string) => boolean> = {
  light: (s) => s === "on",
  switch: (s) => s === "on",
  fan: (s) => s === "on",
  cover: (s) => s === "open" || s === "opening" || s === "closing",
  lock: (s) => s === "unlocked" || s === "open" || s === "opening" || s === "unlocking",
  media_player: (s) => s === "on" || s === "playing" || s === "paused" || s === "buffering",
  climate: (s) => s !== "off",
  vacuum: (s) => s === "cleaning" || s === "returning",
};

/** Most entries written out; the rest are counted. */
export const LIVE_STATE_MAX = 60;

export function formatLiveState(states: EntityState[], max = LIVE_STATE_MAX): string | undefined {
  const known = states.filter((s) => {
    const domain = s.entity_id.split(".")[0];
    return domain in ACTIVE && s.state !== "unavailable" && s.state !== "unknown";
  });
  if (known.length === 0) return undefined;
  const active = known.filter((s) => ACTIVE[s.entity_id.split(".")[0]](s.state));
  const lines = active.slice(0, max).map((s) => {
    const name = typeof s.attributes?.friendly_name === "string" ? s.attributes.friendly_name : s.entity_id;
    const extra = s.entity_id.startsWith("cover.") || s.entity_id.startsWith("lock.") || s.entity_id.startsWith("media_player.") || s.entity_id.startsWith("climate.") || s.entity_id.startsWith("vacuum.")
      ? ` (${s.state})`
      : "";
    return `- ${name} — ${s.entity_id}${extra}`;
  });
  if (active.length > max) lines.push(`- … and ${active.length - max} more`);
  return (
    "## Live state of the home (read from Home Assistant just now)\n" +
    "This is the REAL current state, newer than anything in the conversation or your memories. " +
    (active.length === 0
      ? "Nothing is on, open or running right now among lights, switches, fans, covers, locks, media players, climate and vacuums.\n"
      : "On, open or running right now:\n" + lines.join("\n") + "\n" +
        "Every other light, switch, fan, cover, lock, media player, climate and vacuum you can see is off, closed or locked.\n") +
    "Use it to answer and to know what needs doing, but it changes nothing: to change a device you MUST call a tool, and only say it is done once the call succeeded. " +
    "An order is still carried out with a tool call when the list already shows that state (the list may lag a few seconds, or the device may be named differently): never answer an order with \"it is already done\" alone."
  );
}
