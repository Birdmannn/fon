const GOOGLE_FORMS_SHORT_HOST = "forms.gle";
const GOOGLE_FORMS_DOCS_HOST = "docs.google.com";
const GOOGLE_ACCOUNTS_HOST = "accounts.google.com";
const GOOGLE_FORM_TITLE_SUFFIX = " - Google Forms";

type GoogleFormValidationResult = {
  canonicalFormUrl: string;
  formId: string;
  title: string | null;
  verifiedEmailRequired: boolean;
  validatedAt: string;
};

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function extractGoogleFormIdFromDocsUrl(url: URL) {
  const match = url.pathname.match(/^\/forms\/d\/(e\/)?([a-zA-Z0-9_-]+)\/(viewform|formResponse)(?:\/.*)?$/);
  if (!match) {
    return null;
  }

  const hasEmbeddedPrefix = Boolean(match[1]);
  const formId = match[2];
  const canonicalPath = hasEmbeddedPrefix
    ? `/forms/d/e/${formId}/viewform`
    : `/forms/d/${formId}/viewform`;

  return {
    formId,
    canonicalFormUrl: `https://${GOOGLE_FORMS_DOCS_HOST}${canonicalPath}`,
  };
}

function extractGoogleFormFromContinue(value: string | null) {
  if (!value || !isHttpUrl(value)) {
    return null;
  }

  const continueUrl = new URL(value);
  if (continueUrl.hostname !== GOOGLE_FORMS_DOCS_HOST) {
    return null;
  }

  return extractGoogleFormIdFromDocsUrl(continueUrl);
}

function normalizeInitialGoogleFormUrl(rawUrl: string) {
  if (!isHttpUrl(rawUrl)) {
    throw new Error("Enter a valid Google Forms link");
  }

  const url = new URL(rawUrl.trim());
  if (url.hostname === GOOGLE_FORMS_SHORT_HOST) {
    return url.toString();
  }

  if (url.hostname !== GOOGLE_FORMS_DOCS_HOST) {
    throw new Error("Only Google Forms links are supported in v1");
  }

  if (/\/edit(?:\?|$|\/)/.test(url.pathname)) {
    throw new Error("Paste the responder link, not the edit link");
  }

  const normalized = extractGoogleFormIdFromDocsUrl(url);
  if (!normalized) {
    throw new Error("Paste a Google Forms responder link");
  }

  return normalized.canonicalFormUrl;
}

function detectVerifiedEmailRequirement(html: string, finalUrl: URL) {
  const lowerHtml = html.toLowerCase();
  const readableText = lowerHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  // console.log("Readable text:", readableText);
  // console.log("Final URL:", finalUrl.toString());
  if (finalUrl.hostname === GOOGLE_ACCOUNTS_HOST) {
    return true;
  }

  const markers = [
    "your email will be recorded when you submit this form",
    "the name, email, and photo associated with your google account will be recorded",
    "to continue, sign in",
    "switch accounts",
    "google account",
    "record your email as the email to be included with my response",
    "as the email to be included with my response",
    "record my email address with my response",
  ];

  const patterns = [
    /record\s+[^\s]+@[^\s]+\s+as the email to be included with my response/,
    /record\s+.+\s+as the email to be included with my response/,
  ];

  return markers.some((marker) => readableText.includes(marker))
    || patterns.some((pattern) => pattern.test(readableText));
}

function extractTitle(html: string) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  if (!match) {
    return null;
  }

  const title = match[1].trim();
  if (!title) {
    return null;
  }

  return title.endsWith(GOOGLE_FORM_TITLE_SUFFIX)
    ? title.slice(0, -GOOGLE_FORM_TITLE_SUFFIX.length).trim() || null
    : title;
}

export async function validateGoogleFormUrl(rawUrl: string): Promise<GoogleFormValidationResult> {
  const normalizedUrl = normalizeInitialGoogleFormUrl(rawUrl);
  const response = await fetch(normalizedUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "FreightOnNervos/1.0 (+GoogleFormsValidation)",
    },
    cache: "no-store",
  });

  const finalUrl = new URL(response.url);
  const html = await response.text();
  // console.log("Final URL after redirects:", finalUrl.toString());

  const formMatch = finalUrl.hostname === GOOGLE_ACCOUNTS_HOST
    ? extractGoogleFormFromContinue(finalUrl.searchParams.get("continue"))
    : finalUrl.hostname === GOOGLE_FORMS_DOCS_HOST
      ? extractGoogleFormIdFromDocsUrl(finalUrl)
      : null;

  if (!formMatch) {
    throw new Error("Could not resolve a valid Google Forms responder link");
  }

  if (!response.ok && finalUrl.hostname !== GOOGLE_ACCOUNTS_HOST) {
    throw new Error("Google Form could not be loaded");
  }

  const verifiedEmailRequired = detectVerifiedEmailRequirement(html, finalUrl);
  if (!verifiedEmailRequired) {
    throw new Error("Google Form must require verified email collection" + verifiedEmailRequired);
  }

  return {
    canonicalFormUrl: formMatch.canonicalFormUrl,
    formId: formMatch.formId,
    title: extractTitle(html),
    verifiedEmailRequired,
    validatedAt: new Date().toISOString(),
  };
}
