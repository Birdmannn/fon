import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { collection, usesDatabase } from "@/lib/database";

import {
  buildSelectedPrinciple,
  createHostedAppSdk,
  type EvaluateMountableAppPrincipleRequest,
  type MountableAppPrincipleDefinition,
  type MountableAppPrincipleSelection,
  type MountableJsonObject,
  type MountedAppPrincipleState,
  type RegisteredMountableAppManifest,
} from "@/lib/fonSdk";

export type DemoCheckboxId = "profile" | "terms" | "email" | "launch";

export type DemoParticipantState = {
  externalUserId: string;
  participantAddress: string;
  checked: DemoCheckboxId[];
  submittedText: string;
  updatedAt: string;
};

export type DemoInstallation = {
  installationId: string;
  mountableInstanceId: string;
  campaignId: string;
  sharedSecret: string;
  updateWebhookUrl: string;
  validFrom: string;
  validUntil: string;
  timeframeSeconds: number;
  selectedPrinciples: MountableAppPrincipleSelection[];
};

export const appId = "fon-checkbox-demo";
export const appName = "FON Checkbox Demo";

export const checkboxCatalog: Array<{
  id: DemoCheckboxId;
  label: string;
  description: string;
}> = [
  {
    id: "profile",
    label: "Profile connected",
    description: "The demo user completed the lightweight profile step.",
  },
  {
    id: "terms",
    label: "Terms accepted",
    description: "The demo user accepted the sample participation terms.",
  },
  {
    id: "email",
    label: "Email confirmed",
    description: "The demo user toggled a pretend email confirmation.",
  },
  {
    id: "launch",
    label: "Launch task done",
    description: "The demo user completed the pretend launch-day task.",
  },
];

const checkboxOptions = checkboxCatalog.map((checkbox) => ({
  value: checkbox.id,
  label: checkbox.label,
  description: checkbox.description,
}));

const principleDefinitions: MountableAppPrincipleDefinition[] = [
  {
    principleId: "demo-checkbox-completed",
    title: "Checkbox Completed",
    description: "Requires one configured demo checkbox to be checked by the participant.",
    supportsTimestampQuery: false,
    paramsSchema: [
      {
        paramKey: "checkbox-id",
        title: "Checkbox",
        description: "The checkbox that must be checked.",
        valueType: "enum",
        required: true,
        defaultValue: "profile",
        enumOptions: checkboxOptions,
      },
    ],
    paramsDefaults: {
      "checkbox-id": "profile",
    },
    readableFormat: "Complete checkbox: {checkbox-id}",
    exampleReadableText: "Complete checkbox: profile",
  },
  {
    principleId: "demo-checkbox-count-at-least",
    title: "Minimum Checkboxes Completed",
    description: "Requires the participant to check at least a configured number of demo boxes.",
    supportsTimestampQuery: false,
    paramsSchema: [
      {
        paramKey: "min-completed",
        title: "Minimum completed",
        description: "How many boxes must be checked.",
        valueType: "number",
        required: true,
        defaultValue: 2,
        minimum: 1,
        maximum: checkboxCatalog.length,
        step: 1,
      },
    ],
    paramsDefaults: {
      "min-completed": 2,
    },
    readableFormat: "Check at least {min-completed} boxes",
    exampleReadableText: "Check at least 2 boxes",
  },
  {
    principleId: "demo-checkbox-set-completed",
    title: "Checkbox Set Completed",
    description: "Requires every checkbox in a named demo set to be checked.",
    supportsTimestampQuery: false,
    paramsSchema: [
      {
        paramKey: "required-set",
        title: "Required set",
        description: "The named set of checkboxes the participant must complete.",
        valueType: "enum",
        required: true,
        defaultValue: "starter",
        enumOptions: [
          {
            value: "starter",
            label: "Starter",
            description: "Profile connected and terms accepted.",
          },
          {
            value: "activation",
            label: "Activation",
            description: "Profile, terms, and launch task completed.",
          },
          {
            value: "all",
            label: "All checkboxes",
            description: "Every demo checkbox is checked.",
          },
        ],
      },
    ],
    paramsDefaults: {
      "required-set": "starter",
    },
    readableFormat: "Complete checkbox set: {required-set}",
    exampleReadableText: "Complete checkbox set: starter",
  },
  {
    principleId: "demo-exact-text-match",
    title: "Exact Text Match",
    description: "Requires the participant to type the exact text configured by the freight creator.",
    supportsTimestampQuery: false,
    paramsSchema: [
      {
        paramKey: "target-text",
        title: "Required text",
        description: "The exact text the participant must enter.",
        valueType: "string",
        required: true,
        defaultValue: "freight",
        placeholder: "Enter the required text",
      },
    ],
    paramsDefaults: {
      "target-text": "freight",
    },
    readableFormat: "Type exactly: {target-text}",
    exampleReadableText: "Type exactly: freight",
  },
];

