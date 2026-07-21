import {
  PI_SESSION_ENTRY_TYPES,
  type PiJsonObject,
  type PiSessionDiagnostic,
  type PiSessionEntrySnapshot,
  type PiSessionHeaderSnapshot,
  type PiSessionIndex,
  type PiSessionSnapshot,
} from "./types.js";

const MIN_SUPPORTED_VERSION = 2;
const CURRENT_SUPPORTED_VERSION = 3;
const KNOWN_ENTRY_TYPES = new Set<string>(PI_SESSION_ENTRY_TYPES);

export interface ParsePiSessionOptions {
  /**
   * A malformed final non-newline-terminated line is treated as an in-flight
   * append. Set false when parsing an immutable artifact.
   */
  allowIncompleteTail?: boolean;
}

export function parsePiSessionJsonl(
  content: string,
  options: ParsePiSessionOptions = {},
): PiSessionSnapshot {
  const allowIncompleteTail = options.allowIncompleteTail ?? true;
  const endsWithNewline = content.endsWith("\n");
  const lines = content.split("\n");
  const diagnostics: PiSessionDiagnostic[] = [];
  const entries: PiSessionEntrySnapshot[] = [];
  let header: PiSessionHeaderSnapshot | null = null;
  let trailingFragment = "";

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const sourceLine = index + 1;
    if (!line.trim()) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      const isIncompleteTail =
        allowIncompleteTail && !endsWithNewline && index === lines.length - 1;
      if (isIncompleteTail) {
        trailingFragment = line;
        diagnostics.push({
          code: "incomplete_tail",
          severity: "info",
          message: "Ignored an incomplete final JSONL record while the session may still be appending.",
          sourceLine,
        });
      } else {
        diagnostics.push({
          code: "malformed_line",
          severity: "error",
          message: "Session JSONL contains malformed JSON.",
          sourceLine,
        });
      }
      continue;
    }

    if (!isJsonObject(value) || typeof value.type !== "string") {
      diagnostics.push({
        code: "invalid_record",
        severity: "error",
        message: "Session JSONL record must be an object with a string type.",
        sourceLine,
      });
      continue;
    }

    if (value.type === "session") {
      const parsedHeader = parseHeader(value, sourceLine, diagnostics);
      if (!parsedHeader) continue;
      if (header) {
        diagnostics.push({
          code: "duplicate_header",
          severity: "error",
          message: "Session JSONL contains more than one session header.",
          sourceLine,
        });
      } else {
        header = parsedHeader;
      }
      continue;
    }

    const entry = parseEntry(value, sourceLine, diagnostics);
    if (entry) entries.push(entry);
  }

  if (!header) {
    diagnostics.push({
      code: "missing_header",
      severity: "error",
      message: "Session JSONL has no valid session header.",
    });
  }
  const structure = analyzeStructure(entries);
  diagnostics.push(...structure.diagnostics);

  return {
    format: "pi-session",
    header,
    entries,
    leafId: entries.at(-1)?.id ?? null,
    rootIds: structure.rootIds,
    activePathEntryIds: structure.activePathEntryIds,
    diagnostics,
    trailingFragment,
  };
}

export function buildPiSessionIndex(snapshot: PiSessionSnapshot): PiSessionIndex {
  const byId = new Map<string, PiSessionEntrySnapshot>();
  const childrenById = new Map<string | null, PiSessionEntrySnapshot[]>();
  const appendIndexById = new Map<string, number>();
  for (const [index, entry] of snapshot.entries.entries()) {
    if (!byId.has(entry.id)) {
      byId.set(entry.id, entry);
      appendIndexById.set(entry.id, index);
    }
    const children = childrenById.get(entry.parentId) ?? [];
    children.push(entry);
    childrenById.set(entry.parentId, children);
  }
  return { byId, childrenById, appendIndexById };
}

function parseHeader(
  raw: PiJsonObject,
  sourceLine: number,
  diagnostics: PiSessionDiagnostic[],
): PiSessionHeaderSnapshot | null {
  if (
    typeof raw.id !== "string" ||
    typeof raw.timestamp !== "string" ||
    typeof raw.cwd !== "string"
  ) {
    diagnostics.push({
      code: "invalid_record",
      severity: "error",
      message: "Session header requires string id, timestamp, and cwd fields.",
      sourceLine,
    });
    return null;
  }
  const version = typeof raw.version === "number" ? raw.version : null;
  if (
    version === null ||
    version < MIN_SUPPORTED_VERSION ||
    version > CURRENT_SUPPORTED_VERSION
  ) {
    diagnostics.push({
      code: "unsupported_version",
      severity: "warning",
      message:
        version === null
          ? "Legacy session format v1 has no version field and must be migrated by PI before structural analysis."
          : `Session format version ${version} is outside the supported range ${MIN_SUPPORTED_VERSION}-${CURRENT_SUPPORTED_VERSION}.`,
      sourceLine,
    });
  }
  return {
    type: "session",
    version,
    id: raw.id,
    timestamp: raw.timestamp,
    cwd: raw.cwd,
    parentSessionPath: typeof raw.parentSession === "string" ? raw.parentSession : null,
    raw,
    sourceLine,
  };
}

