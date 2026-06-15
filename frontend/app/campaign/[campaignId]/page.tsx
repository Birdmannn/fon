"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import CampaignCardSurface from "@/app/_components/CampaignCardSurface";
import CampaignCommentsPanel from "@/app/_components/CampaignCommentsPanel";
import { ccc } from "@ckb-ccc/connector-react";
import { CampaignStatus } from "@/lib/contract";
import { bytesToHex, decodeSummary } from "@/lib/encoding";
import { fetchCampaigns, type CampaignCell } from "@/lib/transactions";

type CampaignRecord = {
  _id?: string;
  title?: string;
  description?: string;
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  socialMetadata?: {
    mentions?: string[];
    comments?: Array<{
      text: string;
      creatorAddress?: string | null;
      creatorHandle?: string | null;
      createdAt?: string;
    }>;
  };
  status?: "draft" | "published" | "publish_failed";
  txHash?: string | null;
};

function normalizeHash(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function deriveDisplayStatus(campaign: CampaignCell, nowMs: number = Date.now()) {
  if (campaign.data.status === CampaignStatus.Cancelled || campaign.data.status === CampaignStatus.Completed) {
    return campaign.data.status;
  }

  const createdAtSeconds = Number(campaign.data.createdAt) / 1000;
  const nowSeconds = nowMs / 1000;
  const startsAtSeconds = createdAtSeconds + Number(campaign.data.startDurationSecs);
  const endsAtSeconds = startsAtSeconds + Number(campaign.data.taskDurationSecs);

  if (nowSeconds < startsAtSeconds) {
    return CampaignStatus.Created;
  }

  if (nowSeconds >= endsAtSeconds) {
    return CampaignStatus.Completed;
  }

  return CampaignStatus.Active;
}

function decodeCreatedByAddress(campaign: CampaignCell) {
  return bytesToHex(campaign.data.createdBy);
}

function buildDefaultHandle(addressHex: string) {
  const normalized = addressHex.toLowerCase().replace(/^0x/, "");
  return `freight${normalized.slice(-20)}.ckb`;
}

function splitCampaignId(campaignId: string) {
  const separator = campaignId.lastIndexOf("-");
  if (separator === -1) {
    return null;
  }

  const txHash = campaignId.slice(0, separator);
  const indexText = campaignId.slice(separator + 1);
  const index = Number.parseInt(indexText, 10);
  if (!txHash || !Number.isInteger(index)) {
    return null;
  }

  return { txHash, index };
}

export default function CampaignDetailPage() {
  const { client } = ccc.useCcc();
  const params = useParams<{ campaignId: string }>();
  const campaignRef = splitCampaignId(params.campaignId);
  const [campaigns, setCampaigns] = useState<CampaignCell[]>([]);
  const [recordsByTxHash, setRecordsByTxHash] = useState<Record<string, CampaignRecord>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        setError("");

        const [chainCampaigns, recordsResponse] = await Promise.all([
          fetchCampaigns(client),
          fetch("/api/campaign-records", { cache: "no-store" }),
        ]);

        const recordsPayload = await recordsResponse.json().catch(() => null);
        if (!recordsResponse.ok) {
          throw new Error(recordsPayload?.error ?? "Failed to fetch campaign records");
        }

        const nextRecordsByTxHash: Record<string, CampaignRecord> = {};
        const records = Array.isArray(recordsPayload?.records) ? (recordsPayload.records as CampaignRecord[]) : [];
        for (const record of records) {
          const key = normalizeHash(record.txHash);
          if (key && !nextRecordsByTxHash[key]) {
            nextRecordsByTxHash[key] = record;
          }
        }

        if (!cancelled) {
          setCampaigns(chainCampaigns);
          setRecordsByTxHash(nextRecordsByTxHash);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load campaign detail");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const selectedCampaign = useMemo(() => {
    if (!campaignRef) {
      return null;
    }

    return campaigns.find((campaign) => (
      normalizeHash(campaign.outPoint.txHash) === normalizeHash(campaignRef.txHash)
      && campaign.outPoint.index === campaignRef.index
    )) ?? null;
  }, [campaignRef, campaigns]);

  const selectedRecord = useMemo(() => {
    if (!selectedCampaign) {
      return null;
    }

    return recordsByTxHash[normalizeHash(selectedCampaign.outPoint.txHash)] ?? null;
  }, [recordsByTxHash, selectedCampaign]);

  const comments = useMemo(() => (
    Array.isArray(selectedRecord?.socialMetadata?.comments)
      ? selectedRecord.socialMetadata.comments.filter((value) => !!value && typeof value.text === "string")
      : []
  ), [selectedRecord?.socialMetadata?.comments]);

  if (loading) {
    return <main className="campaign-detail-page"><p className="text-sm text-gray-400">Loading campaign…</p></main>;
  }

  if (error) {
    return <main className="campaign-detail-page"><p className="text-sm text-gray-400">{error}</p></main>;
  }

  if (!selectedCampaign) {
    return <main className="campaign-detail-page"><p className="text-sm text-gray-400">Campaign not found.</p></main>;
  }

  const displayStatus = deriveDisplayStatus(selectedCampaign, nowMs);
  const creatorAddress = selectedRecord?.creatorAddress ?? decodeCreatedByAddress(selectedCampaign);
  const creatorHandle = selectedRecord?.creatorHandle ?? buildDefaultHandle(creatorAddress);
  const summary = selectedRecord?.summaryDraft ?? decodeSummary(selectedCampaign.data.summary);
  const title = selectedRecord?.title?.trim() || summary;

  return (
    <main className="campaign-detail-page">
      <div className="campaign-detail-shell">
        <div className="campaign-detail-header">
          <Link href="/" className="campaign-detail-back-link">← Back to freights</Link>
          <div className="campaign-detail-header-copy">
            <p className="campaign-detail-eyebrow">Campaign detail</p>
            <h1 className="campaign-detail-heading">{title}</h1>
            <p className="campaign-detail-subtitle">{creatorHandle}</p>
          </div>
        </div>

        <div className="campaign-detail-content">
          <section className="campaign-detail-post-column">
            <CampaignCardSurface
              campaign={selectedCampaign}
              record={selectedRecord}
              displayStatus={displayStatus}
              nowMs={nowMs}
              variant="detail"
            />
          </section>

          <section className="campaign-detail-comments-column">
            <CampaignCommentsPanel comments={comments} fallbackAddress={creatorAddress} />
          </section>
        </div>
      </div>
    </main>
  );
}
