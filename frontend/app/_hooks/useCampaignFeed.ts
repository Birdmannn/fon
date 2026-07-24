"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildDefaultHandle, deriveDisplayStatus } from "@/lib/campaignDisplay";
import {
  buildCampaignRecordIndexes,
  findCampaignRecord,
  getCampaignStableId,
  getRecordStableId,
  type CampaignRecordIndexes,
} from "@/lib/campaignIdentity";
import { bytesToHex, decodeSummary } from "@/lib/encoding";
import { fetchCampaigns, type CampaignCell } from "@/lib/transactions";

export type CampaignComment = {
  text: string;
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  createdAt?: string;
};

export type CampaignRecord = {
  _id?: string;
  title?: string;
  description?: string;
  campaignId?: string | null;
  createdByHash?: string | null;
  chainCreatedAt?: string | null;
  campaignType?: number;
  summaryDraft?: string;
  argsDraft?: {
    taskStartDelayHours?: string;
    taskDurationHours?: string;
    maxAmountCkb?: string;
    auxAmountCkb?: string;
    rewardCount?: string;
  };
  mountables?: {
    forms?: {
      enabled?: boolean;
      formUrl?: string;
      canonicalFormUrl?: string;
      formId?: string;
      validatedAt?: string;
      payoutMode?: "assured" | "random_subset" | "overflow_only";
      proofMode?: "external_proof";
      guaranteedSlots?: string;
      randomWinnerCount?: string;
      proofInstructions?: string;
    } | null;
  };
  socialMetadata?: {
    mentions?: string[];
    comments?: unknown[];
    likeCount?: number;
    likedByAddresses?: string[];
    bookmarkCount?: number;
    reshareCount?: number;
    resharedByAddresses?: string[];
  };
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  status?: "draft" | "published" | "publish_failed";
  txHash?: string | null;
  publishError?: string | null;
  randomnessPreimage?: string | null;
  activatedTxHash?: string | null;
  settlementTxHash?: string | null;
  settledAt?: string | null;
  soldTicketCount?: string | null;
  settledParticipantCount?: string | null;
  settledRecipients?: Array<{
    address: string;
    username: string;
    handle: string;
    amountLabel: string;
  }> | null;
};

export type MergedCampaign = {
  campaign: CampaignCell;
  record: CampaignRecord | null;
  displayStatus: number;
};

const EMPTY_CAMPAIGN_RECORD_INDEXES: CampaignRecordIndexes<CampaignRecord> = {
  byCampaignId: {},
  byTxHash: {},
  byLegacyKey: {},
};

function formatCompactCampaignCount(count: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(count).toLowerCase();
}

type UseCampaignFeedArgs = {
  client: ccc.Client;
  onErrorChange: (message: string) => void;
};

