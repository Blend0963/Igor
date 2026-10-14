/**
 * Entity states as the model reads them: what it needs to answer and act,
 * without what Home Assistant attaches for its own UI.
 *
 * A tool result is re-sent on every later model call of the tool loop, and an
 * unfiltered state is mostly noise for the model: icons, picture URLs, a
 * media player's whole source list, a light's 80 WLED effects, the same colour
 * in three colour spaces. search_entities and get_entities used to return
 * every matching state with all of it, with no ceiling on how many.
 */

import type { EntityState } from "../ha/client.js";

/** Attributes no answer or service call of ours ever needs. */
const DROPPED_ATTRIBUTES = new Set([
  "icon",
  "entity_picture",
  "attribution",
  "supported_features",
  "effect_list",
  "source_list",
  "sound_mode_list",
  "xy_color",
  "hs_color",
  "min_mireds",
  "max_mireds",
  "color_temp",
  "editable",
  "restored",
]);

/** Longer arrays are cut to this many items, with the total kept. */
const MAX_ARRAY_ITEMS = 12;
/** Longer strings are cut to this many characters. */
const MAX_STRING_CHARS = 300;

/** Entities in one list result; past this the model is told to narrow it. */
export const MAX_LISTED_ENTITIES = 25;

function compactValue(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_STRING_CHARS) {
    return `${value.slice(0, MAX_STRING_CHARS)}…`;
  }
  if (Array.isArray(value) && value.length > MAX_ARRAY_ITEMS) {
    return [...value.slice(0, MAX_ARRAY_ITEMS), `…(${value.length} in total)`];
  }
  return value;
}

/**
 * One state, trimmed. `withTimes` keeps last_changed / last_updated, which a
 * single-entity read may be asked about ("when did the door open?") but which
 * add nothing to a list.
 */
export function compactState(state: EntityState, withTimes = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (state.entity_id !== undefined) out.entity_id = state.entity_id;
  if (state.state !== undefined) out.state = state.state;
  const attributes = state.attributes ?? {};
  if (typeof attributes.friendly_name === "string") out.name = attributes.friendly_name;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "friendly_name" || DROPPED_ATTRIBUTES.has(key) || value === null) continue;
    kept[key] = compactValue(value);
  }
  if (Object.keys(kept).length) out.attributes = kept;
  if (withTimes) {
    if (state.last_changed !== undefined) out.last_changed = state.last_changed;
    if (state.last_updated !== undefined && state.last_updated !== state.last_changed) {
      out.last_updated = state.last_updated;
    }
  }
  return out;
}

/**
 * A list of states for search_entities / get_entities. Up to the ceiling it
 * stays a plain array; past it the model gets the first ones, the total, and
 * the instruction to narrow the query instead of paging through the house.
 */
export function compactStateList(
  states: EntityState[],
  limit = MAX_LISTED_ENTITIES
): Record<string, unknown>[] | Record<string, unknown> {
  const compact = states.slice(0, limit).map((s) => compactState(s));
  if (states.length <= limit) return compact;
  return {
    total: states.length,
    shown: compact.length,
    entities: compact,
    note:
      `Only the first ${compact.length} of ${states.length} matches are shown. ` +
      `Narrow the query (room, device type, a domain) instead of asking for more.`,
  };
}

/**
 * What call_service hands back: the states the call changed, or those plus a
 * service response. The response itself (a script's output, a weather
 * forecast) is the answer the model asked for and is passed through whole.
 */
export function compactServiceResult(result: unknown): unknown {
  if (Array.isArray(result)) {
    return result.map((s) => (s && typeof s === "object" ? compactState(s as EntityState) : s));
  }
  if (result && typeof result === "object" && Array.isArray((result as { changed_states?: unknown }).changed_states)) {
    const r = result as { changed_states: EntityState[]; service_response?: unknown };
    return { ...r, changed_states: r.changed_states.map((s) => compactState(s)) };
  }
  return result;
}
