# FON Principles — TypeScript Interface Notes

## What was implemented

The principle system was upgraded from a thin `principleId/title/description` model into a richer TypeScript contract that can represent:
- app-defined principle metadata
- parameterized principle selection
- readable rendering of selected principle rules
- participant/freight evaluation requests
- normalized evaluation results
- hosted-app update payloads that preserve principle context

The main implementation lives in:
- [frontend/lib/fonMountablesSdk.ts](frontend/lib/fonMountablesSdk.ts)

Supporting type and normalization updates were applied in:
- [frontend/app/_types/appMountable.ts](frontend/app/_types/appMountable.ts)
- [frontend/app/_lib/appMountable.ts](frontend/app/_lib/appMountable.ts)
- [frontend/app/api/mountables/apps/verify/route.ts](frontend/app/api/mountables/apps/verify/route.ts)
- [frontend/app/api/mountables/apps/[mountableInstanceId]/updates/route.ts](frontend/app/api/mountables/apps/%5BmountableInstanceId%5D/updates/route.ts)
- [frontend/app/_components/MountableAppsConfigurator.tsx](frontend/app/_components/MountableAppsConfigurator.tsx)

---

## Layer 1: Principle definition

A hosted app can now describe a principle with richer metadata:

```ts
type MountableAppPrincipleDefinition = {
  principleId: string;
  title: string;
  description: string;
  supportsTimestampQuery: boolean;
  paramsSchema: MountableAppPrincipleParamDefinition[];
  paramsDefaults: MountableJsonObject;
  readableFormat: string;
  exampleReadableText: string;
};
```

This is the app's published principle surface.

### Why this matters
- `principleId` stays stable over time
- `paramsSchema` explains what the creator may configure
- `paramsDefaults` gives sane fallback values
- `readableFormat` and `exampleReadableText` help FON render the rule in a user-facing way
- `supportsTimestampQuery` indicates whether the app can answer historical / as-of evaluation queries

---

## Layer 2: Principle parameter schema

Each principle may define parameters using:

```ts
type MountableAppPrincipleParamDefinition = {
  paramKey: string;
  title: string;
  description: string;
  valueType: "string" | "number" | "boolean" | "enum";
  required: boolean;
  defaultValue?: MountableJsonValue;
  enumOptions?: MountableAppPrincipleParamOption[];
  minimum?: number | null;
  maximum?: number | null;
  step?: number | null;
  placeholder?: string;
};
```

This gives the SDK enough structure for a future creator UI that can render configurable principle inputs instead of only checkboxes.

---

## Layer 3: Selected principle config

A freight should mount a **selected principle configuration**, not just a raw principle id.

That is now represented by:

```ts
type MountableAppPrincipleSelection = {
  principleId: string;
  params?: MountableJsonObject;
  displayLabel?: string;
  required?: boolean;
};
```

And after normalization/resolution:

```ts
type ResolvedMountableAppPrincipleSelection =
  MountableAppPrincipleDefinition & {
    params: MountableJsonObject;
    displayLabel: string;
    required: boolean;
  };
```

### Meaning
- the app defines what the principle is
- the creator chooses whether to include it
- the creator may later provide params
- FON stores a resolved, readable version of that mounted rule

---

## Layer 4: Evaluation request

The SDK now includes an ideal request shape for principle evaluation:

```ts
type EvaluateMountableAppPrincipleRequest = {
  appId: string;
  principleId: string;
  params?: MountableJsonObject;
  participant: {
    participantAddress: string;
    participantHandle?: string | null;
    externalUserId?: string | null;
  };
  freight?: {
    campaignId: string | null;
    createdByHash: string | null;
    chainCreatedAt: string | null;
    campaignType: number | null;
    taskStartDelayHours: string | null;
    taskDurationHours: string | null;
    startsAt: string | null;
    endsAt: string | null;
    asOf?: string | null;
  };
};
```

This expresses the intended model:
- the app owns the principle logic
- FON supplies participant context
- FON may supply freight window context
- the app decides whether the participant satisfies the rule

---

## Layer 5: Evaluation result / normalized runtime state

Instead of a bare boolean, the normalized runtime result is:

