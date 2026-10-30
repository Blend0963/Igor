/**
 * The owner's own phrases for the training set: igor-phrases.txt in Home
 * Assistant's config folder, one phrase per line, then what it should do.
 *
 *   passe l'aspirateur => vacuum.start vacuum.robot
 *   mets la lumière du salon à fond => light.turn_on light.salon {"brightness_pct": 100}
 *   allume le salon et la cuisine => light.turn_on light.salon,light.cuisine
 *   il fait combien dehors => get_state sensor.temperature_exterieure
 *   ferme tout et dis-moi quand c'est fait => cover.close_cover cover.salon >dire
 *   qui a gagné le match => web
 *   raconte-moi une blague => libre
 *
 * Several actions are joined with " + ". After the action, an optional
 * ">dire", ">rep"… replaces the default line ("-" for an order, ">rep" for a
 * reading). Lines starting with # are comments.
 */

export interface Phrase {
  words: string;
  calls: { name: string; args: Record<string, unknown> }[];
  line: string;
}

const LINES = new Set(["-", ">dire", ">rep", ">web", ">libre", ">demande"]);

/** The phrases, and what could not be read (line number and why). */
export function parsePhrasebook(text: string, known?: Set<string>): { phrases: Phrase[]; errors: string[] } {
  const phrases: Phrase[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const at = line.indexOf("=>");
    if (at < 1) return errors.push(`ligne ${lineNo} : il manque « => » (${line})`);
    const words = line.slice(0, at).trim();
    let action = line.slice(at + 2).trim();
    let said: string | undefined;
    const tail = /\s(-|>[a-z]+)\s*$/i.exec(` ${action}`);
    if (tail && LINES.has(tail[1].toLowerCase())) {
      said = tail[1].toLowerCase();
      action = action.slice(0, action.length - tail[0].trim().length).trim();
    }
    if (["web", "libre", "demande"].includes(action.toLowerCase())) {
      phrases.push({ words, calls: [], line: `>${action.toLowerCase()}` });
      return;
    }
    const calls: Phrase["calls"] = [];
    for (const part of action.split(/\s\+\s/)) {
      const m = /^(\S+)(?:\s+(\S+))?(?:\s+(\{.*\}))?$/.exec(part.trim());
      if (!m) return errors.push(`ligne ${lineNo} : action illisible (${part})`);
      const [, what, entity, json] = m;
      let data: Record<string, unknown> | undefined;
      if (json) {
        try {
          data = JSON.parse(json);
        } catch {
          return errors.push(`ligne ${lineNo} : données JSON illisibles (${json})`);
        }
      }
      for (const id of (entity ?? "").split(",").filter(Boolean)) {
        if (known && !known.has(id)) return errors.push(`ligne ${lineNo} : entité inconnue ${id}`);
      }
      if (what === "get_state") {
        if (!entity) return errors.push(`ligne ${lineNo} : get_state sans entité`);
        calls.push({ name: "get_state", args: { entity_id: entity } });
      } else if (/^[a-z_]+\.[a-z0-9_]+$/.test(what)) {
        const [domain, service] = what.split(".");
        const args: Record<string, unknown> = { domain, service };
        if (entity) args.entity_id = entity;
        if (data) args.data = data;
        calls.push({ name: "call_service", args });
      } else {
        return errors.push(`ligne ${lineNo} : action inconnue ${what} (domaine.service, get_state, web, libre ou demande)`);
      }
    }
    if (!calls.length) return errors.push(`ligne ${lineNo} : aucune action`);
    phrases.push({ words, calls, line: said ?? (calls.every((c) => c.name === "get_state") ? ">rep" : "-") });
  });
  return { phrases, errors };
}