declare global {
  var __fonCheckboxDemoParticipantStates: Map<string, DemoParticipantState> | undefined;
  var __fonCheckboxDemoInstallations: Map<string, DemoInstallation> | undefined;
  var __fonCheckboxDemoRegistrationSecret: string | undefined;
}

const participantStates = globalThis.__fonCheckboxDemoParticipantStates ?? new Map<string, DemoParticipantState>();
globalThis.__fonCheckboxDemoParticipantStates = participantStates;
const installations = globalThis.__fonCheckboxDemoInstallations ?? new Map<string, DemoInstallation>();
globalThis.__fonCheckboxDemoInstallations = installations;

const registrationCredentialPath = process.env.FON_REGISTRATION_CREDENTIAL_PATH?.trim()
  || join(process.cwd(), ".fon", "registration.json");
const installationsPath = join(dirname(registrationCredentialPath), "installations.json");

if (!usesDatabase() && installations.size === 0) {
  try {
    const stored = JSON.parse(readFileSync(installationsPath, "utf8")) as unknown;
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (entry && typeof entry === "object"
          && typeof entry.mountableInstanceId === "string"
          && typeof entry.sharedSecret === "string") {
          installations.set(entry.mountableInstanceId, entry as DemoInstallation);
        }
      }
    }
  } catch {
    // A fresh demo has no saved installations yet.
  }
}

