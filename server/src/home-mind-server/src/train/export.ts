/**
 * The training set for the local model, as one zip the panel downloads
 * (GET /api/local-dataset): train.jsonl and test.jsonl in the format
 * Axolotl's chat_template datasets read, a readable sample, and a README.
 */

import type { Config } from "../config.js";
import type { HomeAssistantClient } from "../ha/client.js";
import type { DeviceScanner } from "../ha/device-scanner.js";
import type { TopologyScanner } from "../ha/topology-scanner.js";
import { formatScriptSection } from "../ha/script-catalog.js";
import { writeZip } from "../files/zip.js";
import { localPersona } from "../llm/local-llm.js";
import { localToolList } from "../llm/openai-client.js";
import { readHouse, registryReader } from "./house-inventory.js";
import { buildLocalDataset, readableSample, toJsonl } from "./local-dataset.js";

const README = `Igor — training set for the local model

train.jsonl  examples to train on
test.jsonl   examples held out for the bench, phrased in ways training never sees
sample.txt   a few examples to read

Each line is one request as Igor sends it to the local model in tuned mode
(local_llm_tuned), followed by the answer the model should give: tool calls,
or "-" when the request is not about the home. Past messages are marked
"training": false, so only the model's own answers are learned.

This file describes your house (its rooms, devices and scenes). Keep it to
yourself; it is not needed once the model is trained.
`;

export async function buildDatasetZip(
  config: Config,
  ha: HomeAssistantClient,
  topology: TopologyScanner,
  scanner: DeviceScanner,
  size?: number
): Promise<{ zip: Buffer; counts: Record<string, number>; train: number; test: number; devices: number; technical: number }> {
  const { house, scripts, technical } = await readHouse(ha, topology, scanner, registryReader(config.haUrl, config.haToken));
  const dataset = buildLocalDataset(house, {
    persona: localPersona(config.localLlmPrompt),
    scriptSection: formatScriptSection(scripts),
    language: "fr",
    voiceGender: config.ttsVoiceGender,
    seed: Date.now() % 2147483647,
    size,
  });
  const tools = localToolList(true);
  const zip = writeZip([
    { name: "README.txt", data: Buffer.from(README) },
    { name: "train.jsonl", data: Buffer.from(toJsonl(dataset.train, tools)) },
    { name: "test.jsonl", data: Buffer.from(toJsonl(dataset.test, tools)) },
    { name: "sample.txt", data: Buffer.from(readableSample(dataset.train, 60)) },
  ]);
  return { zip, counts: dataset.counts, train: dataset.train.length, test: dataset.test.length, devices: house.devices.length, technical };
}
