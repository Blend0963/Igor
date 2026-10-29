import type { EntityState } from "../ha/client.js";

/**
 * The sentence Igor says after a plain order on the local model, built from
 * what Home Assistant reports it changed: "Lumière salon allumée." It is said
 * at once, with no second model call, and nothing leaves the house.
 *
 * Only orders whose result is fully known qualify: call_service on a device
 * (not a script, whose result may need reading) that reported the new state
 * of every device it aimed at, and a reminder that was scheduled. Anything
 * else returns undefined and the model words the answer as before.
 */

/** A tool call of the turn and what it returned. */
export interface DoneCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

/** State → past participle (masculine) or fixed words, as Igor says them. */
const SAID: Record<string, { word: string; agrees: boolean }> = {
  on: { word: "allumé", agrees: true },
  off: { word: "éteint", agrees: true },
  open: { word: "ouvert", agrees: true },
  opening: { word: "en cours d'ouverture", agrees: false },
  closed: { word: "fermé", agrees: true },
  closing: { word: "en cours de fermeture", agrees: false },
  locked: { word: "verrouillé", agrees: true },
  unlocked: { word: "déverrouillé", agrees: true },
  playing: { word: "en lecture", agrees: false },
  paused: { word: "en pause", agrees: false },
  idle: { word: "à l'arrêt", agrees: false },
  cleaning: { word: "en nettoyage", agrees: false },
  docked: { word: "sur sa base", agrees: false },
  returning: { word: "en retour à sa base", agrees: false },
  heat: { word: "en chauffe", agrees: false },
  cool: { word: "en refroidissement", agrees: false },
};

/** First words of device names that are feminine in French. */
const FEMININE = new Set([
  "lumière", "lumières", "lampe", "lampes", "prise", "prises", "porte", "portes", "fenêtre", "fenêtres",
  "enceinte", "enceintes", "télé", "télévision", "guirlande", "guirlandes", "applique", "appliques",
  "suspension", "suspensions", "veilleuse", "ampoule", "ampoules", "bande", "led", "leds", "cafetière",
  "machine", "box", "clim", "climatisation", "pompe", "chaudière", "serrure", "alarme", "caméra", "hotte",
  "barre", "plaque", "bouilloire", "radio", "console", "imprimante", "vmc", "piscine", "douche", "cuisine",
  "chambre", "entrée", "salle", "cave", "terrasse", "véranda",
  "télécommande", "télécommandes", "batterie", "charge", "température", "humidité", "consommation", "puissance",
  "qualité", "mémoire", "tension", "pression", "luminosité", "valeur", "sonde", "sonnette", "station", "ventilation",
  "alimentation", "sirène", "buanderie", "cuve", "chaleur", "voiture", "fenetre", "baie", "verrière", "pergola", "cour",
]);

/** True when a name's first word is a feminine noun ("Lampe bureau", "Cuisine"). */
export function isFeminine(name: string): boolean {
  return FEMININE.has(firstWord(name));
}

function firstWord(name: string): string {
  return name.trim().split(/[\s'’]+/)[0]?.toLowerCase() ?? "";
}

function agree(word: string, name: string): string {
  const first = firstWord(name);
  const plural = /[sx]$/.test(first) && first.length > 3 && !["box", "prix"].includes(first);
  const feminine = FEMININE.has(first);
  return word + (feminine ? "e" : "") + (plural ? "s" : "");
}

/** The device's name: friendly_name, or `name` once the result was compacted (llm/compact-state.ts). */
function nameOf(state: EntityState): string | undefined {
  const name = state.attributes?.friendly_name ?? (state as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function aimedAt(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") v.split(",").forEach((s) => s.trim() && out.push(s.trim()));
    else if (Array.isArray(v)) v.forEach(add);
  };
  add(input.entity_id);
  const data = input.data;
  if (data && typeof data === "object") add((data as Record<string, unknown>).entity_id);
  return out;
}

/** "Lumière salon allumée", or undefined when this call's outcome is not fully known. */
function serviceSentence(input: Record<string, unknown>, result: unknown): string[] | undefined {
  if (input.domain === "script" || input.domain === "automation" || input.domain === "scene") return undefined;
  const states = result && typeof result === "object" && Array.isArray((result as { changed_states?: unknown }).changed_states)
    ? (result as { changed_states: EntityState[] }).changed_states
    : Array.isArray(result) ? (result as EntityState[]) : undefined;
  const aimed = aimedAt(input);
  if (!states || aimed.length === 0 || aimed.includes("all")) return undefined;
  const parts: string[] = [];
  for (const id of aimed) {
    const state = states.find((s) => s?.entity_id === id);
    const name = state && nameOf(state);
    if (!state || !name) return undefined;
    const said = SAID[state.state];
    const setPoint = state.attributes?.temperature;
    if (input.service === "set_temperature" && typeof setPoint === "number") {
      parts.push(`${name} ${agree("réglé", name)} sur ${String(setPoint).replace(".", ",")} degrés`);
    } else if (said) parts.push(`${name} ${said.agrees ? agree(said.word, name) : said.word}`);
    else return undefined;
  }
  return parts;
}

function joinFrench(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`;
}

/** The sentence for a batch of calls, or undefined when the model should word it. */
export function actionSentence(calls: DoneCall[]): string | undefined {
  if (calls.length === 0) return undefined;
  const parts: string[] = [];
  for (const call of calls) {
    const r = call.result as Record<string, unknown> | undefined;
    if (r && typeof r === "object" && (r.error || r.confirmation_required)) return undefined;
    if (call.name === "call_service") {
      const said = serviceSentence(call.input, call.result);
      if (!said) return undefined;
      parts.push(...said);
    } else if (call.name === "schedule_task" && r?.success === true && typeof r.when === "string" && call.input.kind !== "task") {
      parts.push(`rappel programmé pour ${r.when}`);
    } else {
      return undefined;
    }
  }
  const text = joinFrench(parts);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * True when the local model must read a batch's results to act again: a
 * search for a device (the order comes next), or a script that returned
 * something (the calendar's date conversion before the event). Anything
 * else is handed straight to the online model, which answers.
 */
export function needsLocalFollowUp(calls: DoneCall[]): boolean {
  return calls.some((call) => {
    if (call.name === "search_entities" || call.name === "get_entities") return true;
    if (call.name !== "call_service" || call.input.domain !== "script") return false;
    const r = call.result as { error?: unknown; service_response?: unknown } | undefined;
    if (!r || typeof r !== "object" || r.error) return false;
    const response = r.service_response;
    return response !== undefined && response !== null && !(typeof response === "object" && Object.keys(response).length === 0);
  });
}
