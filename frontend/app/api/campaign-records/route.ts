import { NextResponse } from "next/server";
import { normalizeFormsMountableConfig } from "@/app/_lib/formsMountable";
import { validateGoogleFormUrl } from "@/lib/googleForms";
import { getMongoCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type CampaignRecordPayload = {
  title?: unknown;
  description?: unknown;
  campaignId?: unknown;
  createdByHash?: unknown;
  chainCreatedAt?: unknown;
  campaignType?: unknown;
  summaryDraft?: unknown;
  argsDraft?: {
    taskStartDelayHours?: unknown;
    taskDurationHours?: unknown;
    maxAmountCkb?: unknown;
    auxAmountCkb?: unknown;
    rewardCount?: unknown;
  };
  mountables?: {
    forms?: unknown;
  };
  socialMetadata?: {
    mentions?: unknown;
    comments?: unknown;
    likeCount?: unknown;
    likedByAddresses?: unknown;
    bookmarkCount?: unknown;
    reshareCount?: unknown;
  };
  creatorAddress?: unknown;
  creatorHandle?: unknown;
  status?: unknown;
  txHash?: unknown;
  publishError?: unknown;
  randomnessPreimage?: unknown;
  settlementTxHash?: unknown;
  settledAt?: unknown;
  soldTicketCount?: unknown;
  settledParticipantCount?: unknown;
  settledRecipients?: unknown;
};

const SUMMARY_MAX_BYTES = 64;
const summaryEncoder = new TextEncoder();

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function ensureString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value;
}

function ensureOptionalString(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be a string when provided`);
  }

  return value;
}

function ensureNumberString(value: unknown, field: string) {
  const text = ensureString(value, field);
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a valid non-negative number string`);
  }

  return text;
}

function ensureSummaryWithinLimit(text: string) {
  if (summaryEncoder.encode(text).length > SUMMARY_MAX_BYTES) {
    throw new Error("summaryDraft exceeds 64 UTF-8 bytes");
  }
}

function ensureOptionalRecipients(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new Error("settledRecipients must be an array when provided");
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`settledRecipients[${index}] must be an object`);
    }

    const candidate = entry as {
      address?: unknown;
      username?: unknown;
      handle?: unknown;
      amountLabel?: unknown;
    };

    return {
      address: ensureString(candidate.address, `settledRecipients[${index}].address`).trim(),
      username: ensureString(candidate.username, `settledRecipients[${index}].username`).trim(),
      handle: ensureString(candidate.handle, `settledRecipients[${index}].handle`).trim(),
      amountLabel: ensureString(candidate.amountLabel, `settledRecipients[${index}].amountLabel`).trim(),
    };
  });
}

async function ensureOptionalFormsMountable(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!value || typeof value !== "object") {
    throw new Error("mountables.forms must be an object when provided");
  }

  const candidate = value as {
    enabled?: unknown;
    formUrl?: unknown;
    canonicalFormUrl?: unknown;
    formId?: unknown;
    validatedAt?: unknown;
    payoutMode?: unknown;
    proofMode?: unknown;
    guaranteedSlots?: unknown;
    randomWinnerCount?: unknown;
    proofInstructions?: unknown;
  };

  const normalized = normalizeFormsMountableConfig({
    enabled: Boolean(candidate.enabled),
    formUrl: typeof candidate.formUrl === "string" ? candidate.formUrl : "",
    canonicalFormUrl: typeof candidate.canonicalFormUrl === "string" ? candidate.canonicalFormUrl : "",
    formId: typeof candidate.formId === "string" ? candidate.formId : "",
    validatedAt: typeof candidate.validatedAt === "string" ? candidate.validatedAt : "",
    payoutMode: candidate.payoutMode as "assured" | "random_subset" | "overflow_only" | undefined,
    proofMode: candidate.proofMode as "external_proof" | undefined,
    guaranteedSlots: typeof candidate.guaranteedSlots === "string" ? candidate.guaranteedSlots : String(candidate.guaranteedSlots ?? "1"),
    randomWinnerCount: typeof candidate.randomWinnerCount === "string" ? candidate.randomWinnerCount : String(candidate.randomWinnerCount ?? "1"),
    proofInstructions: typeof candidate.proofInstructions === "string" ? candidate.proofInstructions : "",
  });

  if (!normalized.enabled) {
    return normalized;
  }

  if (!normalized.formUrl.trim()) {
    throw new Error("Mounted Google Forms require a responder link");
  }

  const validation = await validateGoogleFormUrl(normalized.formUrl);
  return normalizeFormsMountableConfig({
    ...normalized,
    formUrl: validation.canonicalFormUrl,
    canonicalFormUrl: validation.canonicalFormUrl,
    formId: validation.formId,
    validatedAt: validation.validatedAt,
  });
}

