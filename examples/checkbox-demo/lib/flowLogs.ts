export type DemoFlowLogKind = "auth" | "request" | "response" | "webhook" | "poll" | "evaluation" | "registration";
export type DemoFlowLogDirection = "inbound" | "outbound" | "internal";

export type DemoFlowLog = {
  id: string;
  timestamp: string;
  kind: DemoFlowLogKind;
  direction: DemoFlowLogDirection;
  method?: string;
  source: string;
  target: string;
  status?: number;
  summary: string;
  request?: unknown;
  response?: unknown;
};

declare global {
  var __fonCheckboxDemoFlowLogs: DemoFlowLog[] | undefined;
}

const MAX_LOGS = 250;
const SECRET_KEYS = /authorization|cookie|credential|registrationsecret|secret|signature|token/i;
const logs = globalThis.__fonCheckboxDemoFlowLogs ?? [];
globalThis.__fonCheckboxDemoFlowLogs = logs;

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) return value.map((entry) => redact(entry, seen));
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    SECRET_KEYS.test(key) ? "[redacted]" : redact(entry, seen),
  ]));
}

export function appendFlowLog(input: Omit<DemoFlowLog, "id" | "timestamp">) {
  const entry: DemoFlowLog = {
    ...input,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    request: input.request === undefined ? undefined : redact(input.request),
    response: input.response === undefined ? undefined : redact(input.response),
  };
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  return entry;
}

export function listFlowLogs() {
  return logs.map((entry) => ({ ...entry }));
}

export function clearFlowLogs() {
  logs.length = 0;
}
