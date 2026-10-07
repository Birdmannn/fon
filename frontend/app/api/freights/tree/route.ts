import { Address, SignerSignType } from "@ckb-ccc/core";
import { NextResponse } from "next/server";

import { buildStableCampaignId } from "@/lib/campaignIdentity";
import { getPublicCkbClient } from "@/lib/ckbClient";
import { bytesToHex, lockScriptToAddressBytes } from "@/lib/encoding";
import { canEncroach, wouldCreateCycle } from "@/lib/freightTree";
import { verifyWalletSignature, walletActionNonceMatchesPurpose } from "@/lib/googleAuth";
import { getCampaignParticipantFinalizationsCollection, getCampaignParticipantsCollection, getMongoCollection, getUserProfilesCollection } from "@/lib/mongodb";
import { dispatchMountedAppRequestsForParticipant, finalizeCampaignParticipant } from "@/lib/mountableAppRuntime";

export const dynamic = "force-dynamic";

type FreightRow = {
  campaignId: string;
  title?: string;
  description?: string;
  creatorAddress?: string;
  createdByHash?: string;
  chainCreatedAt?: string;
  campaignType?: number;
  parentCampaignId?: string | null;
  parentLinkedByAddress?: string;
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
    { projection: { _id: 0, campaignId: 1, title: 1, description: 1, creatorAddress: 1, createdByHash: 1, chainCreatedAt: 1, campaignType: 1, parentCampaignId: 1, parentLinkedByAddress: 1, linkedCampaignIds: 1, requiresLinkedFreight: 1 } },
  ).toArray() as unknown as FreightRow[];
  return new Map(rows.map((row) => [row.campaignId.trim().toLowerCase(), row]));
}

function treeFor(campaignId: string, rows: Map<string, FreightRow>) {
  const current = rows.get(campaignId);
  if (!current) return null;
  const seen = new Set<string>();
  let rootId = campaignId;
  while (rows.get(rootId)?.parentCampaignId) {
    if (seen.has(rootId)) throw new Error("Freight tree contains a cycle");
    seen.add(rootId);
    rootId = rows.get(rootId)?.parentCampaignId?.toLowerCase() ?? rootId;
    if (!rows.has(rootId)) throw new Error("Freight parent is unavailable");
  }
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  const nodes: Array<FreightRow & { depth: number }> = [];
  const visited = new Set<string>();
  while (queue.length) {
    const next = queue.shift();
    if (!next || visited.has(next.id)) continue;
    visited.add(next.id);
    const row = rows.get(next.id);
    if (!row) continue;
    nodes.push({ ...row, depth: next.depth });
    for (const [id, child] of rows) {
      if (child.parentCampaignId?.toLowerCase() === next.id) queue.push({ id, depth: next.depth + 1 });
    }
  }
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
      if (row.parentCampaignId?.toLowerCase() === id) queue.push(candidateId);
    }
  }
  return result;
}

async function verifiedCreatorAddress(row: FreightRow) {
  const address = normalizeAddress(row.creatorAddress);
  const stableId = buildStableCampaignId(row.createdByHash, row.chainCreatedAt, row.campaignType);
  if (!address || !stableId || stableId !== row.campaignId.toLowerCase()) {
    throw new Error("Freight creator identity is incomplete");
  }
  const parsed = await Address.fromString(address, getPublicCkbClient());
  if (bytesToHex(lockScriptToAddressBytes(parsed.script)) !== row.createdByHash?.toLowerCase()) {
    throw new Error("Freight creator address does not match its on-chain identity");
  }
  return address;
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
    const campaignId = requiredString(new URL(request.url).searchParams.get("campaignId"), "campaignId").toLowerCase();
    const tree = treeFor(campaignId, await loadFreights());
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
    await verifyWalletSignature({
      address,
      nonce,
      signature: {
        signature: requiredString(signature?.signature, "nonceSignature.signature"),
        identity: requiredString(signature?.identity, "nonceSignature.identity"),
        signType: signType as SignerSignType,
      },
    });

    const rows = await loadFreights();
    const current = rows.get(campaignId);
    const other = otherCampaignId ? rows.get(otherCampaignId) : null;
    if (!current || (otherCampaignId && !other)) return errorResponse("Both freights must be published", 404);
    const currentCreator = await verifiedCreatorAddress(current);
    const otherCreator = other ? await verifiedCreatorAddress(other) : "";
    const collection = await getMongoCollection();

    if (relation === "require-linked") {
      if (currentCreator !== address || typeof body.required !== "boolean") {
        return errorResponse("Only this freight's creator can change the linked-freight requirement", 403);
      }
      await collection.updateOne(
        { campaignId, status: "published" },
        { $set: { requiresLinkedFreight: body.required, updatedAt: new Date() } },
      );
      const updatedRows = await loadFreights();
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
      const updatedRows = await loadFreights();
      if (current.requiresLinkedFreight) await refreshSubtree(campaignId, updatedRows, otherCreator);
      return NextResponse.json(treeFor(campaignId, updatedRows));
    }

    const childId = relation === "parent" ? campaignId : otherCampaignId;
    const parentId = relation === "parent" ? otherCampaignId : campaignId;
    const child = rows.get(childId)!;
    if (child.parentCampaignId && child.parentCampaignId.toLowerCase() !== parentId) {
      return errorResponse("This freight already has a parent", 409);
    }
    if (!child.parentCampaignId && wouldCreateCycle(childId, parentId, (id) => rows.get(id) ?? null)) {
      return errorResponse("That relationship would make a cycle", 409);
    }

    const childCreator = childId === campaignId ? currentCreator : otherCreator;
    const parentCreator = parentId === campaignId ? currentCreator : otherCreator;
    if (!childCreator || !parentCreator) return errorResponse("Both freights need a creator address", 409);
    let encroachmentSnapshot: { actorFbars: number; creatorFbars: number } | null = null;
    if (address !== childCreator && !(child.parentCampaignId && normalizeAddress(child.parentLinkedByAddress) === address)) {
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

    if (!child.parentCampaignId) {
      const linked = await collection.updateOne(
        { campaignId: childId, status: "published", $or: [{ parentCampaignId: null }, { parentCampaignId: { $exists: false } }] },
        { $set: {
          parentCampaignId: parentId,
          parentLinkedByAddress: address,
          parentLinkedAt: new Date().toISOString(),
          parentEncroachment: encroachmentSnapshot,
          updatedAt: new Date(),
        } },
      );
      if (!linked.modifiedCount) return errorResponse("This freight was linked by another request", 409);
    }

    const refreshedRows = await loadFreights();
    await refreshSubtree(childId, refreshedRows);
    return NextResponse.json(treeFor(campaignId, refreshedRows));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to update freight tree", 500);
  }
}
