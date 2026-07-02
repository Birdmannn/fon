import { NextResponse } from "next/server";

import { validateGoogleFormUrl } from "@/lib/googleForms";

export const dynamic = "force-dynamic";

type ValidateGoogleFormPayload = {
  formUrl?: unknown;
};

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function ensureString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value.trim();
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ValidateGoogleFormPayload;
    const formUrl = ensureString(payload.formUrl, "formUrl");
    const validation = await validateGoogleFormUrl(formUrl);

    return NextResponse.json({
      ok: true,
      ...validation,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to validate Google Form";
    return badRequest(message);
  }
}
