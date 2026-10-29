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
import { buildLocalDataset, readableSample, toJsonl } from "./local-dataset.js";

const README = `Igor — training set for the local model

train.jsonl  examples to train on
test.jsonl   examples held out for the bench, phrased in ways training never sees
sample.txt   a few examples to read

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
  size?: number
): Promise<{ zip: Buffer; counts: Record<string, number>; train: number; test: number; devices: number; technical: number }> {
  const read = await readHouse(house.ha, house.topology, house.scanner, registryReader(config.haUrl, config.haToken));
  const dataset = buildLocalDataset(read.house, {
    rules: config.localLlmPrompt,
    scriptSection: formatScriptSection(read.scripts),
    seed: Date.now() % 2147483647,
    size: size ?? datasetSize(read.house.devices.length),
  });
  const tools = localToolList(true);
  const zip = writeZip([
    { name: "README.txt", data: Buffer.from(README) },
    { name: "train.jsonl", data: Buffer.from(toJsonl(dataset.train, tools)) },
    { name: "test.jsonl", data: Buffer.from(toJsonl(dataset.test, tools)) },
    { name: "sample.txt", data: Buffer.from(readableSample(dataset.train, 80)) },
  ], { deflate: true });
  return { zip, counts: dataset.counts, train: dataset.train.length, test: dataset.test.length, devices: read.house.devices.length, technical: read.technical };
}