export function useCampaignFeed({ client, onErrorChange }: UseCampaignFeedArgs) {
  const [campaigns, setCampaigns] = useState<CampaignCell[]>([]);
  const [recordIndexes, setRecordIndexes] = useState<CampaignRecordIndexes<CampaignRecord>>(() => ({ ...EMPTY_CAMPAIGN_RECORD_INDEXES }));
  const [pendingCampaigns, setPendingCampaigns] = useState<CampaignCell[] | null>(null);
  const [pendingRecordIndexes, setPendingRecordIndexes] = useState<CampaignRecordIndexes<CampaignRecord> | null>(null);
  const [unseenCampaignCount, setUnseenCampaignCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [shouldScrollToNewest, setShouldScrollToNewest] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const campaignsRef = useRef<CampaignCell[]>(campaigns);

  const handleTicketBought = useCallback((campaignId: string, ticketPrice: bigint) => {
    setCampaigns((prev) =>
      prev.map((c) =>
        getCampaignStableId(c) === campaignId
          ? { ...c, data: { ...c.data, currentDeposits: c.data.currentDeposits + ticketPrice } }
          : c
      )
    );
  }, []);

  const handleSettlementCompleted = useCallback((
    campaignId: string,
    settlementTxHash: string,
    settledAt: string,
    soldTicketCount: string,
    settledParticipantCount?: string | null,
    settledRecipients?: CampaignRecord["settledRecipients"]
  ) => {
    const updateIndexes = (prev: CampaignRecordIndexes<CampaignRecord>) => {
      const matchedRecord = prev.byCampaignId[campaignId]
        ?? Object.values(prev.byTxHash).find((record) => getRecordStableId(record) === campaignId)
        ?? Object.values(prev.byLegacyKey).find((record) => getRecordStableId(record) === campaignId);

      if (!matchedRecord) {
        return prev;
      }

      const nextRecord: CampaignRecord = {
        ...matchedRecord,
        settlementTxHash,
        settledAt,
        soldTicketCount,
        settledParticipantCount: settledParticipantCount ?? matchedRecord.settledParticipantCount ?? null,
        settledRecipients: settledRecipients ?? matchedRecord.settledRecipients ?? null,
      };
      const shouldReplace = (record: CampaignRecord) => (
        record === matchedRecord
        || (!!record._id && !!matchedRecord._id && record._id === matchedRecord._id)
      );
      const replaceBucket = (bucket: Record<string, CampaignRecord>) => Object.fromEntries(
        Object.entries(bucket).map(([key, value]) => [key, shouldReplace(value) ? nextRecord : value])
      ) as Record<string, CampaignRecord>;

      return {
        byCampaignId: replaceBucket(prev.byCampaignId),
        byTxHash: replaceBucket(prev.byTxHash),
        byLegacyKey: replaceBucket(prev.byLegacyKey),
      };
    };

    setRecordIndexes(updateIndexes);
    setPendingRecordIndexes((prev) => (prev ? updateIndexes(prev) : prev));
  }, []);

  const buildRecordIndexes = useCallback((records: CampaignRecord[]) => {
    const nextRecordIndexes = buildCampaignRecordIndexes(records);

    // console.log("[campaign-records] published records from API", records.map((record) => ({
    //   id: record._id ?? null,
    //   campaignId: record.campaignId ?? null,
    //   createdByHash: record.createdByHash ?? null,
    //   chainCreatedAt: record.chainCreatedAt ?? null,
    //   txHash: record.txHash ?? null,
    //   normalizedTxHash: normalizeHash(record.txHash),
    //   status: record.status ?? null,
    //   hasRandomnessPreimage: typeof record.randomnessPreimage === "string" && record.randomnessPreimage.length > 0,
    //   randomnessPreimage: record.randomnessPreimage ?? null,
    // })));

    // console.log("[campaign-records] stable index keys", {
    //   campaignIds: Object.keys(nextRecordIndexes.byCampaignId),
    //   txHashes: Object.keys(nextRecordIndexes.byTxHash),
    //   legacyKeys: Object.keys(nextRecordIndexes.byLegacyKey),
    // });

    return nextRecordIndexes;
  }, []);

  useEffect(() => {
    campaignsRef.current = campaigns;
  }, [campaigns]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const refreshCampaigns = useCallback((preserveVisibleList: boolean, visibleCampaigns?: CampaignCell[]) => {
    const activeVisibleCampaigns: CampaignCell[] = visibleCampaigns ?? campaignsRef.current;
    if (!preserveVisibleList) {
      setLoading(true);
    }

    setError("");
    setIsRefreshing(true);

    Promise.all([
      fetchCampaigns(client),
      fetch("/api/campaign-records", { cache: "no-store" }).then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error ?? "Failed to fetch campaign records");
        }

        return Array.isArray(data?.records) ? (data.records as CampaignRecord[]) : [];
      }),
    ])
      .then(([chainCampaigns, records]) => {
        const nextRecordIndexes = buildRecordIndexes(records);

        // console.log("[campaign-records] fetched campaigns and records", {
        //   chainCampaigns: chainCampaigns.map((campaign) => ({
        //     txHash: campaign.outPoint.txHash,
        //     normalizedTxHash: normalizeHash(campaign.outPoint.txHash),
        //     campaignId: getCampaignStableId(campaign),
        //     createdByHash: getCampaignCreatedByHash(campaign),
        //     chainCreatedAt: getCampaignChainCreatedAt(campaign),
        //     index: campaign.outPoint.index,
        //     campaignType: campaign.data.campaignType,
        //   })),
        //   recordCount: records.length,
        //   recordCampaignIds: Object.keys(nextRecordIndexes.byCampaignId),
        //   recordTxHashes: Object.keys(nextRecordIndexes.byTxHash),
        // });

        if (!preserveVisibleList || activeVisibleCampaigns.length === 0) {
          setCampaigns(chainCampaigns);
          setRecordIndexes(nextRecordIndexes);
          setPendingCampaigns(null);
          setPendingRecordIndexes(null);
          setUnseenCampaignCount(0);
          return;
        }

        const currentKeys = new Set(activeVisibleCampaigns.map(getCampaignStableId));
        let nextUnseenCount = 0;

        for (const campaign of chainCampaigns) {
          const key = getCampaignStableId(campaign);
          if (currentKeys.has(key)) {
            break;
          }
          nextUnseenCount += 1;
        }

        if (nextUnseenCount > 0) {
          setPendingCampaigns(chainCampaigns);
          setPendingRecordIndexes(nextRecordIndexes);
          setUnseenCampaignCount(nextUnseenCount);
          return;
        }

        setCampaigns(chainCampaigns);
        setRecordIndexes(nextRecordIndexes);
        setPendingCampaigns(null);
        setPendingRecordIndexes(null);
        setUnseenCampaignCount(0);
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        onErrorChange(message);
      })
      .finally(() => {
        setLoading(false);
        setIsRefreshing(false);
      });
  }, [buildRecordIndexes, client, onErrorChange]);

  useEffect(() => {
    const loadTimer = setTimeout(() => {
      refreshCampaigns(false);
    }, 0);

    return () => {
      clearTimeout(loadTimer);
    };
  }, [refreshCampaigns]);

  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchOpen]);

  const handleRefresh = useCallback(() => {
    refreshCampaigns(campaigns.length > 0, campaigns);
  }, [campaigns, refreshCampaigns]);

  const handleSearchClick = useCallback(() => {
    setIsSearchOpen((prev) => {
      const next = !prev;
      if (!next) {
        setSearchQuery("");
      }
      return next;
    });
  }, []);

  const handleShowPendingCampaigns = useCallback(() => {
    if (!pendingCampaigns || !pendingRecordIndexes) {
      return;
    }

    setCampaigns(pendingCampaigns);
    setRecordIndexes(pendingRecordIndexes);
    setPendingCampaigns(null);
    setPendingRecordIndexes(null);
    setUnseenCampaignCount(0);
    setShouldScrollToNewest(true);
  }, [pendingCampaigns, pendingRecordIndexes]);

  const mergedCampaigns = useMemo(() => {
    return campaigns.map((campaign) => {
      const matchedRecord = findCampaignRecord(recordIndexes, campaign);

      // console.log("[campaign-records] merge campaign with record", {
      //   campaignTxHash: campaign.outPoint.txHash,
      //   normalizedCampaignTxHash: normalizeHash(campaign.outPoint.txHash),
      //   campaignId: getCampaignStableId(campaign),
      //   createdByHash: getCampaignCreatedByHash(campaign),
      //   chainCreatedAt: getCampaignChainCreatedAt(campaign),
      //   matchedRecordId: matchedRecord?._id ?? null,
      //   matchedRecordCampaignId: matchedRecord?.campaignId ?? null,
      //   matchedRecordTxHash: matchedRecord?.txHash ?? null,
      //   matchedRecordHasPreimage: typeof matchedRecord?.randomnessPreimage === "string" && matchedRecord.randomnessPreimage.length > 0,
      //   matchedRecordStatus: matchedRecord?.status ?? null,
      // });

      return {
        campaign,
        record: matchedRecord,
        displayStatus: deriveDisplayStatus(campaign, nowMs),
      };
    });
  }, [campaigns, nowMs, recordIndexes]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredCampaigns = useMemo(() => {
    if (!normalizedSearchQuery) {
      return mergedCampaigns;
    }

    return mergedCampaigns.filter(({ campaign, record }) => {
      const creatorAddress = record?.creatorAddress ?? bytesToHex(campaign.data.createdBy);
      const creatorHandle = record?.creatorHandle ?? buildDefaultHandle(creatorAddress);
      const summary = record?.summaryDraft ?? decodeSummary(campaign.data.summary);
      const searchable = [
        record?.title,
        record?.description,
        summary,
        creatorAddress,
        creatorHandle,
        ["Simple Task", "Funded Task", "Crowdfunding", "Timed Challenge", "Raffle"][campaign.data.campaignType],
        ["SimpleTask", "FundedTask", "Crowdfunding", "TimedChallenge", "Raffle"][campaign.data.campaignType],
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();

      return searchable.includes(normalizedSearchQuery);
    });
  }, [mergedCampaigns, normalizedSearchQuery]);

  return {
    filteredCampaigns,
    handleRefresh,
    handleSearchClick,
    handleSettlementCompleted,
    handleShowPendingCampaigns,
    handleTicketBought,
    isRefreshing,
    isSearchOpen,
    loading,
    nowMs,
    searchInputRef,
    searchQuery,
    setSearchQuery,
    shouldScrollToNewest,
    setShouldScrollToNewest,
    error,
    unseenCampaignCount,
    unseenCampaignBadgeLabel: unseenCampaignCount > 0 ? formatCompactCampaignCount(unseenCampaignCount) : null,
  };
}
