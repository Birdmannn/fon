import { NextResponse } from "next/server";

import {
  buildGoogleLinkCookieValue,
  consumeGoogleOAuthState,
  createGoogleLinkCode,
  exchangeGoogleCodeForAccount,
  getGoogleLinkCodeCookieName,
  getGoogleOAuthCookieName,
  parseGoogleOAuthCookieValue,
} from "@/lib/googleAuth";

export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code")?.trim();
    const state = url.searchParams.get("state")?.trim();
    const cookieState = parseGoogleOAuthCookieValue(request.headers.get("cookie")?.split("; ").find((entry) => entry.startsWith(`${getGoogleOAuthCookieName()}=`))?.split("=").slice(1).join("="));

    if (!code || !state) {
      return badRequest("Missing Google OAuth callback parameters");
    }

    if (!cookieState || cookieState !== state) {
      return badRequest("Google OAuth state mismatch", 403);
    }

    const stateRecord = consumeGoogleOAuthState(state);
    if (!stateRecord) {
      return badRequest("Google OAuth session expired", 403);
    }

    const googleAccount = await exchangeGoogleCodeForAccount(code);
    const linkCodeRecord = createGoogleLinkCode(stateRecord.address, googleAccount);
    const redirectTarget = new URL(stateRecord.redirectPath || "/", url.origin);
    redirectTarget.searchParams.set("google_link_code", linkCodeRecord.code);

    const response = NextResponse.redirect(redirectTarget);
    response.cookies.set(getGoogleOAuthCookieName(), "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
    response.cookies.set(getGoogleLinkCodeCookieName(), buildGoogleLinkCookieValue({
      address: stateRecord.address,
      code: linkCodeRecord.code,
    }), {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 5,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to complete Google OAuth";
    return badRequest(message);
  }
}
