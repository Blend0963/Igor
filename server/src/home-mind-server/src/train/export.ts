/**
 * The training set for the local model, as one zip the panel downloads to
 * the browser (GET /api/local-dataset; nothing is kept on the server):
 * train.jsonl and test.jsonl, a readable sample, and a README.
 */

import type { Config } from "../config.js";
import type { HomeAssistantClient } from "../ha/client.js";
import type { DeviceScanner } from "../ha/device-scanner.js";
import type { TopologyScanner } from "../ha/topology-scanner.js";
import { formatScriptSection } from "../ha/script-catalog.js";
import { writeZip } from "../files/zip.js";
import { localToolList } from "../llm/openai-client.js";
import { readHouse, registryReader } from "./house-inventory.js";
import { buildLocalDataset, deviceList, readableSample, reviewList, toJsonl } from "./local-dataset.js";
import type { TurnLog } from "./turn-log.js";
import { parsePhrasebook } from "./phrasebook.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const README = `Igor — training set for the local model

train.jsonl  examples to train on
test.jsonl   examples held out for the bench, phrased in ways training never sees
sample.txt   a few examples to read
a-revoir.txt your real requests that failed or that you corrected (not trained on)
appareils.txt the devices the training set knows (id, name, room, aliases), to write
             your own phrases in igor-phrases.txt, in Home Assistant's config folder

Each line is one request as Igor sends it to the local model in tuned mode
(local_llm_tuned), followed by the answer it should give: tool calls and one
line for Igor's voice ("-", ">rep", ">dire", ">web", ">libre", ">demande").
Past messages are marked "training": false, so only the model's own answers
are learned.

This file describes your house (its rooms, devices and scenes). Keep it to
yourself; it is not needed once the model is trained.
`;

/** Enough examples for every device to come up several times, within what a rented card trains in an hour or two. */
export function datasetSize(devices: number): number {
  return Math.min(20000, Math.max(4000, devices * 8));
}

export async function buildDatasetZip(
  config: Config,
  house: { ha: HomeAssistantClient; topology: TopologyScanner; scanner: DeviceScanner },
  size?: number,
  turnLog?: TurnLog
): Promise<{ zip: Buffer; counts: Record<string, number>; train: number; test: number; devices: number; technical: number; unspeakable: number; used: number }> {
  // What a person really switches: the logbook's last 30 days, plus the
  // requests the local model carried out.
  const usage = await house.ha.getPersonUsage().catch((error) => {
    console.warn(`[dataset] logbook unavailable, no usage weighting from it: ${error instanceof Error ? error.message : error}`);
    return new Map<string, number>();
  });
  for (const [id, n] of turnLog?.usage() ?? []) usage.set(id, (usage.get(id) ?? 0) + n);
  const read = await readHouse(house.ha, house.topology, house.scanner, registryReader(config.haUrl, config.haToken), usage);
  const real = turnLog?.read() ?? [];
  // The owner's own phrases, if they wrote some: /config/igor-phrases.txt.
  const phrasebookPath = path.join(config.haConfigDir, "igor-phrases.txt");
  const book = existsSync(phrasebookPath)
    ? parsePhrasebook(readFileSync(phrasebookPath, "utf8"), new Set(read.house.devices.map((d) => d.id).concat(read.scripts.map((s) => s.id))))
    : { phrases: [], errors: [] };
  const dataset = buildLocalDataset(read.house, {
    rules: config.localLlmPrompt,
    scriptSection: formatScriptSection(read.scripts),
    seed: Date.now() % 2147483647,
    size: size ?? datasetSize(read.house.devices.length),
    real,
    phrases: book.phrases,
  });
  const tools = localToolList(true);
  const zip = writeZip([
    { name: "README.txt", data: Buffer.from(README) },
    { name: "train.jsonl", data: Buffer.from(toJsonl(dataset.train, tools)) },
    { name: "test.jsonl", data: Buffer.from(toJsonl(dataset.test, tools)) },
    { name: "sample.txt", data: Buffer.from(readableSample(dataset.train, 80)) },
    { name: "a-revoir.txt", data: Buffer.from(reviewList(real)) },
    { name: "appareils.txt", data: Buffer.from(deviceList(read.house)) },
    ...(book.errors.length ? [{ name: "phrases-erreurs.txt", data: Buffer.from(`${book.errors.join("\n")}\n`) }] : []),
  ], { deflate: true });
  const used = read.house.devices.filter((d) => d.usage).length;
  return { zip, counts: dataset.counts, train: dataset.train.length, test: dataset.test.length, devices: read.house.devices.length, technical: read.technical, unspeakable: read.unspeakable, used };
}
