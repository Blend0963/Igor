/**
 * Builds the training set away from Home Assistant, from the maison.json a
 * panel download contains, plus an optional phrasebook:
 *
 *   npx tsx src/train/build-from-house.ts maison.json [igor-phrases.txt] [out.zip] [size]
 *
 * The zip is the same as the panel's, without the real requests (they stay
 * in the add-on).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { writeZip } from "../files/zip.js";
import { localToolList } from "../llm/openai-client.js";
import { buildLocalDataset, deviceList, readableSample, toJsonl, type HouseInventory } from "./local-dataset.js";
import { parsePhrasebook } from "./phrasebook.js";
import { datasetSize } from "./export.js";

const [housePath, phrasesPath, outPath = "igor-local-dataset.zip", sizeArg] = process.argv.slice(2);
if (!housePath) {
  console.error("usage: build-from-house.ts maison.json [igor-phrases.txt] [out.zip] [size]");
  process.exit(1);
}
const saved = JSON.parse(readFileSync(housePath, "utf8")) as { house: HouseInventory; rules: string | null; scriptSection: string | null };
const known = new Set(saved.house.devices.map((d) => d.id).concat(saved.house.scripts.map((s) => s.id)));
const book = phrasesPath && phrasesPath !== "-" ? parsePhrasebook(readFileSync(phrasesPath, "utf8"), known) : { phrases: [], errors: [] };
const dataset = buildLocalDataset(saved.house, {
  rules: saved.rules ?? undefined,
  scriptSection: saved.scriptSection ?? undefined,
  seed: Date.now() % 2147483647,
  size: sizeArg ? Number(sizeArg) : datasetSize(saved.house.devices.length),
  phrases: book.phrases,
});
const tools = localToolList(true);
writeFileSync(outPath, writeZip([
  { name: "train.jsonl", data: Buffer.from(toJsonl(dataset.train, tools)) },
  { name: "test.jsonl", data: Buffer.from(toJsonl(dataset.test, tools)) },
  { name: "sample.txt", data: Buffer.from(readableSample(dataset.train, 80)) },
  { name: "appareils.txt", data: Buffer.from(deviceList(saved.house)) },
  ...(book.errors.length ? [{ name: "phrases-erreurs.txt", data: Buffer.from(`${book.errors.join("\n")}\n`) }] : []),
], { deflate: true }));
console.log(`${outPath}: ${dataset.train.length} training, ${dataset.test.length} test examples ${JSON.stringify(dataset.counts)}`);
if (book.errors.length) console.log(`phrasebook errors:\n${book.errors.join("\n")}`);