async function normalizePayload(payload: CampaignRecordPayload) {
  const title = ensureString(payload.title, "title").trim();
  const description = ensureString(payload.description, "description").trim();
  const summaryDraft = ensureString(payload.summaryDraft, "summaryDraft").trim();
  ensureSummaryWithinLimit(summaryDraft);

  const taskStartDelayHours = ensureNumberString(payload.argsDraft?.taskStartDelayHours, "argsDraft.taskStartDelayHours");
  const taskDurationHours = ensureNumberString(payload.argsDraft?.taskDurationHours, "argsDraft.taskDurationHours");
  const maxAmountCkb = ensureNumberString(payload.argsDraft?.maxAmountCkb, "argsDraft.maxAmountCkb");
  const auxAmountCkb = ensureNumberString(payload.argsDraft?.auxAmountCkb, "argsDraft.auxAmountCkb");
  const rewardCount = ensureNumberString(payload.argsDraft?.rewardCount, "argsDraft.rewardCount");

  const mentions = Array.isArray(payload.socialMetadata?.mentions)
    ? payload.socialMetadata?.mentions.map((value) => ensureString(value, "socialMetadata.mentions[]"))
    : [];

  const campaignType = typeof payload.campaignType === "number" ? payload.campaignType : Number(payload.campaignType);
  if (!Number.isInteger(campaignType)) {
    throw new Error("campaignType must be an integer");
  }

  const status = ensureString(payload.status, "status");
  if (!["draft", "published", "publish_failed"].includes(status)) {
    throw new Error("status must be one of draft, published, publish_failed");
  }

  const campaignId = ensureOptionalString(payload.campaignId, "campaignId");
  const createdByHash = ensureOptionalString(payload.createdByHash, "createdByHash");
  const chainCreatedAt = ensureOptionalString(payload.chainCreatedAt, "chainCreatedAt");
  const txHash = ensureOptionalString(payload.txHash, "txHash");
  const publishError = ensureOptionalString(payload.publishError, "publishError");
  const creatorAddress = ensureOptionalString(payload.creatorAddress, "creatorAddress");
  const creatorHandle = ensureOptionalString(payload.creatorHandle, "creatorHandle");
  const randomnessPreimage = ensureOptionalString(payload.randomnessPreimage, "randomnessPreimage");
  const settlementTxHash = ensureOptionalString(payload.settlementTxHash, "settlementTxHash");
  const settledAt = ensureOptionalString(payload.settledAt, "settledAt");
  const soldTicketCount = ensureOptionalString(payload.soldTicketCount, "soldTicketCount");
  const settledParticipantCount = ensureOptionalString(payload.settledParticipantCount, "settledParticipantCount");
  const settledRecipients = ensureOptionalRecipients(payload.settledRecipients);
  const formsMountable = await ensureOptionalFormsMountable(payload.mountables?.forms);

  return {
    title,
    description,
    campaignId,
    createdByHash,
    chainCreatedAt,
    campaignType,
    summaryDraft,
    argsDraft: {
      taskStartDelayHours,
      taskDurationHours,
      maxAmountCkb,
      auxAmountCkb,
      rewardCount,
    },
    mountables: {
      forms: formsMountable,
    },
    socialMetadata: {
      mentions,
      comments: Array.isArray(payload.socialMetadata?.comments) ? payload.socialMetadata?.comments : [],
      likeCount: typeof payload.socialMetadata?.likeCount === "number" ? payload.socialMetadata.likeCount : 0,
      likedByAddresses: Array.isArray(payload.socialMetadata?.likedByAddresses)
        ? payload.socialMetadata.likedByAddresses.map((value) => ensureString(value, "socialMetadata.likedByAddresses[]").toLowerCase())
        : [],
      bookmarkCount: typeof payload.socialMetadata?.bookmarkCount === "number" ? payload.socialMetadata.bookmarkCount : 0,
      reshareCount: typeof payload.socialMetadata?.reshareCount === "number" ? payload.socialMetadata.reshareCount : 0,
    },
    creatorAddress,
    creatorHandle,
    status,
    txHash,
    publishError,
    randomnessPreimage,
    settlementTxHash,
    settledAt,
    soldTicketCount,
    settledParticipantCount,
    settledRecipients,
  };
}

export async function POST(request: Request) {
  try {
    const payload = await normalizePayload((await request.json()) as CampaignRecordPayload);
    const collection = await getMongoCollection();
    const now = new Date();
    const result = await collection.insertOne({
      ...payload,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: result.insertedId.toString() }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create campaign record";
    return badRequest(message);
  }
}

export async function GET() {
  try {
    const collection = await getMongoCollection();
    const records = await collection
      .find(
        {
          status: "published",
          txHash: { $type: "string", $ne: "" },
        },
        { sort: { updatedAt: -1 } }
      )
      .limit(50)
      .toArray();
    return NextResponse.json({ records });
  } catch (error) {
    console.error("GET /api/campaign-records error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch campaign records";
    return badRequest(message, 500);
  }
}
