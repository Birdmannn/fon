"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { CampaignRecord } from "@/app/_types/campaignRecords";
export type { CampaignComment, CampaignRecord } from "@/app/_types/campaignRecords";
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

function withLiveRaffleTicketCounts(campaigns: CampaignCell[], records: CampaignRecord[], participantCounts: Record<string, number>) {
  return records.map((record) => {
    const explicitCampaignId = typeof record.campaignId === "string" ? record.campaignId.trim().toLowerCase() : "";
    const matchedCampaign = explicitCampaignId
      ? campaigns.find((campaign) => getCampaignStableId(campaign) === explicitCampaignId)
      : null;
    const isRaffleCampaign = matchedCampaign?.data.campaignType === 4 || record.campaignType === 4;
    if (!isRaffleCampaign) {
      return record;
    }

    const campaignId = explicitCampaignId || (matchedCampaign ? getCampaignStableId(matchedCampaign) : "");
    if (!campaignId) {
      return record;
    }

    const participantCount = participantCounts[campaignId];
    if (!Number.isInteger(participantCount) || participantCount < 0) {
      return record;
    }

    return {
      ...record,
      liveSoldTicketCount: String(participantCount),
    };
  });
}

function formatCompactCampaignCount(count: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(count).toLowerCase();
}

type CampaignFeedContextValue = {
  campaigns: CampaignCell[];
  clearShouldScrollToNewest: () => void;
  ensureLoaded: () => void;
  error: string;
  handleRefresh: () => void;
  handleSearchClick: () => void;
  handleSettlementCompleted: (
    campaignId: string,
    settlementTxHash: string,
    settledAt: string,
    soldTicketCount: string,
    settledParticipantCount?: string | null,
    settledRecipients?: CampaignRecord["settledRecipients"],
  ) => void;
  handleShowPendingCampaigns: () => void;
  handleTicketBought: (campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void;
  isRefreshing: boolean;
  isSearchOpen: boolean;
  loading: boolean;
  recordIndexes: CampaignRecordIndexes<CampaignRecord>;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  shouldScrollToNewest: boolean;
  unseenCampaignCount: number;
  unseenCampaignBadgeLabel: string | null;
};

const CampaignFeedContext = createContext<CampaignFeedContextValue | null>(null);

export function CampaignFeedProvider({ children }: { children: React.ReactNode }) {
  const { client } = ccc.useCcc();
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
  const campaignsRef = useRef<CampaignCell[]>(campaigns);
  const hasLoadedOnceRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const previousClientRef = useRef<ccc.Client | null>(null);

  campaignsRef.current = campaigns;

  const buildRecordIndexes = useCallback((records: CampaignRecord[]) => {
    return buildCampaignRecordIndexes(records);
  }, []);

  const refreshCampaigns = useCallback(async (preserveVisibleList: boolean, visibleCampaigns?: CampaignCell[]) => {
    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    const activeVisibleCampaigns: CampaignCell[] = visibleCampaigns ?? campaignsRef.current;
    if (!preserveVisibleList) {
      setLoading(true);
    }

    setError("");
    setIsRefreshing(true);

    try {
      const [chainCampaigns, records] = await Promise.all([
        fetchCampaigns(client),
        fetch("/api/campaign-records", { cache: "no-store" }).then(async (response) => {
          const data = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(data?.error ?? "Failed to fetch campaign records");
          }

          return Array.isArray(data?.records) ? (data.records as CampaignRecord[]) : [];
        }),
      ]);

      const raffleCampaignIds = chainCampaigns
        .filter((campaign) => campaign.data.campaignType === 4)
        .map((campaign) => getCampaignStableId(campaign));
      const participantCounts = raffleCampaignIds.length > 0
        ? Object.fromEntries(await Promise.all(
            raffleCampaignIds.map(async (campaignId) => {
              try {
                const response = await fetch(`/api/campaign-participants?campaignId=${encodeURIComponent(campaignId)}`, { cache: "no-store" });
                const data = await response.json().catch(() => null);
                const participants = response.ok && Array.isArray(data?.participants) ? data.participants : [];
                return [campaignId, participants.length] as const;
              } catch {
                return [campaignId, 0] as const;
              }
            })
          ))
        : {};
      const nextRecordIndexes = buildRecordIndexes(withLiveRaffleTicketCounts(chainCampaigns, records, participantCounts));

      if (!preserveVisibleList || activeVisibleCampaigns.length === 0) {
        setCampaigns(chainCampaigns);
        setRecordIndexes(nextRecordIndexes);
        setPendingCampaigns(null);
        setPendingRecordIndexes(null);
        setUnseenCampaignCount(0);
        hasLoadedOnceRef.current = true;
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
        hasLoadedOnceRef.current = true;
        return;
      }

      setCampaigns(chainCampaigns);
      setRecordIndexes(nextRecordIndexes);
      setPendingCampaigns(null);
      setPendingRecordIndexes(null);
      setUnseenCampaignCount(0);
      hasLoadedOnceRef.current = true;
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      setError(message);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      refreshInFlightRef.current = false;
    }
  }, [buildRecordIndexes, client]);

  const ensureLoaded = useCallback(() => {
    if (hasLoadedOnceRef.current || refreshInFlightRef.current) {
      return;
    }

    void refreshCampaigns(false);
  }, [refreshCampaigns]);

  useEffect(() => {
    if (previousClientRef.current && previousClientRef.current !== client && hasLoadedOnceRef.current) {
      void refreshCampaigns(false);
    }

    previousClientRef.current = client;
  }, [client, refreshCampaigns]);

  const handleTicketBought = useCallback((campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => {
    setCampaigns((prev) =>
      prev.map((campaign) =>
        getCampaignStableId(campaign) === campaignId
          ? { ...campaign, data: { ...campaign.data, currentDeposits: campaign.data.currentDeposits + ticketPrice } }
          : campaign
      )
    );

    const updateIndexes = (prev: CampaignRecordIndexes<CampaignRecord>) => {
      const matchedRecord = prev.byCampaignId[campaignId]
        ?? Object.values(prev.byTxHash).find((record) => getRecordStableId(record) === campaignId)
        ?? Object.values(prev.byLegacyKey).find((record) => getRecordStableId(record) === campaignId);

      if (!matchedRecord) {
        return prev;
      }

      const nextRecord: CampaignRecord = {
        ...matchedRecord,
        liveSoldTicketCount: String(nextSoldTickets),
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

  const handleSettlementCompleted = useCallback((
    campaignId: string,
    settlementTxHash: string,
    settledAt: string,
    soldTicketCount: string,
    settledParticipantCount?: string | null,
    settledRecipients?: CampaignRecord["settledRecipients"],
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

  const handleRefresh = useCallback(() => {
    void refreshCampaigns(campaigns.length > 0, campaigns);
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

  const value = useMemo<CampaignFeedContextValue>(() => ({
    campaigns,
    clearShouldScrollToNewest: () => setShouldScrollToNewest(false),
    ensureLoaded,
    error,
    handleRefresh,
    handleSearchClick,
    handleSettlementCompleted,
    handleShowPendingCampaigns,
    handleTicketBought,
    isRefreshing,
    isSearchOpen,
    loading,
    recordIndexes,
    searchQuery,
    setSearchQuery,
    shouldScrollToNewest,
    unseenCampaignCount,
    unseenCampaignBadgeLabel: unseenCampaignCount > 0 ? formatCompactCampaignCount(unseenCampaignCount) : null,
  }), [
    campaigns,
    ensureLoaded,
    error,
    handleRefresh,
    handleSearchClick,
    handleSettlementCompleted,
    handleShowPendingCampaigns,
    handleTicketBought,
    isRefreshing,
    isSearchOpen,
    loading,
    recordIndexes,
    searchQuery,
    shouldScrollToNewest,
    unseenCampaignCount,
  ]);

  return createElement(CampaignFeedContext.Provider, { value }, children);
}

export function useCampaignFeed() {
  const context = useContext(CampaignFeedContext);
  if (!context) {
    throw new Error("useCampaignFeed must be used within a CampaignFeedProvider");
  }

  const [nowMs, setNowMs] = useState(() => Date.now());
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (context.isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [context.isSearchOpen]);

  const mergedCampaigns = useMemo(() => {
    return context.campaigns.map((campaign) => {
      const matchedRecord = findCampaignRecord(context.recordIndexes, campaign);

      return {
        campaign,
        record: matchedRecord,
        displayStatus: deriveDisplayStatus(campaign, nowMs),
      };
    });
  }, [context.campaigns, context.recordIndexes, nowMs]);

  const normalizedSearchQuery = context.searchQuery.trim().toLowerCase();
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
    ...context,
    filteredCampaigns,
    nowMs,
    searchInputRef,
  };
}
