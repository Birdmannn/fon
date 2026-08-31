import { NextResponse } from "next/server";

import { buildManifest } from "@/lib/checkboxDemoApp";

function resolveOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_APP_BASE_URL?.trim() || new URL(request.url).origin;
}

export async function GET(request: Request) {
  return NextResponse.json(buildManifest(resolveOrigin(request)));
}
