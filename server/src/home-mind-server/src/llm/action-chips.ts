import type { EntityState } from "../ha/client.js";

/**
 * What a turn really did in the house, shown in the panel as small chips
 * above the answer ("Salon · éteint", "Rappel · samedi 18 octobre 07:00").
 *
 * They are built from the tool calls that succeeded, never from the model's
 * words: a reply that says "c'est éteint" without acting shows no chip.
 */
export interface ActionChip {
  /** on: something is now on/open; off: off/closed/locked; set: anything else; reminder; automation. */
  kind: "on" | "off" | "set" | "reminder" | "automation";
  label: string;
}

/** Most chips one turn shows; a scene turning off thirty lights stays readable. */
export const MAX_CHIPS = 12;

const STATE_WORDS: Record<string, [string, ActionChip["kind"]]> = {
  on: ["allumé", "on"],
  off: ["éteint", "off"],
  open: ["ouvert", "on"],
  opening: ["s'ouvre", "on"],
  closed: ["fermé", "off"],
  closing: ["se ferme", "off"],
  locked: ["verrouillé", "off"],
  unlocked: ["déverrouillé", "on"],
  playing: ["en lecture", "on"],
  paused: ["en pause", "off"],
  idle: ["à l'arrêt", "off"],
  cleaning: ["nettoie", "on"],
  docked: ["à sa base", "off"],
  returning: ["rentre", "set"],
  heat: ["chauffe", "on"],
  cool: ["refroidit", "on"],
  auto: ["auto", "set"],
};

function nameOf(state: EntityState): string {
  const name = state.attributes?.friendly_name;
  return typeof name === "string" && name.trim() ? name.trim() : state.entity_id;
}

function stateChip(state: EntityState): ActionChip {
  const known = STATE_WORDS[state.state];
  if (known) return { kind: known[1], label: `${nameOf(state)} · ${known[0]}` };
  const unit = state.attributes?.unit_of_measurement;
  const value = typeof unit === "string" && unit ? `${state.state} ${unit}` : state.state;
  return { kind: "set", label: `${nameOf(state)} · ${value}` };
}

function targets(entityId: unknown, data: unknown): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") v.split(",").forEach((s) => s.trim() && out.push(s.trim()));
    else if (Array.isArray(v)) v.forEach(add);
  };
  add(entityId);
  if (data && typeof data === "object") add((data as Record<string, unknown>).entity_id);
  return out;
}

/**
 * Chips for a successful call_service. Home Assistant answers with the states
 * the call changed; the ones the call aimed at are shown first. When it
 * reports nothing (a script, a state that changes a moment later), the call
 * itself is shown.
 */
export function chipsFromServiceCall(input: Record<string, unknown>, result: unknown): ActionChip[] {
  const states = Array.isArray(result)
    ? (result as EntityState[])
    : result && typeof result === "object" && Array.isArray((result as { changed_states?: unknown }).changed_states)
      ? ((result as { changed_states: EntityState[] }).changed_states)
      : [];
  const aimed = targets(input.entity_id, input.data);
  const valid = states.filter((s) => s && typeof s.entity_id === "string" && typeof s.state === "string");
  const relevant = aimed.length && !aimed.includes("all")
    ? valid.filter((s) => aimed.includes(s.entity_id))
    : valid.filter((s) => s.entity_id.startsWith(`${String(input.domain)}.`));
  if (relevant.length) return relevant.slice(0, MAX_CHIPS).map(stateChip);
  const what = aimed.length ? aimed.join(", ") : String(input.domain ?? "");
  return [{ kind: "set", label: `${what} · ${String(input.service ?? "").replace(/_/g, " ")}` }];
}

/** Chips for the other tools that change something, from their result. */
export function chipsFromTool(toolName: string, input: Record<string, unknown>, result: unknown): ActionChip[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  if (r.error || r.success !== true) return [];
  switch (toolName) {
    case "schedule_task": {
      const when = typeof r.when === "string" ? r.when : typeof r.next_run === "string" ? r.next_run : "";
      const label = r.kind === "task" ? "Tâche" : "Rappel";
      return [{ kind: "reminder", label: when ? `${label} · ${when}` : label }];
    }
    case "notify_when":
      return [{ kind: "reminder", label: `Alerte · ${typeof r.watching === "string" ? r.watching : String(input.entity_id ?? "")}` }];
    case "create_automation":
    case "update_automation":
    case "delete_automation": {
      if (r.confirmation_required || r.preview) return [];
      const verb = toolName === "create_automation" ? "créée" : toolName === "update_automation" ? "modifiée" : "supprimée";
      const name = typeof input.alias === "string" ? input.alias : typeof input.entity_id === "string" ? input.entity_id : "";
      return [{ kind: "automation", label: name ? `${name} · ${verb}` : `Automatisation ${verb}` }];
    }
    default:
      return [];
  }
}

/** Adds chips to the turn's list, without duplicates and within MAX_CHIPS. */
export function addChips(list: ActionChip[], chips: ActionChip[]): void {
  for (const chip of chips) {
    if (list.length >= MAX_CHIPS) return;
    const same = list.findIndex((c) => c.label.split(" · ")[0] === chip.label.split(" · ")[0] && c.kind !== "reminder");
    if (same >= 0 && chip.kind !== "reminder") list[same] = chip;
    else list.push(chip);
  }
}
