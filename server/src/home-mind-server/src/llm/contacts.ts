/**
 * find_contact: the person's phone contacts, searched by the server.
 *
 * The contacts come from a Home Assistant script that returns them (the
 * user's own, fed by Nextcloud or the phone). Handing the model the whole list
 * and asking it to read it did not hold: on "appelle Jean Martin" it searched
 * the house's entities instead, or skipped a line of 67, and answered that the
 * contact did not exist. The server reads the list and hands back only the
 * contacts that match, with their numbers.
 *
 * The script is CONTACTS_SCRIPT (add-on option contacts_script), else the
 * first exposed script with "contact" in its id that returns a result.
 */

import type { HomeAssistantClient, ServiceCallWithResponse } from "../ha/client.js";

export interface Contact {
  name: string;
  /** Label ("mobile", "travail"…) → number, as the script gives them. */
  numbers: Record<string, string>;
}

/** How long a read list is reused: contacts change rarely, a call needs it twice. */
const CACHE_MS = 5 * 60 * 1000;
/** Most contacts handed back for one query; past that the model asks for more of the name. */
const MAX_MATCHES = 8;

let cache: { script: string; at: number; contacts: Contact[] } | undefined;

/** Forget the cached list (tests). */
export function resetContactsCache(): void {
  cache = undefined;
}

/** Accents, case, punctuation and hyphens off: "Anne-Sophie Lefèvre" → "anne sophie lefevre". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A French number in one shape: "+33 6 12 34 56 78" and "06-12-34-56-78" → "0612345678". */
export function phoneKey(number: string): string {
  const digits = number.replace(/[^\d+]/g, "");
  if (digits.startsWith("+33")) return `0${digits.slice(3)}`;
  if (digits.startsWith("0033")) return `0${digits.slice(4)}`;
  return digits.replace(/\+/g, "");
}

function looksLikePhone(value: unknown): value is string {
  return typeof value === "string" && value.replace(/\D/g, "").length >= 6 && /^[\d\s+().-]+$/.test(value.trim());
}

const NAME_KEY = /^(nom|name|fullname|full_name|displayname|display_name|contact)$/i;

/** One contact from one object of the list, or undefined when it has no name. */
function contactOf(item: Record<string, unknown>): Contact | undefined {
  let name = "";
  const numbers: Record<string, string> = {};
  for (const [key, value] of Object.entries(item)) {
    if (looksLikePhone(value)) numbers[key] = value.trim();
    else if (Array.isArray(value)) {
      value.filter(looksLikePhone).forEach((v, i) => (numbers[i ? `${key} ${i + 1}` : key] = v.trim()));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (looksLikePhone(v)) numbers[k] = v.trim();
        else if (Array.isArray(v)) v.filter(looksLikePhone).forEach((n, i) => (numbers[i ? `${k} ${i + 1}` : k] = n.trim()));
      }
    } else if (typeof value === "string" && value.trim() && (NAME_KEY.test(key) || !name)) {
      if (NAME_KEY.test(key) || !name) name = value.trim();
    }
  }
  return name ? { name, numbers } : undefined;
}

/** A string the script rendered instead of a structure: JSON, or a Python-style dict. */
function parseLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(text.replace(/'/g, '"'));
    } catch {
      return undefined;
    }
  }
}

/** Every contact in a script's response, whatever its nesting. */
export function contactsFrom(response: unknown): Contact[] {
  if (typeof response === "string") return contactsFrom(parseLoose(response));
  if (Array.isArray(response)) {
    const objects = response.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x));
    const direct = objects.map(contactOf).filter((c): c is Contact => Boolean(c));
    if (direct.length) return direct;
    return response.flatMap((x) => contactsFrom(x));
  }
  if (response && typeof response === "object") {
    return Object.values(response as Record<string, unknown>).flatMap((v) => (typeof v === "string" && !v.trim().startsWith("{") && !v.trim().startsWith("[") ? [] : contactsFrom(v)));
  }
  return [];
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/** How well one heard word matches one word of a name: 0 = exactly, higher = looser, Infinity = no. */
function wordMatch(heard: string, word: string): number {
  if (heard === word) return 0;
  if (heard.length >= 3 && word.startsWith(heard)) return 1;
  const allowed = heard.length >= 7 ? 2 : heard.length >= 4 ? 1 : 0;
  const d = distance(heard, word);
  return d <= allowed ? 1 + d : Infinity;
}

/**
 * The contacts a query names, best first: every word heard must match a word
 * of the name (any order, small spelling slips allowed), or the query is a
 * number and matches one of theirs.
 */
export function matchContacts(contacts: Contact[], query: string): Contact[] {
  const digits = query.replace(/\D/g, "");
  if (digits.length >= 6 && !/\p{L}/u.test(query)) {
    const key = phoneKey(query);
    return contacts.filter((c) => Object.values(c.numbers).some((n) => phoneKey(n) === key));
  }
  const heard = fold(query).split(" ").filter(Boolean);
  if (!heard.length) return [];
  const scored: { contact: Contact; score: number }[] = [];
  for (const contact of contacts) {
    const words = fold(contact.name).split(" ").filter(Boolean);
    let score = 0;
    for (const h of heard) {
      const best = Math.min(...words.map((w) => wordMatch(h, w)), Infinity);
      if (best === Infinity) {
        score = Infinity;
        break;
      }
      score += best;
    }
    if (score !== Infinity) scored.push({ contact, score: score + (words.length - heard.length) * 0.1 });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.contact);
}

/** The script that lists the contacts: the option, else an exposed one named after them. */
async function contactsScript(ha: HomeAssistantClient): Promise<string | undefined> {
  const configured = (process.env.CONTACTS_SCRIPT ?? "").trim().replace(/^script\./, "");
  if (configured) return configured;
  const scripts = await ha.listScripts().catch(() => []);
  return scripts.find((s) => s.returns && /contact/i.test(s.id))?.id.replace(/^script\./, "");
}

async function readContacts(ha: HomeAssistantClient): Promise<{ script?: string; contacts: Contact[] }> {
  const script = await contactsScript(ha);
  if (!script) return { contacts: [] };
  if (cache && cache.script === script && Date.now() - cache.at < CACHE_MS) return { script, contacts: cache.contacts };
  const result = (await ha.callService("script", script, undefined, {})) as ServiceCallWithResponse | unknown[];
  const response = Array.isArray(result) ? undefined : result?.service_response;
  const contacts = contactsFrom(response);
  if (contacts.length) cache = { script, at: Date.now(), contacts };
  return { script, contacts };
}

/** The find_contact tool. */
export async function findContact(ha: HomeAssistantClient, query: string): Promise<unknown> {
  if (!query.trim()) return { error: "Give the name (or the number) to look for." };
  const { script, contacts } = await readContacts(ha);
  if (!script) {
    return { error: "No contacts script is set up: set the add-on option contacts_script to the script that returns the contacts." };
  }
  if (!contacts.length) return { error: `script.${script} returned no contacts that could be read.` };
  const matches = matchContacts(contacts, query);
  return {
    query,
    found: matches.length,
    contacts: matches.slice(0, MAX_MATCHES),
    ...(matches.length > MAX_MATCHES ? { more: `${matches.length - MAX_MATCHES} more match: ask for the rest of the name.` } : {}),
    ...(matches.length === 0
      ? { note: `None of the ${contacts.length} contacts matches "${query}". Say so; never guess a number.` }
      : matches.length > 1
        ? { note: "Several contacts match: ask which one before calling or texting." }
        : {}),
  };
}
