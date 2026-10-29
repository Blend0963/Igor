/**
 * Just enough ZIP for office files and archives: reading (stored and
 * deflated entries, through the central directory) and writing (stored
 * entries). Office formats (docx, xlsx, pptx, odt…) are ZIP archives of XML,
 * so this is also what lets Igor read and write them without a dependency.
 *
 * Reading is bounded: an archive can claim anything in its headers, and a
 * small file can inflate to gigabytes, so the entry count and the inflated
 * size are capped and inflation itself is stopped at the remaining budget.
 */

import { deflateRawSync } from "node:zlib";
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface ZipLimits {
  /** Entries read at most. */
  maxEntries: number;
  /** Inflated bytes read at most, all entries together. */
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 500, maxTotalBytes: 50 * 1024 * 1024 };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The entries of an archive (directories left out), or throws on a malformed one. */
export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS, filter?: (name: string) => boolean): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP archive");
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count && entries.length < limits.maxEntries; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== CENTRAL) throw new Error("corrupt ZIP directory");
    const method = buf.readUInt16LE(ptr + 10);
    const compressed = buf.readUInt32LE(ptr + 20);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const local = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    ptr += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || (filter && !filter(name))) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOCAL) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, Math.min(buf.length, start + compressed));
    const budget = limits.maxTotalBytes - total;
    if (budget <= 0) break;
    let data: Buffer;
    try {
      if (method === 0) data = raw.subarray(0, Math.min(raw.length, budget));
      else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.min(budget, Math.max(size, 1)) });
      else continue; // encrypted or exotic compression
    } catch {
      continue; // over budget or corrupt: skip the entry, keep the rest
    }
    total += data.length;
    entries.push({ name, data });
  }
  return entries;
}

let crcTable: Uint32Array | undefined;
function crc32(data: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** An archive of stored (uncompressed) entries, or deflated ones with `deflate`. */
export function writeZip(entries: ZipEntry[], options: { deflate?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const method = options.deflate ? 8 : 0;
    const body = options.deflate ? deflateRawSync(entry.data, { level: 6 }) : entry.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
