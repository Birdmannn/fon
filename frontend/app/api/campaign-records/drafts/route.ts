import { NextResponse } from "next/server";
import { getMongoCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

const DRAFT_STATUSES = ["draft", "publish_failed"] as const;

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const creatorAddress = new URL(request.url).searchParams.get("creatorAddress")?.trim();
    if (!creatorAddress) {
      return badRequest("creatorAddress is required");
    }

    const collection = await getMongoCollection();
    const records = await collection
      .find(
        {
          creatorAddress,
          status: { $in: [...DRAFT_STATUSES] },
        },
        {
          sort: { updatedAt: -1 },
          projection: {
            title: 1,
            description: 1,
            campaignId: 1,
            createdByHash: 1,
            chainCreatedAt: 1,
            campaignType: 1,
            summaryDraft: 1,
            argsDraft: 1,
            mountables: 1,
            socialMetadata: 1,
            giftDeliverable: 1,
            creatorAddress: 1,
            creatorHandle: 1,
            status: 1,
            txHash: 1,
            publishError: 1,
            randomnessPreimage: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        }
      )
      .toArray();

    return NextResponse.json({
      records: records.map((record) => ({
        ...record,
        _id: record._id.toString(),
        createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
        updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
      })),
    });
  } catch (error) {
    console.error("GET /api/campaign-records/drafts error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch draft records";
    return badRequest(message, 500);
  }
}
