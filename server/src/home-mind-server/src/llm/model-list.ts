/**
 * The models the panel's picker offers: the ones configured in the add-on,
 * and, on Mistral, every chat model of the account (GET /v1/models), read
 * once an hour. Deprecated models and dated duplicates of a "-latest" alias
 * are left out so the list stays short.
 */

import type { Config } from "../config.js";

export interface ModelChoice {
  id: string;
  /** What it is configured as in the add-on, when it is. */
  role?: "main" | "fast" | "memory";
  vision?: boolean;
}

export interface ModelChoices {
  main: string;
  fast?: string;
  models: ModelChoice[];
}

interface MistralModel {
  id?: string;
  aliases?: string[];
  deprecation?: string | null;
  capabilities?: { completion_chat?: boolean; function_calling?: boolean; vision?: boolean };
}

const TTL_MS = 60 * 60 * 1000;

export function createModelLister(config: Config, apiKey?: string): () => Promise<ModelChoices> {
  let cache: { at: number; models: ModelChoice[] } | undefined;
  const mistral = /api\.mistral\.ai/i.test(config.openaiBaseUrl ?? "");
  const configured: ModelChoice[] = [
    { id: config.llmModel, role: "main" },
    ...(config.fastModel ? [{ id: config.fastModel, role: "fast" as const }] : []),
    ...(config.extractionModel ? [{ id: config.extractionModel, role: "memory" as const }] : []),
  ];

  async function fromMistral(): Promise<ModelChoice[]> {
    if (!mistral || !apiKey) return [];
    if (cache && Date.now() - cache.at < TTL_MS) return cache.models;
    try {
      const res = await fetch(`${config.openaiBaseUrl?.replace(/\/$/, "")}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as { data?: MistralModel[] };
      const usable = (payload.data ?? []).filter(
        (m) => m.id && m.capabilities?.completion_chat && m.capabilities?.function_calling && !m.deprecation
      );
      // "-latest" aliases first; a dated id hidden behind one is dropped.
      const aliased = new Set(usable.flatMap((m) => (m.id!.endsWith("-latest") ? [] : (m.aliases ?? []))));
      const ids = new Map<string, ModelChoice>();
      for (const m of usable) {
        const latest = [m.id!, ...(m.aliases ?? [])].find((a) => a.endsWith("-latest"));
        const id = latest ?? m.id!;
        if (!latest && aliased.has(id)) continue;
        if (!ids.has(id)) ids.set(id, { id, vision: Boolean(m.capabilities?.vision) });
      }
      cache = { at: Date.now(), models: [...ids.values()].sort((a, b) => a.id.localeCompare(b.id)) };
      return cache.models;
    } catch (error) {
      console.warn("[models] could not list Mistral models:", error instanceof Error ? error.message : error);
      return [];
    }
  }

  return async () => {
    const listed = await fromMistral();
    const byId = new Map<string, ModelChoice>(listed.map((m) => [m.id, m]));
    for (const c of configured) byId.set(c.id, { ...byId.get(c.id), ...c });
    const models = [...byId.values()].sort((a, b) => (a.role ? 0 : 1) - (b.role ? 0 : 1) || a.id.localeCompare(b.id));
    return { main: config.llmModel, ...(config.fastModel ? { fast: config.fastModel } : {}), models };
  };
}
