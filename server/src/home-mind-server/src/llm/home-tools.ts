/**
 * Handlers of the 0.8 home tools (definitions in tool-definitions.ts):
 * look_at_camera, get_statistics, and the scheduling tools.
 */

import type { HomeAssistantClient } from "../ha/client.js";
import { getVision } from "./vision.js";
import { getMediaStore, mediaLink } from "./media-store.js";
import { readConfigFile } from "../ha/config-files.js";
import {
  describeSchedule,
  formatLocal,
  getScheduler,
  notificationText,
  parseDays,
  parseWhen,
  relativeTime,
  type ConditionOp,
  type Schedule,
} from "../jobs/scheduler.js";

export const HOME_TOOL_NAMES = new Set([
  "look_at_camera",
  "get_statistics",
  "schedule_task",
  "notify_when",
  "send_notification",
  "list_scheduled_tasks",
  "cancel_scheduled_task",
  "get_config_item",
  "get_automation_traces",
  "read_config_file",
  "check_ha_config",
]);

/** Where read_config_file reads (HA_CONFIG_DIR, the add-on's /config). */
let configDir = "/config";
export function setConfigDir(dir: string): void {
  configDir = dir;
}
export function getConfigDir(): string {
  return configDir;
}

export interface HomeToolContext {
  /** The real user (not a thread's fact bucket): tasks belong to them. */
  ownerId?: string;
  /** A chat-panel thread: images can be shown. */
  isThread?: boolean;
  attachments?: string[];
}

const STAT_PERIODS = new Set(["hour", "day", "week", "month"]);
const STAT_TYPES = new Set(["mean", "min", "max", "change", "sum", "state"]);
/** Rows per statistic handed to the model; past that it is told to widen the period. */
const MAX_STAT_ROWS = 400;

function round(v: unknown): unknown {
  return typeof v === "number" ? Math.round(v * 1000) / 1000 : v;
}

