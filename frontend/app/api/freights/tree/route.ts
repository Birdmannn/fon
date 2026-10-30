import { SignerSignType } from "@ckb-ccc/core";
import type { Document, UpdateFilter } from "mongodb";
import { NextResponse } from "next/server";

import { campaignCreatorAddress, loadCampaignPublications, type CampaignPublication } from "@/lib/campaignCreatorIdentity";
import { verifyFreightTreeCreator } from "@/lib/freightTreeCreator";
import { getPublicCkbClient } from "@/lib/ckbClient";
import { ancestorIds, canEncroach, parentIds, sharesDirectChild, wouldCreateCycle } from "@/lib/freightTree";
import { verifyWalletSignature, walletActionNonceMatchesPurpose } from "@/lib/googleAuth";
import { getCampaignParticipantFinalizationsCollection, getCampaignParticipantsCollection, getMongoCollection, getUserProfilesCollection } from "@/lib/mongodb";
import { dispatchMountedAppRequestsForParticipant, finalizeCampaignParticipant } from "@/lib/mountableAppRuntime";

export const dynamic = "force-dynamic";

type FreightRow = {
  campaignId: string;
  title?: string;
  description?: string;
  creatorAddress?: string;
  txHash?: string;
  createdByHash?: string;
  chainCreatedAt?: string;
  campaignType?: number;
  parentCampaignId?: string | null;
  parentCampaignIds?: string[];
  parentLinkedByAddress?: string;
  parentLinks?: Array<{ parentCampaignId: string; linkedByAddress: string; linkedAt: string; encroachment: { actorFbars: number; creatorFbars: number } | null }>;
  linkedCampaignIds?: string[];
  requiresLinkedFreight?: boolean;
};

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function normalizeAddress(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function loadFreights() {
  const rows = await (await getMongoCollection()).find(
    { status: "published", campaignId: { $type: "string" } },
    { projection: { _id: 0, campaignId: 1, title: 1, description: 1, creatorAddress: 1, txHash: 1, createdByHash: 1, chainCreatedAt: 1, campaignType: 1, parentCampaignId: 1, parentCampaignIds: 1, parentLinkedByAddress: 1, parentLinks: 1, linkedCampaignIds: 1, requiresLinkedFreight: 1 } },
  ).toArray() as unknown as FreightRow[];
  const publications = await loadCampaignPublications(rows);
  return { publications, rows: new Map(rows.map((row) => [row.campaignId.trim().toLowerCase(),
    { ...row, creatorAddress: campaignCreatorAddress(row, publications) }])) };
}

function treeFor(campaignId: string, rows: Map<string, FreightRow>) {
  const current = rows.get(campaignId);
  if (!current) return null;
  const queue = [campaignId];
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const row = rows.get(id);
    if (!row) continue;
    queue.push(...parentIds(row).filter((parentId) => rows.has(parentId)));
    for (const [childId, child] of rows) {
      if (parentIds(child).includes(id)) queue.push(childId);
    }
  }
  const depths = new Map<string, number>();
  const resolving = new Set<string>();
  const depthOf = (id: string): number => {
    if (depths.has(id)) return depths.get(id)!;
    if (resolving.has(id)) throw new Error("Freight graph contains a cycle");
    resolving.add(id);
    const depth = Math.max(0, ...parentIds(rows.get(id)).filter((parentId) => rows.has(parentId)).map((parentId) => depthOf(parentId) + 1));
    resolving.delete(id);
    depths.set(id, depth);
    return depth;
  };
  const nodes = [...visited].filter((id) => rows.has(id)).map((id) => ({ ...rows.get(id)!, depth: depthOf(id) }))
    .sort((left, right) => left.depth - right.depth || left.title?.localeCompare(right.title ?? "") || left.campaignId.localeCompare(right.campaignId));
  return {
    currentCampaignId: campaignId,
    requiresLinkedFreight: current.requiresLinkedFreight === true,
    nodes,
    linked: (current.linkedCampaignIds ?? []).map((id) => rows.get(id.toLowerCase())).filter((row): row is FreightRow => Boolean(row)),
    linkedFrom: [...rows.values()].filter((row) => row.linkedCampaignIds?.some((id) => id.toLowerCase() === campaignId)),
  };
}