function parseEntry(
  raw: PiJsonObject,
  sourceLine: number,
  diagnostics: PiSessionDiagnostic[],
): PiSessionEntrySnapshot | null {
  if (
    typeof raw.id !== "string" ||
    (raw.parentId !== null && typeof raw.parentId !== "string") ||
    typeof raw.timestamp !== "string"
  ) {
    diagnostics.push({
      code: "invalid_record",
      severity: "error",
      message: "Session entry requires string id/timestamp and string|null parentId.",
      sourceLine,
    });
    return null;
  }
  return {
    type: String(raw.type),
    id: raw.id,
    parentId: raw.parentId,
    timestamp: raw.timestamp,
    known: KNOWN_ENTRY_TYPES.has(String(raw.type)),
    raw,
    sourceLine,
  };
}

function analyzeStructure(entries: PiSessionEntrySnapshot[]): {
  rootIds: string[];
  activePathEntryIds: string[];
  diagnostics: PiSessionDiagnostic[];
} {
  const diagnostics: PiSessionDiagnostic[] = [];
  const byId = new Map<string, PiSessionEntrySnapshot>();
  const rootIds: string[] = [];

  for (const entry of entries) {
    if (byId.has(entry.id)) {
      diagnostics.push({
        code: "duplicate_entry_id",
        severity: "error",
        message: `Duplicate session entry id: ${entry.id}.`,
        sourceLine: entry.sourceLine,
        entryId: entry.id,
      });
      continue;
    }
    byId.set(entry.id, entry);
  }

  for (const entry of entries) {
    if (entry.parentId === null) {
      rootIds.push(entry.id);
    } else if (!byId.has(entry.parentId)) {
      rootIds.push(entry.id);
      diagnostics.push({
        code: "missing_parent",
        severity: "error",
        message: `Entry ${entry.id} references missing parent ${entry.parentId}.`,
        sourceLine: entry.sourceLine,
        entryId: entry.id,
        relatedEntryIds: [entry.parentId],
      });
    }
  }
  if (rootIds.length > 1) {
    diagnostics.push({
      code: "multiple_roots",
      severity: "warning",
      message: `Session entry graph has ${rootIds.length} roots/components.`,
      relatedEntryIds: rootIds,
    });
  }

  const activePathEntryIds: string[] = [];
  const activeSeen = new Set<string>();
  let cursor = entries.at(-1);
  while (cursor) {
    if (activeSeen.has(cursor.id)) {
      diagnostics.push({
        code: "cycle",
        severity: "error",
        message: `Cycle detected while resolving active path at entry ${cursor.id}.`,
        entryId: cursor.id,
      });
      break;
    }
    activeSeen.add(cursor.id);
    activePathEntryIds.push(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  activePathEntryIds.reverse();

  detectAnyCycles(byId, diagnostics);
  return { rootIds: [...new Set(rootIds)], activePathEntryIds, diagnostics };
}

function detectAnyCycles(
  byId: ReadonlyMap<string, PiSessionEntrySnapshot>,
  diagnostics: PiSessionDiagnostic[],
): void {
  const done = new Set<string>();
  const reported = new Set<string>();
  for (const entry of byId.values()) {
    if (done.has(entry.id)) continue;
    const path: string[] = [];
    const positions = new Map<string, number>();
    let cursor: PiSessionEntrySnapshot | undefined = entry;
    while (cursor && !done.has(cursor.id)) {
      const position = positions.get(cursor.id);
      if (position !== undefined) {
        const cycleIds = path.slice(position);
        const key = [...cycleIds].sort().join(":");
        if (!reported.has(key)) {
          reported.add(key);
          diagnostics.push({
            code: "cycle",
            severity: "error",
            message: `Session entry graph contains a cycle: ${cycleIds.join(" -> ")}.`,
            entryId: cursor.id,
            relatedEntryIds: cycleIds,
          });
        }
        break;
      }
      positions.set(cursor.id, path.length);
      path.push(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    for (const id of path) done.add(id);
  }
}

function isJsonObject(value: unknown): value is PiJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
