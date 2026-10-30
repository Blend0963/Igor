/**
 * How the house's own model and the online one talk to each other.
 *
 * The local model is the house: it knows every entity and acts on any of
 * them. It never speaks. It ends each request with one short line saying
 * whether Igor has something to say and of what kind:
 *
 *   -         nothing (an order carried out)
 *   >dire     announce what was done
 *   >rep      answer from what was read
 *   >web      the answer needs the internet
 *   >libre    general knowledge, conversation
 *   >demande  something is missing or unclear
 *
 * The online model, which plays Igor, then gets a brief in the same terse
 * form (onlineBrief): the tag, what was done and read as entity=state, and
 * the person's exact words. Both prompts are here, and the dataset
 * generator (train/local-dataset.ts) builds its examples from them.
 */

import type OpenAI from "openai";

export const LOCAL_TAGS = ["dire", "rep", "web", "libre", "demande"] as const;
export type LocalTag = "silence" | (typeof LOCAL_TAGS)[number] | "echec";

/** The local model's whole standing prompt: technical, the strict minimum. */
export const LOCAL_PROTOCOL = `Module domotique d'Igor. Tu ne parles jamais à la personne : tu agis avec les outils, puis tu écris une ligne pour la voix d'Igor (un autre modèle).
SORTIE : appels d'outils éventuels + une ligne :
- = rien à dire (ordre exécuté)
>dire = annoncer ce qui a été fait (confirmation demandée, rappel, alerte)
>rep = répondre avec ce que tu as lu (état, valeur, contact, rappels, souvenir)
>web = actualité, résultat, prix, info récente
>libre = culture générale, discussion, conseil, heure, date
>demande = demande floue, incomplète ou inaudible
RÈGLES :
- Toutes les entités sont pilotables et lisibles. Inconnue : search_entities, puis agis ou >rep.
- Valeur demandée : get_state puis >rep. Prévisions : weather.get_forecasts.
- Numéro : find_contact puis >rep. Souvenir utile à la réponse : share_memory (copie exacte) puis >rep.
- Suite (« vas-y », « oui », « et la cuisine ? ») : d'après l'échange précédent.
- Micro ouvert : agis seulement sur ce qui t'est adressé. Transcription imparfaite : comprends l'intention.`;

/** Said last, right before the words, where a small model heeds it best. */
export const LOCAL_REMINDER = "Sortie : outils + une ligne (-, >dire, >rep, >web, >libre, >demande). Jamais de phrase pour la personne.";

/** Today, as the local model reads it: no time, so the prompt changes once a day. */
export function localDate(date: Date): string {
  return date.toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/**
 * The local model's system messages: the standing part (protocol, the
 * owner's rules, the room map and light sheet unless the model was trained
 * on the house, the scripts) and the part that changes (date, memories,
 * reminder), which goes after the history.
 */
export function buildLocalPrompt(p: {
  rules?: string;
  layout?: string;
  cheatSheet?: string;
  facts: string[];
  withMemory: boolean;
  date: string;
}): { stable: string; volatile: string } {
  const stable = [
    LOCAL_PROTOCOL,
    p.rules?.trim() ? `RÈGLES DU PROPRIÉTAIRE :\n${p.rules.trim()}` : "",
    p.layout ?? "",
    p.cheatSheet ?? "",
  ].filter(Boolean).join("\n\n");
  const memory = !p.withMemory ? "" : p.facts.length ? `\nmémoire :\n${p.facts.map((f) => `- ${f}`).join("\n")}` : "\nmémoire : aucune";
  return { stable, volatile: `date : ${p.date}${memory}\n\n${LOCAL_REMINDER}` };
}

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): OpenAI.ChatCompletionTool {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

/** The local model's tools, described in as few words as each needs. */
export const LOCAL_TOOL_DEFS: OpenAI.ChatCompletionTool[] = [
  fn("call_service", "Agir : service Home Assistant. Script avec champs : domain script, service = son nom, data = champs, sans entity_id.", {
    domain: { type: "string" },
    service: { type: "string" },
    entity_id: { type: "string", description: "Une ou plusieurs entités, séparées par des virgules." },
    data: { type: "object", description: "brightness_pct, rgb_color, color_temp_kelvin, rgbw_color, position, temperature, volume_level…" },
  }, ["domain", "service"]),
  fn("get_state", "Lire l'état d'une entité.", { entity_id: { type: "string" } }, ["entity_id"]),
  fn("search_entities", "Chercher des entités par nom ou identifiant.", { query: { type: "string" } }, ["query"]),
  fn("find_contact", "Chercher un contact du téléphone et ses numéros.", { query: { type: "string", description: "Le nom entendu, ou un numéro." } }, ["query"]),
  fn("schedule_task", "Programmer un rappel. Ne calcule pas la date : in_minutes, in_hours, in_days (+ time), ou time seul.", {
    kind: { type: "string", enum: ["reminder", "task"] },
    text: { type: "string" },
    in_minutes: { type: "number" },
    in_hours: { type: "number" },
    in_days: { type: "number" },
    time: { type: "string", description: "HH:MM" },
    when: { type: "string", description: "Date nommée : YYYY-MM-DDTHH:MM" },
    repeat: { type: "string", enum: ["none", "daily", "weekly"] },
    days: { type: "array", items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] } },
  }, ["kind", "text"]),
  fn("notify_when", "Prévenir une fois quand une entité atteint un état.", {
    entity_id: { type: "string" },
    condition: { type: "string", enum: ["equals", "not_equals", "below", "above"] },
    value: { type: "string" },
    for_minutes: { type: "number" },
    text: { type: "string" },
  }, ["entity_id", "condition", "value", "text"]),
  fn("list_scheduled_tasks", "Lister les rappels programmés.", {}),
  fn("cancel_scheduled_task", "Annuler un rappel par son id.", { id: { type: "string" } }, ["id"]),
];