```ts
type MountedAppPrincipleState = {
  principleId: string;
  title?: string;
  description?: string;
  supportsTimestampQuery?: boolean;
  params?: MountableJsonObject;
  displayLabel?: string;
  fulfilled: boolean;
  detail?: string;
  updatedAt?: string;
};
```

This same shape is used as the normalized result of evaluation:

```ts
type EvaluateMountableAppPrincipleResult = MountedAppPrincipleState;
```

### Why this is better than boolean only
- `fulfilled` is the yes/no answer
- `detail` explains why
- `updatedAt` supports freshness/history
- `params` and `displayLabel` preserve what rule was actually checked
- `title`/`description` make downstream UIs easier to build

---

## Layer 6: Ideal app-side SDK contract

An ideal hosted-app SDK interface is now expressed conceptually as:

```ts
interface FonMountableHostedAppSdk {
  addPrinciple(
    definition: MountableAppPrincipleDefinition,
    handler: {
      formatSelection?: (params: MountableJsonObject) => string;
      evaluate: (
        request: EvaluateMountableAppPrincipleRequest,
      ) => Promise<EvaluateMountableAppPrincipleResult> | EvaluateMountableAppPrincipleResult;
    }
  ): this;

  evaluatePrinciple(
    request: EvaluateMountableAppPrincipleRequest,
  ): Promise<EvaluateMountableAppPrincipleResult>;

  listPrinciples(): MountableAppPrincipleDefinition[];
}
```

This is not yet a packaged external SDK implementation; it is the ideal interface contract embedded into the current internal SDK/types file.

---

## What changed in verification/install flow

The mountable verify flow now supports richer selected-principle payloads, not just ids:
- [frontend/app/api/mountables/apps/verify/route.ts](frontend/app/api/mountables/apps/verify/route.ts)

It now:
- accepts `selectedPrinciples`
- falls back from `selectedPrincipleIds` to normalized selections when needed
- resolves selected principles against the registered principle definitions
- stores the resolved selections on the mounted app config

This makes the installed mountable closer to the final principle model.

---

## What changed in update ingestion

The mounted-app update ingestion route now normalizes incoming principle state against the selected mounted principles:
- [frontend/app/api/mountables/apps/[mountableInstanceId]/updates/route.ts](frontend/app/api/mountables/apps/%5BmountableInstanceId%5D/updates/route.ts)

That means the stored `criteriaState` can preserve:
- principle ids
- readable labels
- params
- metadata such as `supportsTimestampQuery`
- fulfillment result and detail

while still driving `childSatisfied` and `parentSatisfied` the same way as before.

---

## What changed in creator-facing UI

The current UI is still principle-selection based, but it now surfaces more of the richer contract:
- [frontend/app/_components/MountableAppsConfigurator.tsx](frontend/app/_components/MountableAppsConfigurator.tsx)

It now shows:
- example readable principle text when browsing principles
- display labels for already selected principles on a mounted app

This is still not a full parameter editor yet, but it aligns the UI with the richer SDK model.

---

## What remains future work

The interface is now richer, but some product/runtime parts are still future-facing:

### 1. Parameter editing UI
Creators can still mainly select principles, but there is not yet a full generated UI for entering arbitrary `paramsSchema` values.

### 2. Pull-evaluation runtime
The SDK types now support pull-style evaluation requests, but the repo still leans operationally toward hosted apps pushing updates into FON.

### 3. External SDK packaging
The ideal interfaces live in the internal codebase, but there is not yet a standalone published SDK package for third-party app authors.

### 4. Full example implementations
The repo still needs concrete app examples, such as a leaderboard/game app exposing principles like:
- `participant-play-count`
- `participant-rank-range`
- `participant-on-leaderboard`
- `participant-score-at-least`

---

## Bottom line

The repo now has a stronger internal principle contract:
- principle definitions are parameterized and descriptive
- mounted selections can carry params and readable labels
- evaluation requests and results are explicitly modeled
- hosted app updates can preserve richer principle state

So the system is now much closer to the intended design:

> app-defined, parameterized, human-readable principles that FON can mount, evaluate, and track per participant within a freight context.