function persistInstallations() {
  if (usesDatabase()) return;
  mkdirSync(dirname(installationsPath), { recursive: true, mode: 0o700 });
  writeFileSync(installationsPath, `${JSON.stringify([...installations.values()], null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

if (!usesDatabase() && installations.size > 0) persistInstallations();

export function getRegistrationSecret() {
  const configured = process.env.FON_REGISTRATION_SECRET?.trim();
  if (configured) {
    return configured;
  }

  const cached = globalThis.__fonCheckboxDemoRegistrationSecret?.trim();
  if (cached) {
    return cached;
  }

  try {
    const credential = JSON.parse(readFileSync(registrationCredentialPath, "utf8")) as {
      appId?: unknown;
      registrationSecret?: unknown;
    };
    const persistedSecret = credential.appId === appId && typeof credential.registrationSecret === "string"
      ? credential.registrationSecret.trim()
      : "";
    if (persistedSecret) {
      globalThis.__fonCheckboxDemoRegistrationSecret = persistedSecret;
    }
    return persistedSecret;
  } catch {
    return "";
  }
}

export function setRegistrationSecret(secret: string) {
  const normalized = secret.trim();
  globalThis.__fonCheckboxDemoRegistrationSecret = normalized;
  if (!normalized || process.env.FON_REGISTRATION_SECRET?.trim()) {
    return;
  }

  mkdirSync(dirname(registrationCredentialPath), { recursive: true, mode: 0o700 });
  writeFileSync(
    registrationCredentialPath,
    `${JSON.stringify({ appId, registrationSecret: normalized }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

export function isValidRegistrationSecret(request: Request) {
  const expected = getRegistrationSecret();
  const supplied = request.headers.get("x-fon-registration-secret")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
    || "";
  return Boolean(expected) && supplied === expected;
}

export async function saveInstallation(installation: DemoInstallation) {
  if (usesDatabase()) {
    const records = await collection<DemoInstallation & { _id: string }>("installations");
    await records.replaceOne({ _id: installation.mountableInstanceId }, installation, { upsert: true });
    return;
  }
  installations.set(installation.mountableInstanceId, installation);
  persistInstallations();
}

export async function listInstallations() {
  if (usesDatabase()) {
    const records = await collection<DemoInstallation & { _id: string }>("installations");
    return records.find().sort({ validFrom: 1 }).toArray();
  }
  return Array.from(installations.values());
}

export function activateInstallation(input: {
  mountableInstanceId: string;
  campaignId: string;
  validFrom: string;
  validUntil: string;
  timeframeSeconds: number;
  selectedPrinciples: MountableAppPrincipleSelection[];
}) {
  const existing = installations.get(input.mountableInstanceId);
  if (!existing) {
    return false;
  }
  installations.set(input.mountableInstanceId, { ...existing, ...input });
  persistInstallations();
  return true;
}

export function installationIsActive(installation: DemoInstallation, at = new Date()) {
  const startsAt = new Date(installation.validFrom).getTime();
  const endsAt = new Date(installation.validUntil).getTime();
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && at.getTime() >= startsAt && at.getTime() < endsAt;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeParticipantKey(request: Pick<EvaluateMountableAppPrincipleRequest, "participant">) {
  return normalizeText(request.participant.externalUserId)
    || normalizeText(request.participant.participantAddress).toLowerCase();
}

function normalizeDemoCheckboxId(value: unknown): DemoCheckboxId {
  const normalized = normalizeText(value) as DemoCheckboxId;
  return checkboxCatalog.some((checkbox) => checkbox.id === normalized) ? normalized : "profile";
}

function normalizeMinimum(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 2;
  }

  return Math.min(Math.max(Math.round(parsed), 1), checkboxCatalog.length);
}

function normalizeRequiredSet(value: unknown): DemoCheckboxId[] {
  switch (normalizeText(value)) {
    case "activation":
      return ["profile", "terms", "launch"];
    case "all":
      return checkboxCatalog.map((checkbox) => checkbox.id);
    case "starter":
    default:
      return ["profile", "terms"];
  }
}

async function getStateForRequest(request: EvaluateMountableAppPrincipleRequest) {
  const key = normalizeParticipantKey(request);
  if (!key) return null;
  if (usesDatabase()) return (await collection<DemoParticipantState & { _id: string }>("participantStates")).findOne({ _id: key });
  return participantStates.get(key) ?? null;
}

async function checkedSetForRequest(request: EvaluateMountableAppPrincipleRequest) {
  return new Set((await getStateForRequest(request))?.checked ?? []);
}

function missingLabels(ids: DemoCheckboxId[]) {
  return ids
    .map((id) => checkboxCatalog.find((checkbox) => checkbox.id === id)?.label ?? id)
    .join(", ");
}

export async function readParticipantState(externalUserId: string, participantAddress?: string): Promise<DemoParticipantState> {
  const key = externalUserId.trim() || participantAddress?.trim().toLowerCase() || "demo-user";
  const existing = usesDatabase()
    ? await (await collection<DemoParticipantState & { _id: string }>("participantStates")).findOne({ _id: key })
    : participantStates.get(key);
  if (existing) {
    return existing;
  }

  return {
    externalUserId: key,
    participantAddress: participantAddress?.trim().toLowerCase() || `demo:${key}`,
    checked: [],
    submittedText: "",
    updatedAt: new Date().toISOString(),
  };
}

export async function saveParticipantState(input: {
  externalUserId: string;
  participantAddress?: string;
  checked: string[];
  submittedText?: string;
}) {
  const key = input.externalUserId.trim() || input.participantAddress?.trim().toLowerCase() || "demo-user";
  const existing = await readParticipantState(key, input.participantAddress);
  const allowed = new Set(checkboxCatalog.map((checkbox) => checkbox.id));
  const checked = input.checked.filter((id): id is DemoCheckboxId => allowed.has(id as DemoCheckboxId));
  const state: DemoParticipantState = {
    externalUserId: key,
    participantAddress: input.participantAddress?.trim().toLowerCase() || `demo:${key}`,
    checked,
    submittedText: typeof input.submittedText === "string" ? input.submittedText : normalizeText(existing?.submittedText),
    updatedAt: new Date().toISOString(),
  };
  participantStates.set(key, state);
  participantStates.set(state.participantAddress, state);
  if (usesDatabase()) {
    const records = await collection<DemoParticipantState & { _id: string }>("participantStates");
    await records.replaceOne({ _id: key }, state, { upsert: true });
  }
  return state;
}

export const hostedApp = createHostedAppSdk()
  .addPrinciple(principleDefinitions[0], {
    formatSelection(params) {
      const checkboxId = normalizeDemoCheckboxId(params["checkbox-id"]);
      const label = checkboxCatalog.find((checkbox) => checkbox.id === checkboxId)?.label ?? checkboxId;
      return `Complete checkbox: ${label}`;
    },
    async evaluate(request) {
      const checkboxId = normalizeDemoCheckboxId(request.params?.["checkbox-id"]);
      const checked = await checkedSetForRequest(request);
      const fulfilled = checked.has(checkboxId);
      const label = checkboxCatalog.find((checkbox) => checkbox.id === checkboxId)?.label ?? checkboxId;
      const state = await getStateForRequest(request);
      return {
        principleId: "demo-checkbox-completed",
        fulfilled,
        detail: fulfilled ? `${label} is checked` : `${label} is not checked yet`,
        updatedAt: state?.updatedAt ?? new Date().toISOString(),
      };
    },
  })
  .addPrinciple(principleDefinitions[1], {
    async evaluate(request) {
      const minCompleted = normalizeMinimum(request.params?.["min-completed"]);
      const state = await getStateForRequest(request);
      const completed = state?.checked.length ?? 0;
      return {
        principleId: "demo-checkbox-count-at-least",
        fulfilled: completed >= minCompleted,
        detail: `Checked ${completed} of ${checkboxCatalog.length}; needed ${minCompleted}`,
        updatedAt: state?.updatedAt ?? new Date().toISOString(),
      };
    },
  })
  .addPrinciple(principleDefinitions[2], {
    formatSelection(params) {
      return `Complete checkbox set: ${normalizeText(params["required-set"]) || "starter"}`;
    },
    async evaluate(request) {
      const requiredIds = normalizeRequiredSet(request.params?.["required-set"]);
      const checked = await checkedSetForRequest(request);
      const missing = requiredIds.filter((id) => !checked.has(id));
      const state = await getStateForRequest(request);
      return {
        principleId: "demo-checkbox-set-completed",
        fulfilled: missing.length === 0,
        detail: missing.length === 0
          ? `Completed ${missingLabels(requiredIds)}`
          : `Missing ${missingLabels(missing)}`,
        updatedAt: state?.updatedAt ?? new Date().toISOString(),
      };
    },
  })
  .addPrinciple(principleDefinitions[3], {
    formatSelection(params) {
      return `Type exactly: ${normalizeText(params["target-text"])}`;
    },
    async evaluate(request) {
      const targetText = normalizeText(request.params?.["target-text"]);
      const state = await getStateForRequest(request);
      const fulfilled = Boolean(targetText) && normalizeText(state?.submittedText) === targetText;
      return {
        principleId: "demo-exact-text-match",
        fulfilled,
        detail: fulfilled ? "Exact text matched" : "The entered text does not match yet",
        updatedAt: state?.updatedAt ?? new Date().toISOString(),
      };
    },
  });

export function defaultSelectedPrinciples(): MountableAppPrincipleSelection[] {
  return [
    buildSelectedPrinciple("demo-checkbox-completed", { "checkbox-id": "terms" }, "Complete checkbox: Terms accepted"),
    buildSelectedPrinciple("demo-checkbox-count-at-least", { "min-completed": 3 }, "Check at least 3 boxes"),
    buildSelectedPrinciple("demo-checkbox-set-completed", { "required-set": "starter" }, "Complete checkbox set: starter"),
    buildSelectedPrinciple("demo-exact-text-match", { "target-text": "freight" }, "Type exactly: freight"),
  ];
}

export async function evaluateSelections(input: {
  participantAddress: string;
  externalUserId: string;
  selectedPrinciples?: MountableAppPrincipleSelection[];
}) {
  const selectedPrinciples = input.selectedPrinciples?.length ? input.selectedPrinciples : defaultSelectedPrinciples();
  const states: MountedAppPrincipleState[] = [];
  for (const selection of selectedPrinciples) {
    states.push(await hostedApp.evaluatePrinciple({
      appId,
      principleId: selection.principleId,
      params: selection.params ?? {},
      participant: {
        participantAddress: input.participantAddress,
        externalUserId: input.externalUserId,
      },
    }));
  }
  return states;
}

export function buildManifest(origin: string): RegisteredMountableAppManifest {
  return {
    appId,
    appName,
    description: "A demo hosted app where login and checkboxes become FON mounted principles.",
    sdkVersion: "0.1.0",
    appUrl: origin,
    logoUrl: `${origin}/logo.png`,
    iconUrl: `${origin}/logo.png`,
    verifyInstallUrl: `${origin}/api/verify-install`,
    activityWebhookUrl: `${origin}/api/activity`,
    pollUpdatesUrl: `${origin}/api/poll`,
    syncMode: "both",
    pollIntervalSeconds: 30,
    supportsTimestampQuery: false,
    principles: hostedApp.listPrinciples(),
    configSchema: {
      allowSelfReportedCheckboxes: true,
    },
    configDefaults: {
      allowSelfReportedCheckboxes: true,
    },
  };
}

export function parseSelectedPrinciples(value: unknown): MountableAppPrincipleSelection[] {
  if (!Array.isArray(value)) {
    return defaultSelectedPrinciples();
  }

  return value
    .filter((entry): entry is MountableAppPrincipleSelection => Boolean(entry) && typeof entry === "object" && typeof (entry as MountableAppPrincipleSelection).principleId === "string")
    .map((entry) => ({
      principleId: entry.principleId,
      params: entry.params && typeof entry.params === "object" ? entry.params as MountableJsonObject : {},
      displayLabel: typeof entry.displayLabel === "string" ? entry.displayLabel : "",
      required: entry.required !== false,
    }));
}
