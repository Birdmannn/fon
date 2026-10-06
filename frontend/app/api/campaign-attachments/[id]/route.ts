import { Binary, ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { getCampaignAttachmentsCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function objectId(value: string) {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

export async function GET(_request: Request, { params }: Params) {
  const id = objectId((await params).id);
  if (!id) return NextResponse.json({ error: "Invalid attachment" }, { status: 400 });
  const attachment = await (await getCampaignAttachmentsCollection()).findOne({ _id: id });
  if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  const bytes = attachment.data instanceof Binary ? attachment.data.value() : attachment.data;
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": attachment.contentType, "Content-Length": String(bytes.length), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}

export async function DELETE(request: Request, { params }: Params) {
  const id = objectId((await params).id);
  const creatorAddress = new URL(request.url).searchParams.get("creatorAddress")?.trim().toLowerCase();
  if (!id || !creatorAddress) return NextResponse.json({ error: "Invalid attachment request" }, { status: 400 });
  await (await getCampaignAttachmentsCollection()).deleteOne({ _id: id, creatorAddress });
  return NextResponse.json({ ok: true });
}
