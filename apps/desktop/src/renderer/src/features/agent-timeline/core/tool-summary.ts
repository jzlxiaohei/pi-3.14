import type { JsonValue } from "@pi-3.14/model";
import type { TimelineToolStatus } from "./types";

type JsonRecord = Record<string, JsonValue>;

export type ToolViewUpdate = {
  detail: string;
  diff: string | null;
  output: string | null;
  status: TimelineToolStatus;
  summary: string;
};

export function summarizeToolStart(toolName: string, args: JsonValue): Pick<ToolViewUpdate, "detail" | "summary"> {
  const path = firstString(args, ["path", "file", "filePath", "target_file", "command"]);
  const summary = actionLabel(toolName);
  return {
    summary,
    detail: path ? `${toolName} · ${path}` : toolName,
  };
}

export function summarizeToolUpdate(
  toolName: string,
  value: JsonValue,
  status: TimelineToolStatus,
): ToolViewUpdate {
  const output = extractOutput(value);
  const diff = extractDiff(value);
  return {
    status,
    summary: status === "running" ? runningLabel(toolName) : completedLabel(toolName, status),
    detail: extractDetail(toolName, value, output, diff),
    output,
    diff,
  };
}

export function formatJson(value: JsonValue): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function actionLabel(toolName: string): string {
  switch (toolName) {
    case "bash":
    case "Shell":
      return "Running command";
    case "read":
    case "Read":
    case "ReadFile":
      return "Reading file";
    case "edit":
    case "write":
    case "Edit":
    case "Write":
    case "ApplyPatch":
      return "Editing files";
    default:
      return `Using ${toolName}`;
  }
}

function runningLabel(toolName: string): string {
  return `${actionLabel(toolName)}...`;
}

function completedLabel(toolName: string, status: TimelineToolStatus): string {
  if (status === "error") return `${actionLabel(toolName)} failed`;
  switch (toolName) {
    case "bash":
    case "Shell":
      return "Command finished";
    case "read":
    case "Read":
    case "ReadFile":
      return "File read";
    case "edit":
    case "write":
    case "Edit":
    case "Write":
    case "ApplyPatch":
      return "Files updated";
    default:
      return `${toolName} finished`;
  }
}

function extractDetail(toolName: string, value: JsonValue, output: string | null, diff: string | null): string {
  const exitCode = firstNumber(value, ["exit_code", "exitCode", "code"]);
  const path = firstString(value, ["path", "file", "filePath", "target_file"]);
  if (exitCode !== null) return `${toolName} · exit ${exitCode}`;
  if (diff) return `${toolName} · patch available`;
  if (path) return `${toolName} · ${path}`;
  if (output) return compact(output);
  return toolName;
}

function extractOutput(value: JsonValue): string | null {
  const direct = firstString(value, [
    "output",
    "stdout",
    "stderr",
    "text",
    "content",
    "message",
    "error",
    "errorMessage",
    "partialResult",
  ]);
  if (direct) return direct;
  if (typeof value === "string") return value;
  return null;
}

function extractDiff(value: JsonValue): string | null {
  return firstString(value, ["patch", "diff", "details.patch", "details.diff"]);
}

function firstString(value: JsonValue, keys: string[]): string | null {
  for (const key of keys) {
    const found = lookup(value, key);
    if (typeof found === "string" && found.trim()) return found;
  }
  return null;
}

function firstNumber(value: JsonValue, keys: string[]): number | null {
  for (const key of keys) {
    const found = lookup(value, key);
    if (typeof found === "number") return found;
  }
  return null;
}

function lookup(value: JsonValue, key: string): JsonValue | undefined {
  const parts = key.split(".");
  let current: JsonValue | undefined = value;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compact(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 96 ? `${oneLine.slice(0, 93)}...` : oneLine;
}