export const SHARE_MEMORY_DEF: OpenAI.ChatCompletionTool = fn(
  "share_memory",
  "Transmettre à la voix d'Igor les souvenirs dont sa réponse a besoin, copiés de « mémoire ».",
  { facts: { type: "array", items: { type: "string" } } },
  ["facts"]
);

/** The tag of the local model's line, if it wrote one. */
export function readLocalTag(text: string): { tag: LocalTag; note?: string } | undefined {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "-" || t === "—") return { tag: "silence" };
    const m = /^>\s*([a-zé]+)\s*(.*)$/i.exec(t);
    if (m) {
      const tag = m[1].toLowerCase();
      if ((LOCAL_TAGS as readonly string[]).includes(tag)) return { tag: tag as LocalTag, note: m[2].trim() || undefined };
    }
  }
  return undefined;
}

/** A tool call of the turn and what it returned. */
export interface BriefCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

const MAX_PART = 600;

function clip(text: string, max = MAX_PART): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** "sensor.batterie=64 %", from a state as Home Assistant or compactState gives it. */
function stateLine(s: unknown): string | undefined {
  if (!s || typeof s !== "object") return undefined;
  const o = s as { entity_id?: unknown; state?: unknown; name?: unknown; attributes?: Record<string, unknown> };
  if (typeof o.entity_id !== "string") return undefined;
  const unit = o.attributes?.unit_of_measurement;
  const name = typeof o.name === "string" ? o.name : typeof o.attributes?.friendly_name === "string" ? o.attributes.friendly_name : undefined;
  return `${o.entity_id}${name ? ` (${name})` : ""}=${String(o.state)}${typeof unit === "string" ? ` ${unit}` : ""}`;
}

function errorOf(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const e = (result as { error?: unknown }).error;
  return e ? clip(String(e), 200) : undefined;
}

/** Whether a call failed or waits for a confirmation: the person must hear it. */
export function needsWord(calls: BriefCall[]): "echec" | "demande" | undefined {
  if (calls.some((c) => errorOf(c.result))) return "echec";
  if (calls.some((c) => c.result && typeof c.result === "object" && (c.result as { confirmation_required?: unknown }).confirmation_required)) return "demande";
  return undefined;
}