function descendantIds(campaignId: string, rows: Map<string, FreightRow>) {
  const result: string[] = [];
  const queue = [campaignId];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    for (const [candidateId, row] of rows) {
      if (parentIds(row).includes(id)) queue.push(candidateId);
    }
  }
  return result;
}

async function verifiedCreatorAddress(row: FreightRow, publications: readonly CampaignPublication[]) {
  return verifyFreightTreeCreator(getPublicCkbClient(), row, publications);
}

async function refreshSubtree(campaignId: string, rows: Map<string, FreightRow>, onlyAddress?: string) {
  const participants = await getCampaignParticipantsCollection();
  const finalizations = await getCampaignParticipantFinalizationsCollection();
  for (const descendantId of descendantIds(campaignId, rows)) {
    const addresses = onlyAddress
      ? [onlyAddress]
      : await participants.distinct("participantAddress", { campaignId: descendantId });
    for (const participantAddress of addresses) {
      if (typeof participantAddress !== "string" || !participantAddress.trim()) continue;
      const prior = await finalizations.findOne(
        { campaignId: descendantId, participantAddress: participantAddress.trim().toLowerCase() },
        { projection: { "canonicalVerification.status": 1 } },
      );
      const canonicalVerification = await finalizeCampaignParticipant({ campaignId: descendantId, participantAddress, propagateDescendants: false });
      if (canonicalVerification && prior?.canonicalVerification?.status !== canonicalVerification.status) {
        await dispatchMountedAppRequestsForParticipant({
          campaignId: descendantId,
          participantAddress,
          canonicalVerification,
          eventType: canonicalVerification.status === "verified" ? "participant.finalized" : "participant.updated",
          source: "freight-tree-updated",
        }).catch(() => undefined);
      }
    }
  }
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const campaignId = requiredString(params.get("campaignId"), "campaignId").toLowerCase();
    const { rows, publications } = await loadFreights();
    const ownedBy = normalizeAddress(params.get("ownedBy"));
    if (ownedBy) {
      const owned = await Promise.all([...rows.values()]
        .filter((row) => normalizeAddress(row.creatorAddress) === ownedBy && row.campaignId.toLowerCase() !== campaignId)
        .map(async (row) => {
          try {
            return await verifiedCreatorAddress(row, publications) === ownedBy
              ? { campaignId: row.campaignId, title: row.title?.trim() || "Untitled freight" }
              : null;
          } catch {
            return null;
          }
        }));
      return NextResponse.json({ freights: owned.filter((row) => row !== null).sort((a, b) => a.title.localeCompare(b.title)) });
    }
    const tree = treeFor(campaignId, rows);
    return tree ? NextResponse.json(tree) : errorResponse("Freight not found", 404);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to load freight tree", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const campaignId = requiredString(body.campaignId, "campaignId").toLowerCase();
    const relation = requiredString(body.relation, "relation");
    if (!["parent", "child", "linked", "require-linked"].includes(relation)) return errorResponse("Invalid freight relationship");
    const otherCampaignId = relation === "require-linked" ? "" : requiredString(body.otherCampaignId, "otherCampaignId").toLowerCase();
    if (campaignId === otherCampaignId) return errorResponse("Choose a different freight");
    const address = normalizeAddress(body.address);
    const nonce = requiredString(body.nonce, "nonce");
    const signature = body.nonceSignature as Record<string, unknown> | null;
    const signType = requiredString(signature?.signType, "nonceSignature.signType");
    if (!address || !walletActionNonceMatchesPurpose(nonce, "freight-tree", address)
      || !Object.values(SignerSignType).includes(signType as SignerSignType)) {
      return errorResponse("A signed freight-tree action is required", 403);
    }
    await verifyWalletSignature({ expectedPurpose: "freight-tree",
      address,
      nonce,
      signature: {
        signature: requiredString(signature?.signature, "nonceSignature.signature"),
        identity: requiredString(signature?.identity, "nonceSignature.identity"),
        signType: signType as SignerSignType,
      },
    });

    const { rows, publications } = await loadFreights();
    const current = rows.get(campaignId);
    const other = otherCampaignId ? rows.get(otherCampaignId) : null;
    if (!current || (otherCampaignId && !other)) return errorResponse("Both freights must be published", 404);
    const currentCreator = await verifiedCreatorAddress(current, publications);
    const otherCreator = other ? await verifiedCreatorAddress(other, publications) : "";
    const collection = await getMongoCollection();

    if ((relation === "parent" || relation === "child") && otherCreator !== address) {
      return errorResponse("Select a freight created by the signing wallet", 403);
    }

    if (relation === "require-linked") {
      if (currentCreator !== address || typeof body.required !== "boolean") {
        return errorResponse("Only this freight's creator can change the linked-freight requirement", 403);
      }
      await collection.updateOne(
        { campaignId, status: "published" },
        { $set: { requiresLinkedFreight: body.required, updatedAt: new Date() } },
      );
      const { rows: updatedRows } = await loadFreights();
      await refreshSubtree(campaignId, updatedRows);
      return NextResponse.json(treeFor(campaignId, updatedRows));
    }

    if (relation === "linked") {
      const isCreator = currentCreator === address;
      const isParticipantLink = current.requiresLinkedFreight === true && otherCreator === address;
      if (!isCreator && !isParticipantLink) return errorResponse("Only the freight creator or an eligible linked-freight creator can link it", 403);
      await collection.updateOne(
        { campaignId, status: "published" },
        { $addToSet: { linkedCampaignIds: otherCampaignId }, $set: { updatedAt: new Date() } },
      );
      const { rows: updatedRows } = await loadFreights();
      if (current.requiresLinkedFreight) await refreshSubtree(campaignId, updatedRows, otherCreator);
      return NextResponse.json(treeFor(campaignId, updatedRows));
    }

    const childId = relation === "parent" ? campaignId : otherCampaignId;
    const parentId = relation === "parent" ? otherCampaignId : campaignId;
    const child = rows.get(childId)!;
    if (parentIds(child).includes(parentId)) return errorResponse("These freights are already linked as parent and child", 409);
    if (sharesDirectChild(parentId, childId, [...rows.values()])
      || ancestorIds(childId, (id) => rows.get(id) ?? null).includes(parentId)) {
      return errorResponse("Absolute links between co-parents or existing ancestors are not supported", 409);
    }
    if (wouldCreateCycle(childId, parentId, (id) => rows.get(id) ?? null)) {
      return errorResponse("That relationship would make a cycle", 409);
    }

    const childCreator = childId === campaignId ? currentCreator : otherCreator;
    const parentCreator = parentId === campaignId ? currentCreator : otherCreator;
    if (!childCreator || !parentCreator) return errorResponse("Both freights need a creator address", 409);
    let encroachmentSnapshot: { actorFbars: number; creatorFbars: number } | null = null;
    if (address !== childCreator) {
      if (address !== parentCreator) return errorResponse("Only the child creator or an encroaching parent creator can add a parent", 403);
      const profiles = await getUserProfilesCollection();
      const [actorProfile, creatorProfile] = await Promise.all([
        profiles.findOne({ address }, { projection: { fbars: 1 } }),
        profiles.findOne({ address: childCreator }, { projection: { fbars: 1 } }),
      ]);
      const actorFbars = Number(actorProfile?.fbars ?? 0);
      const creatorFbars = Number(creatorProfile?.fbars ?? 0);
      if (!canEncroach(actorFbars, creatorFbars)) {
        return errorResponse("Encroachment requires at least 10x the freight creator's current FBARS", 403);
      }
      encroachmentSnapshot = { actorFbars, creatorFbars };
    }

    const linkedAt = new Date().toISOString();
    const linked = await collection.updateOne(
      { campaignId: childId, status: "published", parentCampaignId: { $ne: parentId }, parentCampaignIds: { $ne: parentId } },
      {
        $addToSet: { parentCampaignIds: parentId },
        $push: { parentLinks: { parentCampaignId: parentId, linkedByAddress: address, linkedAt, encroachment: encroachmentSnapshot } },
        $set: { updatedAt: new Date() },
      } as unknown as UpdateFilter<Document>,
    );
    if (!linked.modifiedCount) return errorResponse("This freight was linked by another request", 409);

    const { rows: refreshedRows } = await loadFreights();
    await refreshSubtree(childId, refreshedRows);
    await refreshSubtree(parentId, refreshedRows, childCreator);
    return NextResponse.json(treeFor(campaignId, refreshedRows));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to update freight tree", 500);
  }
}
