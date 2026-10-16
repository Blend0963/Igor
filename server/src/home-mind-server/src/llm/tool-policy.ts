/**
 * Which tools a turn may use, beyond its conversation style.
 *
 * Two rules, enforced twice (the tool list sent to the model, and the handler
 * itself, so a model that names a tool it was not offered gets nothing):
 *
 * - CONFIG_EDITS decides how far Igor may change the configuration: "off"
 *   (read only), "automations" (the automation tools, the default) or "yaml"
 *   (also write_config_file).
 * - An UNATTENDED turn (a scheduled task, the morning briefing, an AI Task
 *   request from Home Assistant: nobody is there to answer) never gets a tool
 *   whose safety rests on a person confirming, nor one that makes Igor act
 *   again later or send things out on its own. Before 0.9.3 such a turn could
 *   preview a change in one run and "confirm" it in the next.
 */

export type ConfigEdits = "off" | "automations" | "yaml";

const AUTOMATION_WRITE_TOOLS = new Set(["create_automation", "update_automation", "delete_automation"]);

/** Tools that only make sense with a person there to confirm, or that act again later. */
const NEEDS_A_PERSON = new Set([
  ...AUTOMATION_WRITE_TOOLS,
  "write_config_file",
  "forget_memory",
  "schedule_task",
  "cancel_scheduled_task",
  "notify_when",
  "use_connector",
]);

let configEdits: ConfigEdits = "automations";

export function setConfigEdits(value: ConfigEdits): void {
  configEdits = value;
}

export function getConfigEdits(): ConfigEdits {
  return configEdits;
}

export interface TurnPolicy {
  unattended?: boolean;
}

/** Why a tool is not available in this turn, or undefined when it is. */
export function toolRefusal(name: string, turn: TurnPolicy = {}): string | undefined {
  if (name === "write_config_file" && configEdits !== "yaml") {
    return "Writing configuration files is turned off in the add-on options (config_edits). Tell the user the exact lines to change instead.";
  }
  if (AUTOMATION_WRITE_TOOLS.has(name) && configEdits === "off") {
    return "Changing automations is turned off in the add-on options (config_edits). Tell the user what to change instead.";
  }
  if (turn.unattended && NEEDS_A_PERSON.has(name)) {
    return "This run has nobody to confirm with (a scheduled task or an automatic request), so this tool is not available. Report what should be done instead; the user can ask for it in a conversation.";
  }
  return undefined;
}

export function filterTools<T extends { name: string }>(tools: T[], turn: TurnPolicy = {}): T[] {
  return tools.filter((t) => !toolRefusal(t.name, turn));
}
