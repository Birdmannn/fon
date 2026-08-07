import {
  hasGoogleFormsResponsesScope,
  isGoogleAccessTokenCurrent,
  parseStoredGoogleOAuthGrant,
  refreshGoogleGrantAccessToken,
  type GoogleOAuthGrantPayload,
} from "@/lib/googleAuth";
import { getGoogleOAuthGrantsCollection } from "@/lib/mongodb";

type StoredGoogleGrantDocument = {
  address?: unknown;
  grantKind?: unknown;
  grant?: unknown;
};

type GoogleFormsResponse = {
  responseId?: string;
  respondentEmail?: string;
  createTime?: string;
  lastSubmittedTime?: string;
};

type GoogleFormsResponsesListPayload = {
  responses?: GoogleFormsResponse[];
  nextPageToken?: string;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

export type GoogleFormsMatchedResponse = {
  createTime: string | null;
  lastSubmittedTime: string | null;
  respondentEmail: string;
  responseId: string;
};

export type GoogleFormsAccessVerification = {
  formId: string;
  grantEmail: string;
  grantLinkedAt: string;
  grantLastRefreshedAt: string;
  hasRefreshToken: boolean;
  scopes: string[];
  verifiedAt: string;
};

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function ensureString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }

  return value.trim();
}

async function loadStoredGrant(address: string) {
  const collection = await getGoogleOAuthGrantsCollection();
  const grantDoc = await collection.findOne({
    address: normalizeAddress(address),
    grantKind: "forms_response_access",
  }) as StoredGoogleGrantDocument | null;

  if (!grantDoc) {
    throw new Error("Connect a Google account with Forms response access first");
  }

  const grant = parseStoredGoogleOAuthGrant(grantDoc.grant);
  if (!grant) {
    throw new Error("Stored Google response-access grant is invalid. Reconnect Google access and try again.");
  }

  if (!hasGoogleFormsResponsesScope(grant.scopes)) {
    throw new Error("Stored Google response-access grant is missing Google Forms response scope");
  }

  return {
    collection,
    grant,
  };
}

async function persistGrant(address: string, grant: GoogleOAuthGrantPayload) {
  const collection = await getGoogleOAuthGrantsCollection();
  const now = new Date();
  await collection.updateOne(
    { address: normalizeAddress(address), grantKind: "forms_response_access" },
    {
      $set: {
        address: normalizeAddress(address),
        grantKind: "forms_response_access",
        googleSub: grant.googleAccount.sub,
        googleEmail: grant.googleAccount.email,
        grant,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );
}

export async function getGoogleFormsAccessToken(address: string) {
  const normalizedAddress = normalizeAddress(address);
  const { grant } = await loadStoredGrant(normalizedAddress);

  if (isGoogleAccessTokenCurrent(grant) && grant.accessToken) {
    return {
      accessToken: grant.accessToken,
      grant,
    };
  }

  const refreshed = await refreshGoogleGrantAccessToken(grant);
  const refreshedGrant: GoogleOAuthGrantPayload = {
    ...grant,
    scopes: refreshed.grantedScopes,
    accessToken: refreshed.accessToken,
    accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
    refreshToken: refreshed.refreshToken,
    tokenType: refreshed.tokenType,
    lastRefreshedAt: new Date().toISOString(),
    googleAccount: {
      ...grant.googleAccount,
      lastRefreshedAt: new Date().toISOString(),
    },
  };

  await persistGrant(normalizedAddress, refreshedGrant);

  return {
    accessToken: refreshed.accessToken,
    grant: refreshedGrant,
  };
}

async function callGoogleFormsApi<T>(path: string, accessToken: string) {
  const response = await fetch(`https://forms.googleapis.com/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null) as T | null;
  if (!response.ok) {
    const errorPayload = payload as { error?: { message?: unknown; status?: unknown } } | null;
    const message = typeof errorPayload?.error?.message === "string"
      ? errorPayload.error.message
      : typeof errorPayload?.error?.status === "string"
        ? errorPayload.error.status
        : "Google Forms API request failed";
    throw new Error(message);
  }

  if (!payload) {
    throw new Error("Google Forms API returned an empty response");
  }

  return payload;
}

export async function verifyGoogleFormResponseAccess(params: { address: string; formId: string }) {
  const address = ensureString(params.address, "address");
  const formId = ensureString(params.formId, "formId");
  const { accessToken, grant } = await getGoogleFormsAccessToken(address);

  await callGoogleFormsApi<GoogleFormsResponsesListPayload>(`forms/${encodeURIComponent(formId)}/responses?pageSize=1`, accessToken);

  return {
    formId,
    grantEmail: grant.googleAccount.email,
    grantLinkedAt: grant.linkedAt,
    grantLastRefreshedAt: grant.lastRefreshedAt,
    hasRefreshToken: Boolean(grant.refreshToken),
    scopes: [...grant.scopes],
    verifiedAt: new Date().toISOString(),
  } satisfies GoogleFormsAccessVerification;
}

export async function findGoogleFormResponseByEmail(params: {
  creatorAddress: string;
  formId: string;
  participantEmail: string;
}) {
  const creatorAddress = ensureString(params.creatorAddress, "creatorAddress");
  const formId = ensureString(params.formId, "formId");
  const participantEmail = normalizeEmail(ensureString(params.participantEmail, "participantEmail"));
  const { accessToken } = await getGoogleFormsAccessToken(creatorAddress);

  let pageToken = "";
  do {
    const query = new URLSearchParams({
      pageSize: "500",
    });
    if (pageToken) {
      query.set("pageToken", pageToken);
    }

    const payload = await callGoogleFormsApi<GoogleFormsResponsesListPayload>(
      `forms/${encodeURIComponent(formId)}/responses?${query.toString()}`,
      accessToken,
    );

    const match = (payload.responses ?? []).find((response) => normalizeEmail(response.respondentEmail ?? "") === participantEmail);
    if (match?.responseId) {
      return {
        responseId: match.responseId,
        respondentEmail: participantEmail,
        createTime: typeof match.createTime === "string" ? match.createTime : null,
        lastSubmittedTime: typeof match.lastSubmittedTime === "string" ? match.lastSubmittedTime : null,
      } satisfies GoogleFormsMatchedResponse;
    }

    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
  } while (pageToken);

  return null;
}
