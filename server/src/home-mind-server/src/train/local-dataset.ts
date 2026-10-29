/**
 * Training examples for the house's own model (llm/local-llm.ts), built
 * from the house itself: its rooms, devices, scenes and scripts.
 *
 * The model fine-tuned on them has one job: turn what is said into the
 * tool calls that carry it out, or "-" when the request is not about the
 * home (the online model answers then). Each example is the exact request
 * the server sends the local model in tuned mode (LOCAL_LLM_TUNED: no room
 * map, no light cheat sheet, both learned), followed by the answer it
 * should give. localTurnMessages() builds that request the way the engine
 * does, and a test holds the two together.
 *
 * Nothing here leaves the house on its own: the dataset is built on demand
 * (GET /api/local-dataset, from the panel) and the owner decides where it
 * goes. Contacts, memories and people's names in the examples are made up.
 */

import type OpenAI from "openai";
import { buildSystemPromptText } from "../llm/prompts.js";
import { LOCAL_PROMPT_HISTORY, LOCAL_REMINDER } from "../llm/local-llm.js";
import { SPOKEN_LENGTH_REMINDER, spokenSentenceCap } from "../llm/lean.js";
import { isFeminine } from "../llm/action-sentence.js";

/** A device as the generator needs it. */
export interface HouseDevice {
  id: string;
  name: string;
  area?: string;
  deviceClass?: string;
  unit?: string;
  light?: { brightness: boolean; white: "color_temp" | "rgbw" | "rgb_white" | "none"; color: boolean };
}

export interface HouseInventory {
  devices: HouseDevice[];
  /** Scripts that take no required field: "lance l'arrosage". */
  scripts: { id: string; name: string }[];
}

export interface DatasetOptions {
  /** localPersona(LOCAL_LLM_PROMPT), as the engine sends it. */
  persona: string;
  /** formatScriptSection() of the house's scripts: tuned mode keeps it. */
  scriptSection?: string;
  language?: string;
  voiceGender?: "female" | "male";
  seed?: number;
  /** Rough number of examples (default 4000). */
  size?: number;
  /** Share of examples held out for the bench, from phrasings training never sees. */
  testShare?: number;
}

type Message = OpenAI.ChatCompletionMessageParam & { training?: boolean };

export interface Example {
  kind: string;
  messages: Message[];
}

export interface Dataset {
  train: Example[];
  test: Example[];
  counts: Record<string, number>;
}

/** One past message the local model reads (LOCAL_PROMPT_HISTORY of them). */
export interface PastMessage {
  role: "user" | "assistant";
  content: string;
  /** "09:12": the engine stamps the user's turns. */
  time?: string;
}

const CACHE_MARKER = "\n\n## Current Context:";

/**
 * The messages the engine sends the local model for one spoken or typed
 * Assist request in tuned mode, before its answer.
 */
