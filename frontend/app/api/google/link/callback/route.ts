import { NextResponse } from "next/server";

import {
  buildGoogleLinkCookieValue,
  buildGoogleOAuthGrant,
  consumeGoogleOAuthState,
  createGoogleLinkCode,
  exchangeGoogleCodeForLinkResult,
  getGoogleLinkCodeCookieName,
  getGoogleOAuthCookieName,
  hasGoogleFormsResponsesScope,
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

    const linkResult = await exchangeGoogleCodeForLinkResult(code, stateRecord.requestedScopes);
    const oauthGrant = stateRecord.purpose === "forms_response_access"
      ? buildGoogleOAuthGrant({
        grantKind: "forms_response_access",
        address: stateRecord.address,
        googleAccount: linkResult.googleAccount,
        grantedScopes: linkResult.grantedScopes,
        accessToken: linkResult.accessToken,
        accessTokenExpiresAt: linkResult.accessTokenExpiresAt,
        refreshToken: linkResult.refreshToken,
        tokenType: linkResult.tokenType,
      })
      : null;

    if (stateRecord.purpose === "forms_response_access" && (!oauthGrant || !hasGoogleFormsResponsesScope(oauthGrant.scopes))) {
      return badRequest("Google response access must include Google Forms response scope", 403);
    }

    const linkCodeRecord = createGoogleLinkCode(
      stateRecord.address,
      linkResult.googleAccount,
      stateRecord.purpose,
      oauthGrant,
    );
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