export async function handleHomeTool(
  ha: HomeAssistantClient,
  name: string,
  input: Record<string, unknown>,
  ctx: HomeToolContext = {}
): Promise<unknown> {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : "");

  switch (name) {
    case "look_at_camera": {
      const entityId = str("entity_id");
      const vision = getVision();
      if (!vision) return { error: "Looking at cameras needs a vision-capable model, which is not configured." };
      const snap = await ha.getCameraSnapshot(entityId);
      if (!snap.mime.startsWith("image/")) return { error: "The camera did not return an image." };
      const dataUrl = `data:${snap.mime};base64,${snap.data.toString("base64")}`;
      const question = str("question") || "What does this camera show right now?";
      const description = await vision(dataUrl, question);
      let shown: string | undefined;
      if (ctx.isThread) {
        const id = getMediaStore().save(snap.data, snap.mime, `${entityId}.jpg`);
        if (id) {
          shown = `![${entityId}](${mediaLink(id)})`;
          ctx.attachments?.push(shown);
        }
      }
      return {
        camera: entityId,
        taken_at: new Date().toISOString(),
        description,
        ...(shown ? { image: shown, note: "The snapshot is shown to the user; put the image link in your answer." } : {}),
      };
    }

    case "get_statistics": {
      const ids = (Array.isArray(input.entity_ids) ? input.entity_ids : [input.entity_ids])
        .filter((v): v is string => typeof v === "string" && Boolean(v))
        .slice(0, 6);
      if (!ids.length) return { error: "get_statistics needs entity_ids." };
      const period = STAT_PERIODS.has(str("period")) ? (str("period") as "hour" | "day" | "week" | "month") : "day";
      const types = (Array.isArray(input.types) ? input.types : ["mean", "min", "max", "change"])
        .filter((t): t is string => typeof t === "string" && STAT_TYPES.has(t));
      const start = str("start_time");
      if (!start || Number.isNaN(new Date(start).getTime())) return { error: "start_time must be an ISO date." };
      const end = str("end_time") || undefined;
      const raw = await ha.getStatistics(ids, start, end, period, types.length ? types : ["mean", "change"]);
      const out: Record<string, unknown> = {};
      for (const id of ids) {
        const rows = raw[id] ?? [];
        const compact = rows.slice(-MAX_STAT_ROWS).map((r) => {
          const row: Record<string, unknown> = {
            start: typeof r.start === "number" ? new Date(r.start).toISOString() : r.start,
          };
          for (const t of types.length ? types : ["mean", "change"]) if (r[t] !== undefined && r[t] !== null) row[t] = round(r[t]);
          return row;
        });
        out[id] = rows.length > MAX_STAT_ROWS
          ? { rows: compact, note: `Only the last ${MAX_STAT_ROWS} of ${rows.length} rows; use a longer period.` }
          : compact.length
            ? compact
            : "no statistics (the sensor may have no state_class, or nothing was recorded in that range)";
      }
      return { period, statistics: out };
    }

    case "schedule_task": {
      const scheduler = getScheduler();
      if (!scheduler || !ctx.ownerId) return { error: "Scheduling is not available." };
      const tz = await scheduler.timeZone();
      const repeat = str("repeat") || "none";
      let schedule: Schedule;
      if (repeat === "daily") schedule = { type: "daily", time: str("time") };
      else if (repeat === "weekly") {
        const days = parseDays(input.days);
        if (!days.length) return { error: "A weekly item needs 'days'." };
        schedule = { type: "weekly", days, time: str("time") };
      } else {
        const num = (k: string) => (input[k] === undefined || input[k] === null || input[k] === "" ? undefined : Number(input[k]));
        const rel = { minutes: num("in_minutes"), hours: num("in_hours"), days: num("in_days"), time: str("time") || undefined };
        const when = str("when");
        let at: Date;
        if (rel.minutes !== undefined || rel.hours !== undefined || rel.days !== undefined || (rel.time && !when)) {
          at = relativeTime(rel, new Date(), tz);
        } else if (when) {
          at = parseWhen(when, tz);
        } else {
          return { error: "Give in_minutes / in_hours / in_days (and time), 'when', or a 'repeat'." };
        }
        schedule = { type: "once", at: at.toISOString() };
      }
      const kind = str("kind") === "task" ? "task" : "reminder";
      const task = await scheduler.add({ userId: ctx.ownerId, kind, text: str("text"), schedule });
      return {
        success: true,
        id: task.id,
        kind,
        ...(schedule.type === "once"
          ? { when: formatLocal(new Date(task.nextRunAt), tz) }
          : { schedule: describeSchedule(task.schedule, tz), next_run: formatLocal(new Date(task.nextRunAt), tz) }),
      };
    }

    case "notify_when": {
      const scheduler = getScheduler();
      if (!scheduler || !ctx.ownerId || !scheduler.canWatchStates) return { error: "Watching states is not available." };
      const entityId = str("entity_id");
      const op = str("condition") as ConditionOp;
      if (!["equals", "not_equals", "below", "above"].includes(op)) return { error: "condition must be equals, not_equals, below or above." };
      const value = str("value") || (typeof input.value === "number" ? String(input.value) : "");
      if (!value) return { error: "notify_when needs a value." };
      if ((op === "below" || op === "above") && !Number.isFinite(Number(value))) return { error: "below/above need a number." };
      // Reading it now checks the entity exists and is one Igor may see.
      const current = await ha.getState(entityId);
      const forMinutes = Math.min(720, Math.max(0, Number(input.for_minutes) || 0));
      const hours = Math.min(168, Math.max(0.1, Number(input.within_hours) || 24));
      const until = new Date(Date.now() + hours * 3_600_000).toISOString();
      const kind = str("kind") === "task" ? "task" : "reminder";
      const task = await scheduler.add({
        userId: ctx.ownerId,
        kind,
        text: str("text"),
        schedule: { type: "when", entityId, op, value, forMinutes, until },
      });
      const tz = await scheduler.timeZone();
      return {
        success: true,
        id: task.id,
        watching: describeSchedule(task.schedule, tz),
        current_state: current.state,
      };
    }

    case "send_notification": {
      const scheduler = getScheduler();
      if (!scheduler) return { error: "Notifications are not available." };
      const message = notificationText(str("message"));
      if (!message) return { error: "send_notification needs a message." };
      await scheduler.notifyNow(str("title").slice(0, 80) || "Igor", message);
      return { success: true, sent: true };
    }

    case "list_scheduled_tasks": {
      const scheduler = getScheduler();
      if (!scheduler || !ctx.ownerId) return { error: "Scheduling is not available." };
      const tz = await scheduler.timeZone();
      return scheduler.list(ctx.ownerId).map((t) => ({
        id: t.id,
        kind: t.kind,
        text: t.text,
        schedule: describeSchedule(t.schedule, tz),
        ...(t.schedule.type === "when" ? {} : { next_run: formatLocal(new Date(t.nextRunAt), tz) }),
        ...(t.builtin ? { builtin: "morning briefing, changed in the add-on options" } : {}),
      }));
    }

    case "cancel_scheduled_task": {
      const scheduler = getScheduler();
      if (!scheduler || !ctx.ownerId) return { error: "Scheduling is not available." };
      return scheduler.cancel(ctx.ownerId, str("id"))
        ? { success: true }
        : { error: "No such reminder or task (the morning briefing is changed in the add-on options)." };
    }

    case "get_config_item": {
      const entityId = str("entity_id");
      const [domain, objectId] = entityId.split(".");
      if (!objectId || !["automation", "script", "scene"].includes(domain)) {
        return { error: "entity_id must be an automation.*, script.* or scene.* entity." };
      }
      const notStored = `${entityId} is not stored by the UI editor (it is written in YAML elsewhere): find it with read_config_file.`;
      if (domain === "script") {
        try {
          return { entity_id: entityId, config: await ha.getScriptOrSceneConfig("script", objectId) };
        } catch {
          return { error: notStored };
        }
      }
      const entity = (await ha.getStatesForWatch(true)).find((s) => s.entity_id === entityId);
      if (!entity) return { error: `${entityId} does not exist.` };
      const id = entity.attributes.id;
      if (typeof id !== "string" && typeof id !== "number") return { error: notStored };
      try {
        const config = domain === "automation" ? await ha.getAutomationConfig(String(id)) : await ha.getScriptOrSceneConfig("scene", String(id));
        return { entity_id: entityId, config };
      } catch {
        return { error: notStored };
      }
    }

    case "get_automation_traces": {
      const automations = (await ha.listAutomations()).filter((a) => typeof a.attributes.id === "string");
      const nameOf = (itemId: string) => {
        const a = automations.find((x) => x.attributes.id === itemId);
        return a ? { entity_id: a.entity_id, name: (a.attributes.friendly_name as string) ?? a.entity_id } : { entity_id: undefined, name: itemId };
      };
      const entityId = str("entity_id");
      if (entityId) {
        const entity = automations.find((a) => a.entity_id === entityId);
        if (!entity) return { error: `${entityId} is not an automation stored by the UI editor (traces are kept for those with an id).` };
        const traces = await ha.getAutomationTraces(entity.attributes.id as string);
        return {
          entity_id: entityId,
          last_triggered: entity.attributes.last_triggered ?? null,
          runs: traces
            .sort((a, b) => String(b.timestamp?.start ?? "").localeCompare(String(a.timestamp?.start ?? "")))
            .map((t) => ({
              start: t.timestamp?.start,
              trigger: t.trigger ?? undefined,
              result: t.script_execution ?? t.state,
              last_step: t.last_step ?? undefined,
              ...(t.error ? { error: String(t.error).slice(0, 300) } : {}),
            })),
        };
      }
      const traces = await ha.getAutomationTraces();
      const byItem = new Map<string, typeof traces>();
      for (const t of traces) byItem.set(t.item_id, [...(byItem.get(t.item_id) ?? []), t]);
      const summary = [...byItem.entries()].map(([itemId, runs]) => {
        runs.sort((a, b) => String(b.timestamp?.start ?? "").localeCompare(String(a.timestamp?.start ?? "")));
        const errors = runs.filter((r) => r.script_execution === "error" || r.error);
        return {
          ...nameOf(itemId),
          runs_kept: runs.length,
          last_run: runs[0]?.timestamp?.start,
          last_result: runs[0]?.script_execution ?? runs[0]?.state,
          errors: errors.length,
          ...(errors[0]?.error ? { last_error: String(errors[0].error).slice(0, 200) } : {}),
        };
      });
      summary.sort((a, b) => b.errors - a.errors || String(b.last_run ?? "").localeCompare(String(a.last_run ?? "")));
      const never = automations
        .filter((a) => !byItem.has(a.attributes.id as string))
        .map((a) => a.entity_id)
        .slice(0, 60);
      return {
        automations_that_ran: summary.slice(0, 60),
        ...(never.length ? { no_run_since_restart: never } : {}),
        note: "Home Assistant keeps the last 5 runs per automation, since its last restart.",
      };
    }

    case "read_config_file":
      return readConfigFile(configDir, str("path"));

    case "check_ha_config": {
      const res = await ha.checkConfig();
      return { result: res.result, errors: res.errors ?? null, warnings: res.warnings ?? null };
    }
  }
  return { error: `Unknown tool: ${name}` };
}