export function localTurnMessages(p: {
  persona: string;
  scriptSection?: string;
  language?: string;
  voiceGender?: "female" | "male";
  facts: string[];
  history: PastMessage[];
  message: string;
  isVoice: boolean;
  /** Replaces today's date line, so examples are not all dated the day they were built. */
  date?: string;
}): Message[] {
  let system = buildSystemPromptText(p.facts, p.isVoice, p.persona, p.scriptSection, undefined, p.language, p.voiceGender, true, true);
  if (p.date) system = system.replace(/^- Date: .*? \(the server/m, `- Date: ${p.date} (the server`);
  const at = system.indexOf(CACHE_MARKER);
  const messages: Message[] = [{ role: "system", content: system.slice(0, at) }];
  for (const m of p.history.slice(-LOCAL_PROMPT_HISTORY)) {
    const prefix = m.role === "user" && m.time ? `[${m.time}] ` : "";
    messages.push({ role: m.role, content: `${prefix}${m.content}`, training: false } as Message);
  }
  let volatile = system.slice(at + 2);
  if (p.isVoice && spokenSentenceCap(p.message) !== undefined) volatile = `${volatile}\n\n${SPOKEN_LENGTH_REMINDER}`;
  volatile = `${volatile}\n\n${LOCAL_REMINDER}`;
  messages.push({ role: "system", content: volatile });
  messages.push({ role: "user", content: p.message });
  return messages;
}

// ----- randomness -----

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

/**
 * A phrasing from a list: training draws from the first ones, the test set
 * from the last fifth, so the bench measures phrasings never trained on.
 */
function phrase(rng: Rng, list: readonly string[], test: boolean): string {
  if (list.length < 4) return pick(rng, list);
  const cut = Math.max(1, Math.round(list.length * 0.8));
  return pick(rng, test ? list.slice(cut) : list.slice(0, cut));
}

// ----- French -----

const VOWEL = /^[aeiouyàâäéèêëîïôöùûüh]/i;

function lower(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function isPlural(name: string): boolean {
  const first = lower(name).split(/[\s'’]+/)[0] ?? "";
  return /[sx]$/.test(first) && first.length > 3 && !["box", "prix"].includes(first);
}

/** "la lumière salon", "l'applique", "les volets". */
function the(name: string): string {
  const n = lower(name);
  if (isPlural(n)) return `les ${n}`;
  if (VOWEL.test(n)) return `l'${n}`;
  return `${isFeminine(n) ? "la" : "le"} ${n}`;
}

/** "du salon", "de la cuisine", "de l'entrée", "des toilettes". */
function of(area: string): string {
  const a = lower(area);
  if (isPlural(a)) return `des ${a}`;
  if (VOWEL.test(a)) return `de l'${a}`;
  return isFeminine(a) ? `de la ${a}` : `du ${a}`;
}

/** "dans le salon", "dans la cuisine", "dans l'entrée". */
function inside(area: string): string {
  const a = lower(area);
  if (isPlural(a)) return `dans les ${a}`;
  if (VOWEL.test(a)) return `dans l'${a}`;
  return `dans ${isFeminine(a) ? "la" : "le"} ${a}`;
}

/** e/s agreement for a past participle after the device's name. */
function agreeWith(word: string, name: string): string {
  return word + (isFeminine(lower(name)) ? "e" : "") + (isPlural(name) ? "s" : "");
}

/** "la" / "le" / "les" as an object pronoun: "éteins-la". */
function pronoun(name: string): string {
  return isPlural(name) ? "les" : isFeminine(lower(name)) ? "la" : "le";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * The words as the speech-to-text hands them over: Whisper capitalizes and
 * punctuates, the typed Assist often does not; the wake word or a filler
 * sometimes stays in.
 */
function spoken(rng: Rng, text: string, question = false): string {
  let t = text.trim();
  const r = rng();
  if (r < 0.08) t = `Igor, ${t}`;
  else if (r < 0.12) t = `${t}, Igor`;
  else if (r < 0.16) t = `euh ${t}`;
  if (rng() < 0.03) t = stripAccents(t);
  if (rng() < 0.55) return `${capitalize(t)}${question ? " ?" : "."}`;
  return rng() < 0.5 ? t.toLowerCase() : `${t}${question ? " ?" : ""}`;
}

// ----- answers -----

type Call = { name: string; args: Record<string, unknown> };

function callMessage(calls: Call[], n: number): Message {
  return {
    role: "assistant",
    content: "",
    tool_calls: calls.map((c, i) => ({
      id: `call_${n}_${i}`,
      type: "function" as const,
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    })),
  };
}

const NOTHING: Message = { role: "assistant", content: "-" };

function service(domain: string, svc: string, ids: string[] | undefined, data?: Record<string, unknown>): Call {
  const args: Record<string, unknown> = { domain, service: svc };
  if (ids && ids.length) args.entity_id = ids.join(",");
  if (data && Object.keys(data).length) args.data = data;
  return { name: "call_service", args };
}

// ----- the house, as people name it -----

const DOMAIN_NOUNS: Record<string, string[]> = {
  light: ["la lumière", "la lampe"],
  switch: ["la prise"],
  fan: ["le ventilateur"],
  cover: ["le volet", "le store"],
  climate: ["le chauffage", "le thermostat"],
  media_player: ["la télé", "l'enceinte"],
  lock: ["la serrure"],
  vacuum: ["l'aspirateur"],
};

function domainOf(id: string): string {
  return id.slice(0, id.indexOf("."));
}

interface Named {
  device: HouseDevice;
  /** Every way to say it that points at it alone. */
  says: string[];
}

function namings(devices: HouseDevice[]): Named[] {
  return devices.map((d) => {
    const says = new Set<string>([the(d.name)]);
    const domain = domainOf(d.id);
    if (d.area) {
      const sameKind = devices.filter((o) => domainOf(o.id) === domain && o.area === d.area);
      if (sameKind.length === 1) {
        for (const noun of DOMAIN_NOUNS[domain] ?? []) says.add(`${noun} ${of(d.area)}`);
        // "the first word of its name + the room": "le plafonnier de la cuisine"
        const first = lower(d.name).split(" ")[0];
        if (first && !lower(d.area).includes(first) && first.length > 2) says.add(`${the(first)} ${of(d.area)}`);
      }
    }
    return { device: d, says: [...says] };
  });
}

// ----- phrasings -----

const ON = ["allume {x}", "allume-moi {x}", "tu peux allumer {x}", "peux-tu allumer {x}", "active {x}", "allume {x} s'il te plaît", "j'aimerais que tu allumes {x}", "vous pouvez allumer {x}", "mets {x} en marche", "allume donc {x}"];
const OFF = ["éteins {x}", "éteins-moi {x}", "tu peux éteindre {x}", "coupe {x}", "désactive {x}", "éteins {x} s'il te plaît", "peux-tu éteindre {x}", "arrête {x}", "vous pouvez éteindre {x}", "coupe-moi {x}"];
const AREA_ON = ["allume les lumières {de}", "allume tout {dans}", "allume la lumière {dans}", "mets de la lumière {dans}", "fais de la lumière {dans}"];
const AREA_OFF = ["éteins les lumières {de}", "éteins tout {dans}", "éteins la lumière {dans}", "coupe les lumières {de}", "plus de lumière {dans}"];
const ALL_OFF = ["éteins toutes les lumières", "éteins tout", "coupe toutes les lumières", "éteins toutes les lumières de la maison", "on éteint tout"];
const BRIGHT = ["mets {x} à {p} %", "règle {x} à {p} %", "baisse {x} à {p} %", "{x} à {p} %", "allume {x} à {p} %", "passe {x} à {p} pour cent"];
const DIM = ["baisse {x}", "tamise {x}", "diminue {x}", "{x} moins fort"];
const WHITE = ["mets {x} en blanc", "lumière blanche {dans}", "passe {x} en blanc", "mets du blanc sur {x}"];
const COLOR = ["mets {x} en {c}", "passe {x} en {c}", "allume {x} en {c}", "{x} en {c}", "change {x} en {c}"];
const COLORS: Record<string, [number, number, number]> = {
  rouge: [255, 0, 0], vert: [0, 255, 0], bleu: [0, 0, 255], jaune: [255, 200, 0],
  orange: [255, 120, 0], violet: [150, 0, 255], rose: [255, 80, 160], cyan: [0, 255, 255],
};
const COVER_OPEN = ["ouvre {x}", "remonte {x}", "lève {x}", "tu peux ouvrir {x}", "ouvre-moi {x}", "monte {x}"];
const COVER_CLOSE = ["ferme {x}", "baisse {x}", "descends {x}", "tu peux fermer {x}", "ferme-moi {x}", "abaisse {x}"];
const COVER_STOP = ["arrête {x}", "stoppe {x}", "stop {x}", "bloque {x}"];
const COVER_POS = ["ouvre {x} à {p} %", "mets {x} à {p} %", "règle {x} à {p} %", "{x} à {p} %", "positionne {x} à {p} %"];
const COVER_HALF = ["ferme {x} à moitié", "ouvre {x} à moitié", "mets {x} à mi-hauteur", "{x} à moitié"];
const COVERS_ALL = ["ferme tous les volets", "ouvre tous les volets", "ferme les volets de la maison", "ouvre tous les volets de la maison"];
const COVERS_AREA = ["ferme les volets {de}", "ouvre les volets {de}", "baisse les volets {de}", "remonte les volets {de}"];
const HEAT = ["mets {x} à {t} degrés", "règle {x} sur {t}", "monte {x} à {t} degrés", "je veux {t} degrés {dans}", "chauffe à {t} degrés {dans}", "baisse {x} à {t}"];
const MEDIA_PAUSE = ["mets {x} en pause", "pause sur {x}", "mets pause {dans}"];
const MEDIA_PLAY = ["relance {x}", "remets la lecture sur {x}", "reprends la lecture {dans}"];
const VOLUME = ["mets le son {de} à {p}", "volume {de} à {p} %", "règle le volume de {x} à {p}"];
const SCENE = ["active la scène {n}", "lance la scène {n}", "mets l'ambiance {n}", "scène {n}", "mode {n}", "passe en mode {n}"];
const SCRIPT = ["lance {n}", "exécute {n}", "démarre {n}", "lance le script {n}", "fais {n}"];
const LOCK = ["verrouille {x}", "ferme {x} à clé", "tu peux verrouiller {x}"];
const UNLOCK = ["déverrouille {x}", "tu peux déverrouiller {x}"];
const VACUUM_START = ["lance {x}", "passe l'aspirateur", "démarre {x}", "lance le ménage"];
const VACUUM_DOCK = ["renvoie {x} à sa base", "remets {x} sur sa base", "rappelle {x}"];
const IS_ON = ["est-ce que {x} est {on}", "{x} est {on}", "tu peux vérifier si {x} est {on}", "j'ai laissé {x} {on}", "{x} est toujours {on}"];
const IS_OPEN = ["est-ce que {x} est {open}", "{x} est {open}", "tu peux vérifier si {x} est {open}", "{x} est bien {closed}", "est-ce que {x} est {closed}"];
const TEMP = ["quelle température fait-il {dans}", "il fait combien {dans}", "quelle est la température {de}", "température {de}", "il fait chaud {dans}", "combien de degrés {dans}"];
const HUMID = ["quelle est l'humidité {dans}", "quel est le taux d'humidité {de}", "humidité {de}", "c'est humide {dans}"];
const READ = ["combien indique {x}", "quelle est la valeur de {x}", "donne-moi {x}", "que dit {x}", "{x} indique combien"];
const PERSON_HOME = ["est-ce que {p} est à la maison", "{p} est rentré", "{p} est là", "où est {p}", "{p} est à la maison"];
const WEATHER_NOW = ["quel temps fait-il", "il fait beau dehors", "quelle est la météo", "il pleut", "quel temps il fait dehors"];
const WEATHER_TOMORROW = ["quel temps fera-t-il demain", "il va pleuvoir demain", "la météo de demain", "il fera beau demain", "quelles sont les prévisions pour demain"];

const TASKS = [
  "sortir les poubelles", "prendre mes médicaments", "appeler le médecin", "arroser les plantes", "récupérer les enfants",
  "étendre le linge", "éteindre le four", "payer la facture d'électricité", "nourrir le chat", "faire les courses",
  "sortir le chien", "rappeler le garage", "vider le lave-vaisselle", "fermer le portail", "prendre le pain",
  "envoyer le dossier", "réserver le restaurant", "changer les draps", "rentrer les poubelles", "regarder le match",
];
const REMIND = ["rappelle-moi de {t} {w}", "fais-moi penser à {t} {w}", "mets un rappel pour {t} {w}", "{w} rappelle-moi de {t}", "n'oublie pas de me rappeler de {t} {w}", "programme un rappel {w} pour {t}"];
const REMINDERS_LIST = ["quels sont mes rappels", "qu'est-ce que j'ai comme rappels", "liste mes rappels", "j'ai des rappels de prévus", "quels rappels sont programmés"];
const NOTIFY_OPEN = ["préviens-moi quand {x} s'ouvre", "dis-moi si {x} s'ouvre", "avertis-moi quand {x} est ouverte", "envoie-moi une notification quand {x} s'ouvre"];
const NOTIFY_HOME = ["préviens-moi quand {p} rentre", "dis-moi quand {p} arrive à la maison", "avertis-moi quand {p} est rentré"];
const NOTIFY_ABOVE = ["préviens-moi quand la température {de} dépasse {t} degrés", "dis-moi quand il fait plus de {t} degrés {dans}"];

const CONTACTS = ["Jean Martin", "Paul", "Sophie", "Marie Dubois", "Lucas", "Camille Bernard", "Thomas", "Léa", "Nicolas Petit", "Julie", "maman", "papa", "Antoine", "Chloé Moreau", "le docteur Lambert"];
const NUMBER = ["quel est le numéro de {c}", "donne-moi le numéro de {c}", "c'est quoi le téléphone de {c}", "tu as le numéro de {c}", "trouve le numéro de {c}"];

const MEMORY: { fact: string; ask: string[] }[] = [
  { fact: "Le prénom de l'utilisateur est Paul.", ask: ["comment je m'appelle", "tu te souviens de mon prénom", "c'est quoi mon prénom", "tu sais qui je suis"] },
  { fact: "Il préfère le thé vert au café.", ask: ["qu'est-ce que je préfère boire le matin", "tu te rappelles ce que j'aime boire", "je bois plutôt du thé ou du café"] },
  { fact: "Sa fille s'appelle Emma et a 8 ans.", ask: ["quel âge a ma fille", "comment s'appelle ma fille", "tu te souviens du prénom de ma fille"] },
  { fact: "Il est allergique aux arachides.", ask: ["je suis allergique à quoi déjà", "tu te rappelles mon allergie", "j'ai une allergie alimentaire"] },
  { fact: "Son chien s'appelle Rex.", ask: ["comment s'appelle mon chien", "tu te souviens du nom de mon chien"] },
  { fact: "Il travaille de nuit le mardi.", ask: ["quel jour je travaille de nuit", "tu te rappelles mes horaires du mardi"] },
];
const OTHER_FACTS = [
  "Il aime le jazz.", "Il se lève à 7 h en semaine.", "Sa voiture est une citadine électrique.", "Il fait du vélo le dimanche.",
  "Il préfère 21 degrés dans le salon.", "Sa mère habite à Lyon.", "Il n'aime pas la coriandre.", "Il joue de la guitare.",
];

const GENERAL = [
  "qui a écrit les misérables", "quelle est la capitale de l'australie", "combien font douze fois treize", "c'est quoi un trou noir",
  "pourquoi le ciel est bleu", "quelle est la hauteur de la tour eiffel", "qui a peint la joconde", "combien y a-t-il de planètes",
  "comment on fait une pâte à crêpes", "donne-moi une idée de repas pour ce soir", "raconte-moi une blague", "comment ça va",
  "bonjour", "bonsoir", "merci", "merci beaucoup", "super merci", "t'es qui", "qu'est-ce que tu sais faire", "tu es une intelligence artificielle",
  "quelles sont les infos du jour", "qui a gagné le match hier soir", "qui a gagné le ballon d'or cette année", "quel est le cours du bitcoin",
  "quand sort le prochain film marvel", "quel est le prix de l'essence en ce moment", "c'est quoi l'actualité", "il y a des grèves demain",
  "traduis bonjour en espagnol", "comment on dit merci en japonais", "que veut dire procrastiner", "c'est quoi la photosynthèse",
  "donne-moi un conseil pour bien dormir", "comment enlever une tache de vin", "quelle est la recette du bœuf bourguignon", "combien de temps cuire un œuf dur",
  "raconte-moi une histoire", "chante-moi une chanson", "tu peux m'aider à réviser", "qui est le président de la république",
  "quelle est la population de la france", "combien de kilomètres entre paris et marseille", "c'est quand la fête des mères", "quel jour on est",
  "quelle heure est-il", "on est quel jour demain", "quelle est la date de noël", "combien de jours avant noël",
  "qui a inventé l'ampoule", "explique-moi la relativité", "c'est quoi un nombre premier", "quel est le plus grand océan",
  "donne-moi un synonyme de content", "qu'est-ce que je pourrais offrir à ma sœur", "tu connais une bonne série", "quel film regarder ce soir",
  "j'ai mal à la tête qu'est-ce que je peux faire", "c'est quoi la différence entre un virus et une bactérie", "comment calculer un pourcentage", "combien font trois cent quarante divisé par quatre",
  "tu es là", "salut", "bonne nuit", "à plus tard", "je t'aime bien", "t'es nul", "d'accord", "ok", "non rien", "laisse tomber",
  "c'est qui le meilleur joueur de foot", "quel temps faisait-il en 1990", "quelle est la vitesse de la lumière", "pourquoi les chats ronronnent",
];
/** Not in the house: searched, found nowhere, left to the online model (which says so). */
const ABSENT = ["le jacuzzi", "la piscine", "le sauna", "la cheminée", "le portail", "l'arrosage", "la machine à café", "le four", "la hotte", "le garage", "la véranda", "le spa"];

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_WORDS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

function randomDate(rng: Rng): string {
  const day = new Date(Date.UTC(2026, 0, 1) + Math.floor(rng() * 540) * 86400000);
  return day.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function randomTime(rng: Rng): string {
  return `${String(7 + Math.floor(rng() * 15)).padStart(2, "0")}:${String(Math.floor(rng() * 60)).padStart(2, "0")}`;
}

/** French contractions a filled template needs: "de le" → "du", "de arroser" → "d'arroser". */
function contract(text: string): string {
  return text
    .replace(/\bde le /g, "du ")
    .replace(/\bde les /g, "des ")
    .replace(/\bà le /g, "au ")
    .replace(/\bà les /g, "aux ")
    .replace(/\bde ([aeiouyàâéèêîôûh])/gi, "d'$1")
    .replace(/\bque ([aeiouyàâéèêîôû])/gi, "qu'$1");
}

function fill(template: string, values: Record<string, string>): string {
  return contract(template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "").replace(/\s+/g, " ").trim());
}

/** Whether the words read as a question, for the question mark Whisper would add. */
function asksSomething(text: string): boolean {
  return /^(qu|comment|combien|pourquoi|quand|où|c'est|est-ce|tu |t'|il y a|il fait|il va|il pleut|on est|je suis|j'ai|je bois)/i.test(text.trim());
}

/** What the online model might have answered to a chat, as the history holds it. */
const CHAT_REPLIES = ["Avec plaisir.", "C'est Victor Hugo.", "Bonne question : en bref, oui.", "Voici une idée simple.", "Je vous en prie.", "Il est question de physique, en deux mots."];

/** What the online model said after an order, as the history holds it. */
function doneSentence(name: string, word: string): string {
  return `${capitalize(lower(name))} ${agreeWith(word, name)}.`;
}

// ----- the generator -----

interface Draft {
  kind: string;
  text: string;
  question?: boolean;
  answer: Message[];
  history?: PastMessage[];
  facts?: string[];
}

export function buildLocalDataset(house: HouseInventory, options: DatasetOptions): Dataset {
  const rng = mulberry32(options.seed ?? 1);
  const size = options.size ?? 4000;
  const testShare = options.testShare ?? 0.12;
  const named = namings(house.devices);
  const of_ = (domain: string) => named.filter((n) => domainOf(n.device.id) === domain);
  const lights = of_("light");
  const switches = [...of_("switch"), ...of_("fan"), ...of_("input_boolean")];
  const covers = of_("cover");
  const climates = of_("climate");
  const media = of_("media_player");
  const scenes = of_("scene");
  const locks = of_("lock");
  const vacuums = of_("vacuum");
  const persons = of_("person");
  const weathers = of_("weather");
  const sensors = of_("sensor");
  const binaries = of_("binary_sensor");
  const openings = binaries.filter((b) => ["door", "window", "garage_door", "opening"].includes(b.device.deviceClass ?? ""));
  const areas = [...new Set(house.devices.map((d) => d.area).filter((a): a is string => Boolean(a)))];
  const inArea = (list: Named[], area: string) => list.filter((n) => n.device.area === area);
  const tempIn = (area: string) => sensors.filter((s) => s.device.area === area && s.device.deviceClass === "temperature");
  const humidIn = (area: string) => sensors.filter((s) => s.device.area === area && s.device.deviceClass === "humidity");
  let n = 0;

  /** One request: its words and what the model should do. */
  type Maker = (test: boolean) => Draft | undefined;
  const makers: { kind: string; weight: number; make: Maker }[] = [];
  const add = (kind: string, weight: number, make: Maker) => {
    if (weight > 0) makers.push({ kind, weight, make });
  };
  const one = (calls: Call[]) => [callMessage(calls, n++)];

  // Lights and switches, on and off.
  const toggles = [...lights, ...switches];
  add("on_off", toggles.length ? 14 : 0, (test) => {
    const d = pick(rng, toggles);
    const on = rng() < 0.55;
    const text = fill(phrase(rng, on ? ON : OFF, test), { x: pick(rng, d.says) });
    return { kind: "on_off", text, answer: one([service(domainOf(d.device.id), on ? "turn_on" : "turn_off", [d.device.id])]) };
  });
  // A room's lights, or the whole house's.
  const litAreas = areas.filter((a) => inArea(lights, a).length > 0);
  add("area_lights", litAreas.length ? 6 : 0, (test) => {
    const area = pick(rng, litAreas);
    const on = rng() < 0.5;
    const text = fill(phrase(rng, on ? AREA_ON : AREA_OFF, test), { de: of(area), dans: inside(area) });
    return { kind: "area_lights", text, answer: one([service("light", on ? "turn_on" : "turn_off", inArea(lights, area).map((l) => l.device.id))]) };
  });
  add("all_lights", lights.length > 1 && lights.length <= 40 ? 2 : 0, (test) => ({
    kind: "all_lights",
    text: phrase(rng, ALL_OFF, test),
    answer: one([service("light", "turn_off", lights.map((l) => l.device.id))]),
  }));
  // Two devices at once.
  add("two_devices", toggles.length > 1 ? 3 : 0, (test) => {
    const a = pick(rng, toggles);
    const b = pick(rng, toggles.filter((t) => t !== a));
    const on = rng() < 0.5;
    const verb = phrase(rng, on ? ON : OFF, test);
    const text = fill(verb, { x: `${pick(rng, a.says)} et ${pick(rng, b.says)}` });
    const sameDomain = domainOf(a.device.id) === domainOf(b.device.id);
    const svc = on ? "turn_on" : "turn_off";
    const calls = sameDomain
      ? [service(domainOf(a.device.id), svc, [a.device.id, b.device.id])]
      : [service(domainOf(a.device.id), svc, [a.device.id]), service(domainOf(b.device.id), svc, [b.device.id])];
    return { kind: "two_devices", text, answer: one(calls) };
  });
  // Brightness, white, colours.
  const dimmable = lights.filter((l) => l.device.light?.brightness);
  add("brightness", dimmable.length ? 5 : 0, (test) => {
    const d = pick(rng, dimmable);
    if (rng() < 0.2) {
      return { kind: "brightness", text: fill(phrase(rng, DIM, test), { x: pick(rng, d.says) }), answer: one([service("light", "turn_on", [d.device.id], { brightness_pct: 30 })]) };
    }
    const template = phrase(rng, BRIGHT, test);
    const p = template.startsWith("baisse") ? pick(rng, [10, 20, 25, 30, 40, 50]) : pick(rng, [10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100]);
    return { kind: "brightness", text: fill(template, { x: pick(rng, d.says), p: String(p) }), answer: one([service("light", "turn_on", [d.device.id], { brightness_pct: p })]) };
  });
  const whites = lights.filter((l) => l.device.light && l.device.light.white !== "none");
  add("white", whites.length ? 2 : 0, (test) => {
    const d = pick(rng, whites);
    const white = d.device.light!.white;
    const data = white === "color_temp" ? { color_temp_kelvin: 4000 } : white === "rgbw" ? { rgbw_color: [0, 0, 0, 255] } : { rgb_color: [255, 255, 255] };
    const template = phrase(rng, WHITE, test);
    if (template.includes("{dans}") && !(d.device.area && inArea(lights, d.device.area).length === 1)) return undefined;
    return { kind: "white", text: fill(template, { x: pick(rng, d.says), dans: d.device.area ? inside(d.device.area) : "" }), answer: one([service("light", "turn_on", [d.device.id], data)]) };
  });
  const colored = lights.filter((l) => l.device.light?.color);
  add("color", colored.length ? 3 : 0, (test) => {
    const d = pick(rng, colored);
    const c = pick(rng, Object.keys(COLORS));
    return { kind: "color", text: fill(phrase(rng, COLOR, test), { x: pick(rng, d.says), c }), answer: one([service("light", "turn_on", [d.device.id], { rgb_color: COLORS[c] })]) };
  });
  // Covers.
  add("cover", covers.length ? 8 : 0, (test) => {
    const d = pick(rng, covers);
    const x = pick(rng, d.says);
    const r = rng();
    if (r < 0.35) return { kind: "cover", text: fill(phrase(rng, COVER_OPEN, test), { x }), answer: one([service("cover", "open_cover", [d.device.id])]) };
    if (r < 0.7) return { kind: "cover", text: fill(phrase(rng, COVER_CLOSE, test), { x }), answer: one([service("cover", "close_cover", [d.device.id])]) };
    if (r < 0.8) return { kind: "cover", text: fill(phrase(rng, COVER_STOP, test), { x }), answer: one([service("cover", "stop_cover", [d.device.id])]) };
    if (r < 0.88) return { kind: "cover", text: fill(phrase(rng, COVER_HALF, test), { x }), answer: one([service("cover", "set_cover_position", [d.device.id], { position: 50 })]) };
    const p = pick(rng, [10, 20, 25, 30, 40, 60, 70, 75, 80, 90]);
    return { kind: "cover", text: fill(phrase(rng, COVER_POS, test), { x, p: String(p) }), answer: one([service("cover", "set_cover_position", [d.device.id], { position: p })]) };
  });
  const coverAreas = areas.filter((a) => inArea(covers, a).length > 1);
  add("covers_group", covers.length > 1 ? 3 : 0, (test) => {
    if (coverAreas.length && rng() < 0.5) {
      const area = pick(rng, coverAreas);
      const t = phrase(rng, COVERS_AREA, test);
      const open = /ouvre|remonte/.test(t);
      return { kind: "covers_group", text: fill(t, { de: of(area) }), answer: one([service("cover", open ? "open_cover" : "close_cover", inArea(covers, area).map((c) => c.device.id))]) };
    }
    const t = phrase(rng, COVERS_ALL, test);
    return { kind: "covers_group", text: t, answer: one([service("cover", t.startsWith("ouvre") ? "open_cover" : "close_cover", covers.map((c) => c.device.id))]) };
  });
  // Heating.
  add("climate", climates.length ? 3 : 0, (test) => {
    const d = pick(rng, climates);
    const t = pick(rng, [17, 18, 18.5, 19, 19.5, 20, 20.5, 21, 21.5, 22, 23]);
    const template = phrase(rng, HEAT, test);
    if (template.includes("{dans}") && !(d.device.area && inArea(climates, d.device.area).length === 1)) return undefined;
    const said = String(t).replace(".", ",");
    return {
      kind: "climate",
      text: fill(template, { x: pick(rng, d.says), t: said, dans: d.device.area ? inside(d.device.area) : "" }),
      answer: one([service("climate", "set_temperature", [d.device.id], { temperature: t })]),
    };
  });
  // Media players.
  add("media", media.length ? 3 : 0, (test) => {
    const d = pick(rng, media);
    const x = pick(rng, d.says);
    const dans = d.device.area ? inside(d.device.area) : "";
    const de = d.device.area ? of(d.device.area) : "";
    const r = rng();
    if (r < 0.3) {
      const on = rng() < 0.5;
      return { kind: "media", text: fill(phrase(rng, on ? ON : OFF, test), { x }), answer: one([service("media_player", on ? "turn_on" : "turn_off", [d.device.id])]) };
    }
    if (!d.device.area && r < 0.9) return undefined;
    if (r < 0.55) return { kind: "media", text: fill(phrase(rng, MEDIA_PAUSE, test), { x, dans }), answer: one([service("media_player", "media_pause", [d.device.id])]) };
    if (r < 0.75) return { kind: "media", text: fill(phrase(rng, MEDIA_PLAY, test), { x, dans }), answer: one([service("media_player", "media_play", [d.device.id])]) };
    const p = pick(rng, [10, 20, 30, 40, 50, 60]);
    return { kind: "media", text: fill(phrase(rng, VOLUME, test), { x, de, p: String(p) }), answer: one([service("media_player", "volume_set", [d.device.id], { volume_level: p / 100 })]) };
  });
  // Scenes and scripts.
  add("scene", scenes.length ? 4 : 0, (test) => {
    const d = pick(rng, scenes);
    return { kind: "scene", text: fill(phrase(rng, SCENE, test), { n: lower(d.device.name).replace(/^scène\s+/, "") }), answer: one([service("scene", "turn_on", [d.device.id])]) };
  });
  add("script", house.scripts.length ? 3 : 0, (test) => {
    const s = pick(rng, house.scripts);
    return { kind: "script", text: fill(phrase(rng, SCRIPT, test), { n: the(s.name) }), answer: one([service("script", s.id.replace(/^script\./, ""), undefined)]) };
  });
  // Locks and vacuums.
  add("lock", locks.length ? 2 : 0, (test) => {
    const d = pick(rng, locks);
    const lock = rng() < 0.6;
    return { kind: "lock", text: fill(phrase(rng, lock ? LOCK : UNLOCK, test), { x: pick(rng, d.says) }), answer: one([service("lock", lock ? "lock" : "unlock", [d.device.id])]) };
  });
  add("vacuum", vacuums.length ? 2 : 0, (test) => {
    const d = pick(rng, vacuums);
    const start = rng() < 0.6;
    return { kind: "vacuum", text: fill(phrase(rng, start ? VACUUM_START : VACUUM_DOCK, test), { x: pick(rng, d.says) }), answer: one([service("vacuum", start ? "start" : "return_to_base", [d.device.id])]) };
  });
  // Reading states.
  add("state", toggles.length + covers.length + openings.length ? 6 : 0, (test) => {
    const pool = [...toggles, ...covers, ...openings];
    const d = pick(rng, pool);
    const domain = domainOf(d.device.id);
    const x = pick(rng, d.says);
    const text = domain === "light" || domain === "switch" || domain === "fan" || domain === "input_boolean"
      ? fill(phrase(rng, IS_ON, test), { x, on: agreeWith(rng() < 0.7 ? "allumé" : "éteint", d.device.name) })
      : fill(phrase(rng, IS_OPEN, test), { x, open: agreeWith("ouvert", d.device.name), closed: agreeWith("fermé", d.device.name) });
    return { kind: "state", text, question: true, answer: one([{ name: "get_state", args: { entity_id: d.device.id } }]) };
  });
  const tempAreas = areas.filter((a) => tempIn(a).length === 1);
  add("temperature", tempAreas.length ? 4 : 0, (test) => {
    const area = pick(rng, tempAreas);
    return { kind: "temperature", text: fill(phrase(rng, TEMP, test), { de: of(area), dans: inside(area) }), question: true, answer: one([{ name: "get_state", args: { entity_id: tempIn(area)[0].device.id } }]) };
  });
  const humidAreas = areas.filter((a) => humidIn(a).length === 1);
  add("humidity", humidAreas.length ? 2 : 0, (test) => {
    const area = pick(rng, humidAreas);
    return { kind: "humidity", text: fill(phrase(rng, HUMID, test), { de: of(area), dans: inside(area) }), question: true, answer: one([{ name: "get_state", args: { entity_id: humidIn(area)[0].device.id } }]) };
  });
  const readable = sensors.filter((s) => s.device.unit && !["temperature", "humidity"].includes(s.device.deviceClass ?? ""));
  add("sensor", readable.length ? 3 : 0, (test) => {
    const d = pick(rng, readable);
    return { kind: "sensor", text: fill(phrase(rng, READ, test), { x: the(d.device.name) }), question: true, answer: one([{ name: "get_state", args: { entity_id: d.device.id } }]) };
  });
  add("person", persons.length ? 2 : 0, (test) => {
    const d = pick(rng, persons);
    return { kind: "person", text: fill(phrase(rng, PERSON_HOME, test), { p: d.device.name }), question: true, answer: one([{ name: "get_state", args: { entity_id: d.device.id } }]) };
  });
  add("weather", weathers.length ? 3 : 0, (test) => {
    const d = weathers[0];
    if (rng() < 0.5) return { kind: "weather", text: phrase(rng, WEATHER_NOW, test), question: true, answer: one([{ name: "get_state", args: { entity_id: d.device.id } }]) };
    return { kind: "weather", text: phrase(rng, WEATHER_TOMORROW, test), question: true, answer: one([service("weather", "get_forecasts", [d.device.id], { type: "daily" })]) };
  });
  // Reminders and alerts.
  add("reminder", 6, (test) => {
    const t = pick(rng, TASKS);
    const r = rng();
    let w: string;
    let args: Record<string, unknown>;
    if (r < 0.25) {
      const m = pick(rng, [2, 5, 10, 15, 20, 30, 45]);
      w = `dans ${m} minutes`;
      args = { in_minutes: m };
    } else if (r < 0.4) {
      const h = pick(rng, [1, 2, 3, 4]);
      w = `dans ${h} heure${h > 1 ? "s" : ""}`;
      args = { in_hours: h };
    } else if (r < 0.65) {
      const h = 7 + Math.floor(rng() * 14);
      w = `demain à ${h}h`;
      args = { in_days: 1, time: `${String(h).padStart(2, "0")}:00` };
    } else if (r < 0.75) {
      const h = 7 + Math.floor(rng() * 14);
      w = `après-demain à ${h}h`;
      args = { in_days: 2, time: `${String(h).padStart(2, "0")}:00` };
    } else if (r < 0.88) {
      const h = 7 + Math.floor(rng() * 15);
      const m = pick(rng, [0, 15, 30, 45]);
      w = `à ${h}h${m ? String(m) : ""}`;
      args = { time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
    } else if (r < 0.94) {
      const h = 7 + Math.floor(rng() * 14);
      w = `tous les jours à ${h}h`;
      args = { repeat: "daily", time: `${String(h).padStart(2, "0")}:00` };
    } else {
      const i = Math.floor(rng() * 7);
      const h = 7 + Math.floor(rng() * 14);
      w = `chaque ${DAY_WORDS[i]} à ${h}h`;
      args = { repeat: "weekly", days: [DAYS[i]], time: `${String(h).padStart(2, "0")}:00` };
    }
    const text = fill(phrase(rng, REMIND, test), { t, w });
    return { kind: "reminder", text, answer: one([{ name: "schedule_task", args: { kind: "reminder", text: capitalize(t), ...args } }]) };
  });
  add("reminders_list", 1, (test) => ({ kind: "reminders_list", text: phrase(rng, REMINDERS_LIST, test), question: true, answer: one([{ name: "list_scheduled_tasks", args: {} }]) }));
  add("notify_when", openings.length + persons.length + tempAreas.length ? 2 : 0, (test) => {
    const r = rng();
    if (openings.length && r < 0.4) {
      const d = pick(rng, openings);
      return { kind: "notify_when", text: fill(phrase(rng, NOTIFY_OPEN, test), { x: pick(rng, d.says) }), answer: one([{ name: "notify_when", args: { entity_id: d.device.id, condition: "equals", value: "on", text: `${capitalize(lower(d.device.name))} : ${agreeWith("ouvert", d.device.name)}` } }]) };
    }
    if (persons.length && r < 0.7) {
      const d = pick(rng, persons);
      return { kind: "notify_when", text: fill(phrase(rng, NOTIFY_HOME, test), { p: d.device.name }), answer: one([{ name: "notify_when", args: { entity_id: d.device.id, condition: "equals", value: "home", text: `${d.device.name} est rentré` } }]) };
    }
    if (!tempAreas.length) return undefined;
    const area = pick(rng, tempAreas);
    const t = pick(rng, [20, 21, 22, 23, 24, 25, 26]);
    return { kind: "notify_when", text: fill(phrase(rng, NOTIFY_ABOVE, test), { de: of(area), dans: inside(area), t: String(t) }), answer: one([{ name: "notify_when", args: { entity_id: tempIn(area)[0].device.id, condition: "above", value: String(t), text: `Plus de ${t} degrés ${inside(area)}` } }]) };
  });
  // Contacts and memories.
  add("contact", 2, (test) => {
    const c = pick(rng, CONTACTS);
    return { kind: "contact", text: fill(phrase(rng, NUMBER, test), { c }), question: true, answer: one([{ name: "find_contact", args: { query: c } }]) };
  });
  add("memory", 2, (test) => {
    const m = pick(rng, MEMORY);
    const others = OTHER_FACTS.filter(() => rng() < 0.4);
    const facts = [...others, m.fact].sort(() => rng() - 0.5);
    return { kind: "memory", text: phrase(rng, m.ask, test), question: true, facts, answer: one([{ name: "share_memory", args: { facts: [m.fact] } }]) };
  });
  // Not about the home: "-", and the online model answers.
  add("not_home", 22, (test) => ({ kind: "not_home", text: phrase(rng, GENERAL, test), answer: [NOTHING] }));
  // A device the house does not have: looked for, not found, left to the online model.
  const known = new Set(house.devices.map((d) => lower(d.name)));
  const absent = ABSENT.filter((a) => ![...known].some((k) => k.includes(a.replace(/^(le |la |l')/, ""))));
  add("absent", absent.length ? 3 : 0, (test) => {
    const thing = pick(rng, absent);
    const query = thing.replace(/^(le |la |l')/, "");
    const call = callMessage([{ name: "search_entities", args: { query } }], n++);
    const id = (call as { tool_calls: { id: string }[] }).tool_calls[0].id;
    return {
      kind: "absent",
      text: fill(phrase(rng, rng() < 0.5 ? ON : OFF, test), { x: thing }),
      answer: [call, { role: "tool", tool_call_id: id, content: "[]" }, NOTHING],
    };
  });
  // Follow-ups: the last exchange says what "et la cuisine ?" or "vas-y" means.
  add("follow_up", toggles.length > 1 || covers.length ? 8 : 0, (test) => {
    const r = rng();
    if (r < 0.35 && toggles.length) {
      const d = pick(rng, toggles);
      const domain = domainOf(d.device.id);
      const history: PastMessage[] = [
        { role: "user", content: spoken(rng, fill(pick(rng, ON), { x: pick(rng, d.says) })), time: randomTime(rng) },
        { role: "assistant", content: doneSentence(d.device.name, "allumé") },
      ];
      const text = phrase(rng, [`éteins-${pronoun(d.device.name)}`, `tu peux ${pronoun(d.device.name) === "les" ? "les" : `l'`}éteindre`, "rééteins", `finalement éteins-${pronoun(d.device.name)}`, `non éteins-${pronoun(d.device.name)}`], test);
      return { kind: "follow_up", text, history, answer: one([service(domain, "turn_off", [d.device.id])]) };
    }
    if (r < 0.65) {
      const pairs = areas.flatMap((a) => areas.filter((b) => b !== a).map((b) => [a, b] as const))
        .filter(([a, b]) => inArea(lights, a).length === 1 && inArea(lights, b).length === 1);
      if (!pairs.length) return undefined;
      const [a, b] = pick(rng, pairs);
      const first = inArea(lights, a)[0];
      const history: PastMessage[] = [
        { role: "user", content: spoken(rng, fill(pick(rng, ON), { x: `la lumière ${of(a)}` })), time: randomTime(rng) },
        { role: "assistant", content: doneSentence(first.device.name, "allumé") },
      ];
      const text = fill(phrase(rng, ["et {b}", "et {dans} aussi", "pareil {dans}", "fais pareil {dans}", "et celle {de}", "maintenant {b}"], test), { b: lower(b), dans: inside(b), de: of(b) });
      return { kind: "follow_up", text, question: text.startsWith("et"), history, answer: one([service("light", "turn_on", [inArea(lights, b)[0].device.id])]) };
    }
    if (!covers.length) return undefined;
    const d = pick(rng, covers);
    const close = rng() < 0.5;
    const history: PastMessage[] = [
      { role: "user", content: spoken(rng, close ? pick(rng, ["il y a trop de soleil", "on voit tout de dehors", "il fait trop chaud ici"]) : pick(rng, ["il fait sombre ici", "on n'y voit rien", "il fait tout noir"])), time: randomTime(rng) },
      { role: "assistant", content: `Voulez-vous que ${close ? "je ferme" : "j'ouvre"} ${the(d.device.name)} ?` },
    ];
    if (rng() < 0.2) return { kind: "follow_up", text: phrase(rng, ["non", "non merci", "laisse", "pas besoin", "non c'est bon"], test), history, answer: [NOTHING] };
    return { kind: "follow_up", text: phrase(rng, ["oui", "vas-y", "oui vas-y", "d'accord", "ok fais-le", "oui s'il te plaît", "volontiers", "oui merci"], test), history, answer: one([service("cover", close ? "close_cover" : "open_cover", [d.device.id])]) };
  });
  // A home question after a chat, a chat after an order: the history must not decide alone.
  add("after_chat", 3, (test) => {
    const before = pick(rng, GENERAL);
    const history: PastMessage[] = [
      { role: "user", content: spoken(rng, before, asksSomething(before)), time: randomTime(rng) },
      { role: "assistant", content: pick(rng, CHAT_REPLIES) },
    ];
    if (toggles.length && rng() < 0.5) {
      const d = pick(rng, toggles);
      return { kind: "after_chat", text: fill(phrase(rng, OFF, test), { x: pick(rng, d.says) }), history, answer: one([service(domainOf(d.device.id), "turn_off", [d.device.id])]) };
    }
    const text = phrase(rng, GENERAL, test);
    return text === before ? undefined : { kind: "after_chat", text, history, answer: [NOTHING] };
  });

  const total = makers.reduce((s, m) => s + m.weight, 0);
  const seen = new Set<string>();
  const train: Example[] = [];
  const test: Example[] = [];
  const counts: Record<string, number> = {};
  let attempts = 0;
  while (train.length + test.length < size && attempts < size * 20) {
    attempts++;
    let x = rng() * total;
    const maker = makers.find((m) => (x -= m.weight) < 0) ?? makers[makers.length - 1];
    const isTest = rng() < testShare;
    const draft = maker.make(isTest);
    if (!draft) continue;
    const message = spoken(rng, draft.text, draft.question ?? asksSomething(draft.text));
    const key = `${message.toLowerCase()}|${draft.history?.map((h) => h.content).join("|") ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const facts = draft.facts ?? (rng() < 0.7 ? OTHER_FACTS.filter(() => rng() < 0.35) : []);
    const messages = [
      ...localTurnMessages({
        persona: options.persona,
        scriptSection: options.scriptSection,
        language: options.language,
        voiceGender: options.voiceGender,
        facts,
        history: draft.history ?? [],
        message,
        isVoice: rng() < 0.85,
        date: randomDate(rng),
      }),
      ...draft.answer,
    ];
    (isTest ? test : train).push({ kind: draft.kind, messages });
    counts[draft.kind] = (counts[draft.kind] ?? 0) + 1;
  }
  return { train, test, counts };
}

/** One example per line, with the tools: what Axolotl's chat_template datasets read. */
export function toJsonl(examples: Example[], tools: OpenAI.ChatCompletionTool[]): string {
  return examples.map((e) => JSON.stringify({ kind: e.kind, tools, messages: e.messages })).join("\n") + "\n";
}

/** A few examples as a person reads them: the words, the history, the expected answer. */
export function readableSample(examples: Example[], count = 40): string {
  const out: string[] = [];
  const step = Math.max(1, Math.floor(examples.length / count));
  for (let i = 0; i < examples.length && out.length < count; i += step) {
    const e = examples[i];
    const lines = [`[${e.kind}]`];
    const userAt = e.messages.map((m) => m.role).lastIndexOf("user");
    for (const m of e.messages.slice(1, userAt)) {
      if (m.role === "user" || m.role === "assistant") lines.push(`  (avant) ${m.role === "user" ? "personne" : "Igor"} : ${m.content}`);
    }
    lines.push(`  personne : ${e.messages[userAt].content}`);
    for (const m of e.messages.slice(userAt + 1)) {
      if (m.role === "assistant") {
        const calls = (m as { tool_calls?: { function: { name: string; arguments: string } }[] }).tool_calls;
        lines.push(calls?.length ? `  → ${calls.map((c) => `${c.function.name} ${c.function.arguments}`).join(" + ")}` : `  → ${m.content}`);
      } else if (m.role === "tool") lines.push(`  (résultat) ${m.content}`);
    }
    out.push(lines.join("\n"));
  }
  return out.join("\n\n") + "\n";
}