/** What the online model reads for one request: the tag, what was done and read, the words. */
export function onlineBrief(tag: LocalTag, note: string | undefined, calls: BriefCall[], words: string): string {
  const done: string[] = [];
  const read: string[] = [];
  const failed: string[] = [];
  const other: string[] = [];
  for (const c of calls) {
    const error = errorOf(c.result);
    const r = c.result as Record<string, unknown> | unknown[] | undefined;
    if (error) {
      failed.push(`${c.name} ${clip(JSON.stringify(c.input), 160)} : ${error}`);
      continue;
    }
    switch (c.name) {
      case "call_service": {
        const states = Array.isArray(r) ? r : Array.isArray((r as { changed_states?: unknown })?.changed_states) ? (r as { changed_states: unknown[] }).changed_states : [];
        const lines = states.map(stateLine).filter(Boolean) as string[];
        done.push(lines.length ? lines.join(", ") : `${c.input.domain}.${c.input.service}${c.input.entity_id ? ` ${c.input.entity_id}` : ""}`);
        const response = (r as { service_response?: unknown })?.service_response;
        if (response !== undefined && response !== null) read.push(`${c.input.domain}.${c.input.service} → ${clip(JSON.stringify(response))}`);
        if ((r as { confirmation_required?: unknown })?.confirmation_required) other.push(`confirmation : ${clip(JSON.stringify(r), 300)}`);
        break;
      }
      case "get_state":
        read.push(stateLine(r) ?? clip(JSON.stringify(r)));
        break;
      case "search_entities": {
        const list = Array.isArray(r) ? r : Array.isArray((r as { entities?: unknown })?.entities) ? (r as { entities: unknown[] }).entities : [];
        read.push(list.length ? clip(list.map(stateLine).filter(Boolean).join(", ")) : `rien pour « ${String(c.input.query ?? "")} »`);
        break;
      }
      case "share_memory": {
        const shared = (r as { shared?: string[] } | undefined)?.shared ?? [];
        other.push(`souvenirs : ${shared.length ? shared.join(" ; ") : "aucun"}`);
        break;
      }
      case "schedule_task":
        other.push(`rappel : ${clip(JSON.stringify(r), 300)}`);
        break;
      case "notify_when":
        other.push(`alerte : ${clip(JSON.stringify(r), 300)}`);
        break;
      case "find_contact":
        other.push(`contact : ${clip(JSON.stringify(r))}`);
        break;
      case "list_scheduled_tasks":
        other.push(`rappels : ${clip(JSON.stringify(r))}`);
        break;
      default:
        other.push(`${c.name} : ${clip(JSON.stringify(r))}`);
    }
  }
  return [
    `>${tag}${note ? ` ${note}` : ""}`,
    done.length ? `fait : ${done.join(" ; ")}` : "",
    read.length ? `lu : ${read.join(" ; ")}` : "",
    failed.length ? `échec : ${failed.join(" ; ")}` : "",
    ...other,
    `dit : « ${words} »`,
  ].filter(Boolean).join("\n");
}

/** The online model's instructions when it speaks for the local one. */
export const ONLINE_BRIEF_INSTRUCTIONS =
  "Tu es la voix d'Igor. Le module domotique local, dans la maison, a déjà fait et lu ce qu'il fallait ; " +
  "il t'écrit en format court, juste avant les mots de la personne :\n" +
  ">balise : ce qu'il attend de toi. dire = annonce simplement ce qui a été fait ; rep = réponds avec ce qui a été lu ; " +
  "web = cherche avec web_search (en tenant compte de la date du jour) puis réponds ; libre = réponds avec tes connaissances ; " +
  "demande = demande la précision ou la confirmation qui manque (pour un appel : « Jean Martin, sur son mobile au 06 …, je l'appelle ? » ; " +
  "pour un SMS : « J'envoie à Jean Martin, au 06 … : « texte court et naturel » ? », d'après le contact trouvé ; plusieurs contacts : demande lequel) ; " +
  "echec = dis simplement ce qui n'a pas marché.\n" +
  "fait : entité=nouvel état. lu : entité (nom)=valeur. échec : appel et erreur. rappel, alerte, contact, rappels, souvenirs : " +
  "ce qu'il a programmé ou trouvé. dit : les mots exacts de la personne.\n" +
  "Tu ne peux rien faire dans la maison : pour elle, tu te fondes uniquement sur ces lignes et tu n'inventes rien. " +
  "Dis les choses en mots (light.salon=on : la lumière du salon est allumée), jamais un identifiant ni une balise à voix haute. " +
  "Si rien n'a été trouvé, dis-le. Pour l'actualité, un résultat sportif, un prix, une élection ou tout ce qui change avec le temps, " +
  "cherche toujours avec web_search, quelle que soit la balise : ta mémoire peut être dépassée. Si la personne demande de chercher " +
  "ou de vérifier, cherche à nouveau.";
