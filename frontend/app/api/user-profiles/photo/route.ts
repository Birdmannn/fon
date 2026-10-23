import { createHash } from "node:crypto";

import { SignerSignType } from "@ckb-ccc/core";
import { Binary } from "mongodb";
import { NextResponse } from "next/server";

import { verifyWalletSignature, walletActionNonceMatchesPurpose } from "@/lib/googleAuth";
import { getUserProfilePhotosCollection, getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_PHOTO_BYTES + 16 * 1024;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function imageContentType(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP") return "image/webp";
  return null;
}

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim().toLowerCase();
  if (!address) return errorResponse("address is required");

  try {
    const collection = await getUserProfilePhotosCollection();
    const photo = await collection.findOne({ _id: address }, { projection: { _id: 0, data: 1, contentType: 1 } });
    if (!photo || !photo.data || typeof photo.contentType !== "string") return errorResponse("Photo not found", 404);

    const bytes = photo.data instanceof Binary ? photo.data.value() : photo.data;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": photo.contentType,
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return errorResponse("Failed to load profile photo", 500);
  }
}

export async function POST(request: Request) {
  const requestBytes = Number(request.headers.get("content-length"));
  if (requestBytes > MAX_REQUEST_BYTES) return errorResponse("Photo must be 4 MB or smaller", 413);

  try {
    const form = await request.formData();
    const address = form.get("address");
    const nonce = form.get("nonce");
    const signatureText = form.get("signature");
    const file = form.get("photo");
    if (typeof address !== "string" || typeof nonce !== "string" || typeof signatureText !== "string" || !(file instanceof File)) {
      return errorResponse("Missing photo or wallet authorization");
    }

    const normalizedAddress = address.trim().toLowerCase();
    if (!normalizedAddress || file.size === 0 || file.size > MAX_PHOTO_BYTES) {
      return errorResponse("Photo must be between 1 byte and 4 MB", 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = imageContentType(bytes);
    if (!contentType) return errorResponse("Choose a JPEG, PNG, or WebP photo");

    const digest = createHash("sha256").update(bytes).digest("hex");
    if (!walletActionNonceMatchesPurpose(nonce, "profile-photo", normalizedAddress) || !nonce.endsWith(`:${digest}`)) {
      return errorResponse("Photo authorization is invalid", 403);
    }

    const signature = JSON.parse(signatureText) as Record<string, unknown>;
    if (typeof signature.signature !== "string" || typeof signature.identity !== "string" ||
      typeof signature.signType !== "string" || !Object.values(SignerSignType).includes(signature.signType as SignerSignType)) {
      return errorResponse("Wallet signature is invalid", 403);
    }
    await verifyWalletSignature({ expectedPurpose: "profile-photo",
      address: normalizedAddress,
      nonce,
      signature: {
        signature: signature.signature,
        identity: signature.identity,
        signType: signature.signType as SignerSignType,
      },
    });

    const profiles = await getUserProfilesCollection();
    if (!await profiles.findOne({ address: normalizedAddress }, { projection: { _id: 1 } })) {
      return errorResponse("Profile not found", 404);
    }

    const updatedAt = new Date().toISOString();
    const photos = await getUserProfilePhotosCollection();
    await photos.updateOne(
      { _id: normalizedAddress },
      { $set: { data: Buffer.from(bytes), contentType, updatedAt } },
      { upsert: true },
    );
    await profiles.updateOne({ address: normalizedAddress }, { $set: { photoUpdatedAt: updatedAt } });

    return NextResponse.json({ photoUpdatedAt: updatedAt });
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse("Wallet signature is invalid", 403);
    return errorResponse(error instanceof Error ? error.message : "Failed to upload profile photo", 500);
  }
}
