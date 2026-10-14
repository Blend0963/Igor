/**
 * Handlers of the 0.8 home tools (definitions in tool-definitions.ts):
 * look_at_camera, get_statistics, and the scheduling tools.
 */

import type { HomeAssistantClient } from "../ha/client.js";
import { getVision } from "./vision.js";
import { getMediaStore, mediaLink } from "./media-store.js";
import { describeSchedule, getScheduler, parseDays, parseWhen, type Schedule } from "../jobs/scheduler.js";

export const HOME_TOOL_NAMES = new Set(["look_at_camera", "get_statistics", "schedule_task", "list_scheduled_tasks", "cancel_scheduled_task"]);

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
        const when = str("when");
        if (!when) return { error: "Give 'when' (YYYY-MM-DDTHH:MM) or a 'repeat'." };
        schedule = { type: "once", at: parseWhen(when, tz).toISOString() };
      }
      const kind = str("kind") === "task" ? "task" : "reminder";
      const task = await scheduler.add({ userId: ctx.ownerId, kind, text: str("text"), schedule });
      return {
        success: true,
        id: task.id,
        kind,
        schedule: describeSchedule(task.schedule, tz),
        next_run: new Date(task.nextRunAt).toLocaleString("fr-FR", { timeZone: tz }),
      };
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
        next_run: new Date(t.nextRunAt).toLocaleString("fr-FR", { timeZone: tz }),
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
  }
  return { error: `Unknown tool: ${name}` };
}
