import type { ScriptInfo } from "./client.js";

/**
 * The scripts the assistant may run, for the system prompt.
 *
 * A script's fields are not in its entity's state, so a model that only sees
 * `script.minuteur` cannot know it takes a `recipient`, or that it must call
 * the script itself rather than `script.turn_on` (which refuses fields at the
 * top level and returns nothing). Listing them, with Home Assistant's own
 * descriptions, lets it pick the script and fill it in without guessing.
 */
const MAX_SCRIPTS = 60;
const MAX_TEXT = 200;

function clip(text: string | undefined, max = MAX_TEXT): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function formatScriptSection(scripts: ScriptInfo[]): string | undefined {
  if (scripts.length === 0) return undefined;
  const lines = scripts.slice(0, MAX_SCRIPTS).map((s) => {
    const about = [s.name && s.name !== s.id ? s.name : "", clip(s.description)].filter(Boolean).join(": ");
    const fields = s.fields.map((f) => {
      const parts = [f.name + (f.required ? " (required)" : "")];
      if (f.description) parts.push(clip(f.description, 120));
      if (f.example !== undefined && f.example !== null && f.example !== "") parts.push(`e.g. ${JSON.stringify(f.example)}`);
      return parts.join(" — ");
    });
    return `- ${s.id}${about ? ` — ${about}` : ""}${fields.length ? `. Fields: ${fields.join("; ")}` : ". No fields"}${s.returns ? ". Returns a result" : ""}`;
  });
  const more = scripts.length > MAX_SCRIPTS ? `\n(${scripts.length - MAX_SCRIPTS} more not listed.)` : "";
  return (
    "## Scripts you can run\n" +
    'Run one with call_service: domain "script", service = the part after "script." (e.g. "minuteur"), ' +
    "NO entity_id, data = its fields exactly as named below. A script that returns a result hands it back " +
    "in service_response: read it before answering. Never use script.turn_on to pass fields.\n" +
    lines.join("\n") +
    more
  );
}
