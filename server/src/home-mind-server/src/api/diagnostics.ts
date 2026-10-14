/**
 * The panel's diagnostic: one pass over everything MaDo depends on, each
 * check reported as ok / failed with the provider's own message, so a setup
 * problem is visible without reading the add-on log.
 *
 * Free checks run every time (they list models or read state). The paid
 * ones (a one-page OCR, a short speech synthesis and its transcription back)
 * only run when asked, and their cost is stated in the panel.
 */

import type { Config } from "../config.js";
import type { HomeAssistantClient } from "../ha/client.js";
import type { IMemoryStore } from "../memory/interface.js";
import type { ITtsService } from "../tts/tts-service.js";
import type { ISttService } from "../stt/stt-service.js";
import { mistralKey, ocrDocument } from "../llm/mistral-platform.js";
import { buildPdf } from "../files/create.js";
import { listFromEnv } from "../llm/mistral-platform.js";

export interface DiagnosticResult {
  name: string;
  ok: boolean;
  detail: string;
  /** Not run (not configured, or a paid check not asked for). */
  skipped?: boolean;
}

interface Deps {
  config: Config;
  ha: HomeAssistantClient;
  memory: IMemoryStore;
  tts?: ITtsService;
  stt?: ISttService;
}

async function check(name: string, fn: () => Promise<string>): Promise<DiagnosticResult> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (error) {
    return { name, ok: false, detail: (error instanceof Error ? error.message : String(error)).slice(0, 400) };
  }
}

const skip = (name: string, detail: string): DiagnosticResult => ({ name, ok: true, skipped: true, detail });

async function mistralGet(key: string, path: string): Promise<unknown> {
  const res = await fetch(`https://api.mistral.ai/v1${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.json();
}

export function createDiagnostics(deps: Deps): (paid: boolean) => Promise<DiagnosticResult[]> {
  return async (paid) => {
    const { config, ha, memory } = deps;
    const key = mistralKey();
    const results: DiagnosticResult[] = [];

    results.push(await check("Home Assistant", async () => {
      const cfg = await ha.getConfig();
      return `connecté${cfg.location_name ? ` (${cfg.location_name})` : ""}, fuseau ${cfg.time_zone ?? "inconnu"}`;
    }));
    results.push(await check("Mémoire (Shodh)", async () => {
      if (!(await memory.isHealthy())) throw new Error("Shodh ne répond pas");
      return "en ligne";
    }));

    let models: string[] = [];
    if (key) {
      results.push(await check("Clé Mistral", async () => {
        const list = (await mistralGet(key, "/models")) as { data?: { id?: string }[] };
        models = (list.data ?? []).map((m) => m.id ?? "").filter(Boolean);
        return `valide, ${models.length} modèles accessibles`;
      }));
      for (const [label, model] of [
        ["Modèle principal", config.llmModel],
        ["Modèle rapide", config.fastModel],
        ["Modèle mémoire", config.extractionModel],
      ] as const) {
        if (!model) continue;
        const isMistral = /api\.mistral\.ai/i.test(config.openaiBaseUrl ?? "");
        if (!isMistral || !models.length) continue;
        results.push(
          models.includes(model)
            ? { name: label, ok: true, detail: `${model} disponible` }
            : { name: label, ok: false, detail: `${model} introuvable sur ce compte Mistral (vérifie le nom)` }
        );
      }
      const libraries = listFromEnv(process.env.MISTRAL_LIBRARY_IDS);
      if (libraries.length) {
        results.push(await check("Bibliothèques de documents", async () => {
          for (const id of libraries) await mistralGet(key, `/libraries/${encodeURIComponent(id)}`);
          return `${libraries.length} accessible(s)`;
        }));
      }
      const connectors = listFromEnv(process.env.MISTRAL_CONNECTORS);
      if (connectors.length) results.push(skip("Connecteurs", `${connectors.join(", ")} : testés au premier usage`));
    } else {
      results.push(skip("Clé Mistral", "non configurée : recherche web, outils Mistral, OCR et voix désactivés"));
    }

    if (!paid) {
      results.push(skip("OCR (PDF scannés)", "test payant non lancé"));
      results.push(skip("Voix (Voxtral)", "test payant non lancé"));
      return results;
    }

    if (key) {
      results.push(await check("OCR (PDF scannés)", async () => {
        const pdf = buildPdf("# Test MaDo\n\nBonjour, ceci est un test de lecture.");
        const text = await ocrDocument(key, `data:application/pdf;base64,${pdf.toString("base64")}`);
        if (!/test/i.test(text)) throw new Error(`réponse inattendue : ${text.slice(0, 120)}`);
        return "lecture OK (1 page facturée)";
      }));
    } else results.push(skip("OCR (PDF scannés)", "clé Mistral non configurée"));

    if (deps.tts) {
      let audio: Buffer | undefined;
      results.push(await check("Voix (synthèse)", async () => {
        audio = await deps.tts!.synthesize("Bonjour, ceci est un test de MaDo.", "fr");
        if (audio.length < 1000) throw new Error(`audio trop court (${audio.length} octets)`);
        return `${Math.round(audio.length / 1024)} Ko d'audio`;
      }));
      if (audio && deps.stt) {
        results.push(await check("Micro (transcription)", async () => {
          const text = await deps.stt!.transcribe(audio!, "audio/mpeg", "test.mp3", "fr");
          if (!/test|bonjour/i.test(text)) throw new Error(`transcription inattendue : « ${text.slice(0, 80)} »`);
          return `« ${text.trim().slice(0, 60)} »`;
        }));
      }
    } else results.push(skip("Voix (synthèse)", "text_to_speech non activé"));

    return results;
  };
}
