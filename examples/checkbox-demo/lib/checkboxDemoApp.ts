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
  updatedAt: string;
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
];

declare global {
  var __fonCheckboxDemoParticipantStates: Map<string, DemoParticipantState> | undefined;
}

const participantStates = globalThis.__fonCheckboxDemoParticipantStates ?? new Map<string, DemoParticipantState>();
globalThis.__fonCheckboxDemoParticipantStates = participantStates;

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

function getStateForRequest(request: EvaluateMountableAppPrincipleRequest) {
  const key = normalizeParticipantKey(request);
  return key ? participantStates.get(key) ?? null : null;
}

function checkedSetForRequest(request: EvaluateMountableAppPrincipleRequest) {
  return new Set(getStateForRequest(request)?.checked ?? []);
}

function missingLabels(ids: DemoCheckboxId[]) {
  return ids
    .map((id) => checkboxCatalog.find((checkbox) => checkbox.id === id)?.label ?? id)
    .join(", ");
}

export function readParticipantState(externalUserId: string, participantAddress?: string): DemoParticipantState {
  const key = externalUserId.trim() || participantAddress?.trim().toLowerCase() || "demo-user";
  const existing = participantStates.get(key);
  if (existing) {
    return existing;
  }

  return {
    externalUserId: key,
    participantAddress: participantAddress?.trim().toLowerCase() || `demo:${key}`,
    checked: [],
    updatedAt: new Date().toISOString(),
  };
}

export function saveParticipantState(input: {
  externalUserId: string;
  participantAddress?: string;
  checked: string[];
}) {
  const key = input.externalUserId.trim() || input.participantAddress?.trim().toLowerCase() || "demo-user";
  const allowed = new Set(checkboxCatalog.map((checkbox) => checkbox.id));
  const checked = input.checked.filter((id): id is DemoCheckboxId => allowed.has(id as DemoCheckboxId));
  const state: DemoParticipantState = {
    externalUserId: key,
    participantAddress: input.participantAddress?.trim().toLowerCase() || `demo:${key}`,
    checked,
    updatedAt: new Date().toISOString(),
  };
  participantStates.set(key, state);
  return state;
}

export const hostedApp = createHostedAppSdk()
  .addPrinciple(principleDefinitions[0], {
    formatSelection(params) {
      const checkboxId = normalizeDemoCheckboxId(params["checkbox-id"]);
      const label = checkboxCatalog.find((checkbox) => checkbox.id === checkboxId)?.label ?? checkboxId;
      return `Complete checkbox: ${label}`;
    },
    evaluate(request) {
      const checkboxId = normalizeDemoCheckboxId(request.params?.["checkbox-id"]);
      const checked = checkedSetForRequest(request);
      const fulfilled = checked.has(checkboxId);
      const label = checkboxCatalog.find((checkbox) => checkbox.id === checkboxId)?.label ?? checkboxId;
      return {
        principleId: "demo-checkbox-completed",
        fulfilled,
        detail: fulfilled ? `${label} is checked` : `${label} is not checked yet`,
        updatedAt: getStateForRequest(request)?.updatedAt ?? new Date().toISOString(),
      };
    },
  })
  .addPrinciple(principleDefinitions[1], {
    evaluate(request) {
      const minCompleted = normalizeMinimum(request.params?.["min-completed"]);
      const state = getStateForRequest(request);
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
    evaluate(request) {
      const requiredIds = normalizeRequiredSet(request.params?.["required-set"]);
      const checked = checkedSetForRequest(request);
      const missing = requiredIds.filter((id) => !checked.has(id));
      return {
        principleId: "demo-checkbox-set-completed",
        fulfilled: missing.length === 0,
        detail: missing.length === 0
          ? `Completed ${missingLabels(requiredIds)}`
          : `Missing ${missingLabels(missing)}`,
        updatedAt: getStateForRequest(request)?.updatedAt ?? new Date().toISOString(),
      };
    },
  });

export function defaultSelectedPrinciples(): MountableAppPrincipleSelection[] {
  return [
    buildSelectedPrinciple("demo-checkbox-completed", { "checkbox-id": "terms" }, "Complete checkbox: Terms accepted"),
    buildSelectedPrinciple("demo-checkbox-count-at-least", { "min-completed": 3 }, "Check at least 3 boxes"),
    buildSelectedPrinciple("demo-checkbox-set-completed", { "required-set": "starter" }, "Complete checkbox set: starter"),
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
    iconUrl: `${origin}/favicon.ico`,
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
