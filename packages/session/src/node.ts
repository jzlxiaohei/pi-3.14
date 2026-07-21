import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parsePiSessionJsonl, type ParsePiSessionOptions } from "./parser.js";
import type { PiSessionSnapshot } from "./types.js";

export async function readPiSessionFile(
  sessionPath: string,
  options?: ParsePiSessionOptions,
): Promise<PiSessionSnapshot> {
  return parsePiSessionJsonl(await readFile(sessionPath, "utf8"), options);
}

export function readPiSessionFileSync(
  sessionPath: string,
  options?: ParsePiSessionOptions,
): PiSessionSnapshot {
  return parsePiSessionJsonl(readFileSync(sessionPath, "utf8"), options);
}
