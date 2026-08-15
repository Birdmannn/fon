"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { canAccessLockMountable, getLockMountableBypassFbars } from "@/app/_lib/lockMountable";
import type { CampaignComment, CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import type { SettlementModalData, SettlementRecipient } from "@/app/_types/settlement";
import {
  buildDefaultHandle,
  buildDefaultUsername,
  decodeCreatedByAddress,
  deriveRaffleSettlementUiState,
  formatCkbAmount,
} from "@/lib/campaignDisplay";
import {
  computeGiftPreviewAllocations,
  isGiftApprovalSatisfied,
  isGiftClaimOpen,
  parseStoredGiftDeliverable,
} from "@/lib/giftDeliverables";
import { CampaignStatus } from "@/lib/contract";
import { bytesToHex, decodeSummary, hexToBytes, lockScriptToAddressBytes } from "@/lib/encoding";
import { copyText } from "@/lib/clipboard";
import { getCampaignChainCreatedAt, getCampaignCreatedByHash, getCampaignStableId, normalizeHash } from "@/lib/campaignIdentity";
import { deriveCampaignSupportState } from "@/lib/campaignTipping";
import {
  fetchParticipants,
  previewDeterministicWinners,
  sendBatchDeliver,
  sendCreatorTipShannons,
  sendDepositShannons,
  type CampaignCell,
} from "@/lib/transactions";
import { ccc } from "@ckb-ccc/connector-react";

function parseOptionalBigInt(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

async function hasSettlementCreatorPermission(
  signer: ccc.Signer | null,
  client: ccc.Client,
  campaign: CampaignCell,
  currentWalletAddress: string | null,
  record: CampaignRecord | null
): Promise<boolean> {
  if (!signer || !currentWalletAddress) {
    return false;
  }

  const walletAddressObj = await signer.getRecommendedAddressObj();
  const walletHash = bytesToHex(lockScriptToAddressBytes(walletAddressObj.script));

  if (record?.creatorAddress) {
    try {
      const recordAddress = await ccc.Address.fromString(record.creatorAddress, client);
      const recordHash = bytesToHex(lockScriptToAddressBytes(recordAddress.script));
      if (recordHash === walletHash) {
        return true;
      }
    } catch {
      const normalizedCreatorHex = record.creatorAddress.toLowerCase().replace(/^0x/, "");
      if (normalizedCreatorHex.length === 40) {
        return walletHash.slice(2) === normalizedCreatorHex;
      }
    }
  }

  return walletHash === bytesToHex(campaign.data.createdBy);
}

type UseCampaignCardStateArgs = {
  campaign: CampaignCell;
  record: CampaignRecord | null;
  displayStatus: CampaignStatus;
  signer: ccc.Signer | null;
  client: ccc.Client;
  currentViewerFbars?: number | null;
  currentWalletAddress: string | null;
  onCommentDiscardRequest: (cardId: string) => void;
  commentDiscardDecision: { cardId: string; discard: boolean } | null;
  onSettlementCompleted: (
    campaignId: string,
    settlementTxHash: string,
    settledAt: string,
    soldTicketCount: string,
    settledParticipantCount?: string | null,
    settledRecipients?: CampaignRecord["settledRecipients"]
  ) => void;
  onSettlementInfoRequest: (data: SettlementModalData) => void;
};

export function useCampaignCardState({
  campaign: c,
  record,
  displayStatus,
  signer,
  client,
  currentViewerFbars,
  currentWalletAddress,
  onCommentDiscardRequest,
  commentDiscardDecision,
  onSettlementCompleted,
  onSettlementInfoRequest,
}: UseCampaignCardStateArgs) {
  const { data, outPoint } = c;
  const cardId = getCampaignStableId(c);
  const maxCkb = formatCkbAmount(data.maximumAmount);
  const depositedCkb = formatCkbAmount(data.currentDeposits);
  const isRaffleCampaign = data.campaignType === 4;
  const ticketPriceShannons = data.auxAmount > 0n ? data.auxAmount : 0n;
  const totalTickets = isRaffleCampaign && ticketPriceShannons > 0n ? data.maximumAmount / ticketPriceShannons : 0n;
  const remainingDepositCapacity = data.maximumAmount > data.currentDeposits ? data.maximumAmount - data.currentDeposits : 0n;
  const onchainSummary = decodeSummary(data.summary);
  const creatorAddress = record?.creatorAddress || decodeCreatedByAddress(c);
  const creatorHandle = record?.creatorHandle || buildDefaultHandle(creatorAddress);
  const displayTitle = record?.title?.trim() || onchainSummary;
  const displayDescription = record?.description?.trim() || onchainSummary;
  const supportState = deriveCampaignSupportState({
    campaignType: data.campaignType,
    currentDeposits: data.currentDeposits,
    description: record?.description?.trim() || onchainSummary,
  });
  const mentions = record?.socialMetadata?.mentions ?? [];
  const rewardCountValue = Number(data.rewardCount);
  const giftDeliverable = parseStoredGiftDeliverable(record?.giftDeliverable);
  const giftPreview = computeGiftPreviewAllocations({
    claimants: giftDeliverable.claimants,
    maxAmountCkb: record?.argsDraft?.maxAmountCkb ?? formatCkbAmount(data.maximumAmount),
    rewardCount: record?.argsDraft?.rewardCount ?? String(rewardCountValue),
    ratioEntries: giftDeliverable.ratioEntries,
    splitMode: giftDeliverable.splitMode,
  });
  const giftApprovalSatisfied = isGiftApprovalSatisfied(giftDeliverable);
  const giftClaimOpen = isGiftClaimOpen({
    chainCreatedAt: record?.chainCreatedAt ?? getCampaignChainCreatedAt(c),
    taskStartDelayHours: record?.argsDraft?.taskStartDelayHours ?? String(Number(data.startDurationSecs) / 3600),
    giftDeliverable,
  });
  const hasReachedMaxAmount = remainingDepositCapacity <= 0n;
  const isCampaignInactive = displayStatus === CampaignStatus.Completed || displayStatus === CampaignStatus.Cancelled;
  const hasNotStartedRaffle = isRaffleCampaign && displayStatus === CampaignStatus.Created;
  const liveSoldTickets = parseOptionalBigInt(record?.liveSoldTicketCount);
  const settlementUiState = deriveRaffleSettlementUiState({
    campaign: c,
    displayStatus,
    settlementTxHash: record?.settlementTxHash ?? null,
    soldTicketCount: record?.soldTicketCount ?? null,
    liveSoldTickets,
  });
  const soldTickets = settlementUiState.soldTickets;
  const remainingTickets = totalTickets > soldTickets ? totalTickets - soldTickets : 0n;
  const hasNoRemainingTickets = isRaffleCampaign && remainingTickets <= 0n;
  const initialComments = useMemo<CampaignComment[]>(() => (
    Array.isArray(record?.socialMetadata?.comments)
      ? record.socialMetadata.comments.filter((value): value is CampaignComment => !!value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string")
      : []
  ), [record?.socialMetadata?.comments]);
  const initialLikedByAddresses = useMemo(() => (
    Array.isArray(record?.socialMetadata?.likedByAddresses)
      ? record.socialMetadata.likedByAddresses.map((value) => normalizeHash(value)).filter(Boolean)
      : []
  ), [record?.socialMetadata?.likedByAddresses]);
  const initialResharedByAddresses = useMemo(() => (
    Array.isArray(record?.socialMetadata?.resharedByAddresses)
      ? record.socialMetadata.resharedByAddresses.map((value) => normalizeHash(value)).filter(Boolean)
      : []
  ), [record?.socialMetadata?.resharedByAddresses]);
  const normalizedCurrentWalletAddress = normalizeHash(currentWalletAddress);
  const lockMountable = record?.mountables?.lock ?? null;
  const lockBypassFbars = getLockMountableBypassFbars(lockMountable);
  const isLockedForInteractions = lockBypassFbars !== null && !canAccessLockMountable(lockMountable, currentViewerFbars);
  const lockAccessMessage = lockBypassFbars === null ? "This freight is locked." : `Need ${lockBypassFbars} FBARS to bypass this lock`;
  const canGiftApprove = Boolean(
    normalizedCurrentWalletAddress
    && giftDeliverable.enabled
    && !giftApprovalSatisfied
    && giftDeliverable.approvers.some((entry) => normalizeHash(entry.address) === normalizedCurrentWalletAddress),
  );
  const canGiftClaim = Boolean(
    normalizedCurrentWalletAddress
    && giftDeliverable.enabled
    && giftClaimOpen
    && (
      giftDeliverable.claimants.length === 0
      || giftDeliverable.claimants.some((entry) => normalizeHash(entry.address) === normalizedCurrentWalletAddress)
    ),
  );
  const [likes, setLikes] = useState(record?.socialMetadata?.likeCount ?? 0);
  const [likedByAddresses, setLikedByAddresses] = useState<string[]>(initialLikedByAddresses);
  const [bookmarks, setBookmarks] = useState(record?.socialMetadata?.bookmarkCount ?? 0);
  const [commentList, setCommentList] = useState<CampaignComment[]>(initialComments);
  const [reshares, setReshares] = useState(record?.socialMetadata?.reshareCount ?? 0);
  const [resharedByAddresses, setResharedByAddresses] = useState<string[]>(initialResharedByAddresses);
  const [userBookmarked, setUserBookmarked] = useState(false);
  const [isCommentComposerOpen, setIsCommentComposerOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [isSavingLike, setIsSavingLike] = useState(false);
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [isSavingReshare, setIsSavingReshare] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [actionFeedback, setActionFeedback] = useState<{
    source: "like" | "reshare";
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const commentComposerRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const actionFeedbackTimerRef = useRef<number | null>(null);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);

  const showActionFeedback = (
    source: "like" | "reshare",
    tone: "success" | "error",
    message: string
  ) => {
    if (actionFeedbackTimerRef.current !== null) {
      window.clearTimeout(actionFeedbackTimerRef.current);
    }

    setActionFeedback({ source, tone, message });
    actionFeedbackTimerRef.current = window.setTimeout(() => {
      setActionFeedback(null);
      actionFeedbackTimerRef.current = null;
    }, 1600);
  };

  const isConnected = !!signer;
  const isSupportDisabled = !isConnected || isLockedForInteractions || isCampaignInactive || hasReachedMaxAmount || !supportState.supportEnabled;
  const isPurchaseDisabled = !isConnected || isLockedForInteractions || isCampaignInactive || hasNotStartedRaffle || hasNoRemainingTickets;
  const comments = commentList.length;
  const userLiked = normalizedCurrentWalletAddress.length > 0 && likedByAddresses.includes(normalizedCurrentWalletAddress);
  const userReshared = normalizedCurrentWalletAddress.length > 0 && resharedByAddresses.includes(normalizedCurrentWalletAddress);
  const userCommented = normalizedCurrentWalletAddress.length > 0
    && commentList.some((comment) => normalizeHash(comment.creatorAddress) === normalizedCurrentWalletAddress);
  const hasSettledRewards = settlementUiState.hasSettledRewards;
  const shouldGlowSettlement = settlementUiState.shouldGlowSettlement;
  const showSettlementAction = settlementUiState.showSettlementAction;

  useEffect(() => {
    setLikes(record?.socialMetadata?.likeCount ?? 0);
    setLikedByAddresses(initialLikedByAddresses);
    setBookmarks(record?.socialMetadata?.bookmarkCount ?? 0);
    setCommentList(initialComments);
    setReshares(record?.socialMetadata?.reshareCount ?? 0);
    setResharedByAddresses(initialResharedByAddresses);
  }, [
    initialComments,
    initialLikedByAddresses,
    initialResharedByAddresses,
    record?.socialMetadata?.bookmarkCount,
    record?.socialMetadata?.likeCount,
    record?.socialMetadata?.reshareCount,
  ]);

  useEffect(() => {
    return () => {
      if (actionFeedbackTimerRef.current !== null) {
        window.clearTimeout(actionFeedbackTimerRef.current);
        actionFeedbackTimerRef.current = null;
      }
    };
  }, []);

  const buildCampaignRecordPayload = (nextSocialMetadata: {
    comments: CampaignComment[];
    likeCount: number;
    likedByAddresses: string[];
    bookmarkCount: number;
    reshareCount: number;
    resharedByAddresses: string[];
  }) => ({
    title: record?.title ?? displayTitle,
    description: record?.description ?? displayDescription,
    campaignType: record?.campaignType ?? data.campaignType,
    summaryDraft: record?.summaryDraft ?? onchainSummary,
    argsDraft: {
      taskStartDelayHours: record?.argsDraft?.taskStartDelayHours ?? String(Number(data.startDurationSecs) / 3600),
      taskDurationHours: record?.argsDraft?.taskDurationHours ?? String(Number(data.taskDurationSecs) / 3600),
      maxAmountCkb: record?.argsDraft?.maxAmountCkb ?? formatCkbAmount(data.maximumAmount),
      auxAmountCkb: record?.argsDraft?.auxAmountCkb ?? formatCkbAmount(data.auxAmount),
      rewardCount: record?.argsDraft?.rewardCount ?? String(rewardCountValue),
    },
    socialMetadata: {
      mentions,
      comments: nextSocialMetadata.comments,
      likeCount: nextSocialMetadata.likeCount,
      likedByAddresses: nextSocialMetadata.likedByAddresses,
      bookmarkCount: nextSocialMetadata.bookmarkCount,
      reshareCount: nextSocialMetadata.reshareCount,
      resharedByAddresses: nextSocialMetadata.resharedByAddresses,
    },
    giftDeliverable,
    creatorAddress: record?.creatorAddress ?? creatorAddress,
    creatorHandle: record?.creatorHandle ?? creatorHandle,
    campaignId: record?.campaignId ?? getCampaignStableId(c),
    createdByHash: record?.createdByHash ?? getCampaignCreatedByHash(c),
    chainCreatedAt: record?.chainCreatedAt ?? getCampaignChainCreatedAt(c),
    status: record?.status ?? "published",
    txHash: record?.txHash ?? outPoint.txHash,
    publishError: record?.publishError ?? null,
    randomnessPreimage: record?.randomnessPreimage ?? null,
    activatedTxHash: record?.activatedTxHash ?? null,
    activatedAt: record?.activatedAt ?? null,
    activatedByAddress: record?.activatedByAddress ?? null,
    settlementTxHash: record?.settlementTxHash ?? null,
    settledAt: record?.settledAt ?? null,
    settledByAddress: record?.settledByAddress ?? null,
    soldTicketCount: record?.soldTicketCount ?? null,
    liveSoldTicketCount: record?.liveSoldTicketCount ?? null,
    settledParticipantCount: record?.settledParticipantCount ?? null,
    settledRecipients: record?.settledRecipients ?? null,
    mountables: record?.mountables,
  });

  const withSignedNonce = async (purpose: string) => {
    if (!signer) {
      throw new Error("Connect a wallet first");
    }

    const address = await signer.getRecommendedAddress();
    if (!address) {
      throw new Error("Unable to resolve wallet address");
    }

    const nonceResponse = await fetch("/api/wallet/nonce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ address, purpose }),
    });
    const noncePayload = await nonceResponse.json().catch(() => null);
    if (!nonceResponse.ok || typeof noncePayload?.nonce !== "string") {
      throw new Error(noncePayload?.error ?? `Failed to create ${purpose} nonce`);
    }

    const signature = await signer.signMessage(noncePayload.nonce);
    return {
      address,
      nonce: noncePayload.nonce,
      nonceSignature: {
        signature: signature.signature,
        identity: signature.identity,
        signType: signature.signType,
      },
    };
  };

  useEffect(() => {
    if (!commentDiscardDecision || commentDiscardDecision.cardId !== cardId) {
      return;
    }

    if (commentDiscardDecision.discard) {
      setCommentDraft("");
      setCommentError("");
      setIsCommentComposerOpen(false);
    } else {
      setIsCommentComposerOpen(true);
    }
  }, [cardId, commentDiscardDecision]);

  const handleLike = async () => {
    if (!isConnected || isSavingLike) {
      return;
    }

    if (!normalizedCurrentWalletAddress) {
      showActionFeedback("like", "error", "Unable to resolve wallet for like");
      return;
    }

    if (isLockedForInteractions) {
      showActionFeedback("like", "error", lockAccessMessage);
      return;
    }

    if (!record?._id) {
      showActionFeedback("like", "error", "Likes are not available for this freight yet");
      return;
    }

    const previousLikedByAddresses = likedByAddresses;
    const previousLikeCount = likes;
    const nextLikedByAddresses = userLiked
      ? likedByAddresses.filter((address) => address !== normalizedCurrentWalletAddress)
      : [...likedByAddresses, normalizedCurrentWalletAddress];
    const nextLikeCount = nextLikedByAddresses.length;

    setLikedByAddresses(nextLikedByAddresses);
    setLikes(nextLikeCount);
    setIsSavingLike(true);
    setActionFeedback(null);

    try {
      const response = await fetch(`/api/campaign-records/${record._id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildCampaignRecordPayload({
          comments: commentList,
          likeCount: nextLikeCount,
          likedByAddresses: nextLikedByAddresses,
          bookmarkCount: bookmarks,
          reshareCount: reshares,
          resharedByAddresses,
        })),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to save like");
      }

      if (!userLiked) {
        const signed = await withSignedNonce("interaction-like");
        const interactionResponse = await fetch("/api/fbars/interaction", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...signed,
            recordId: record._id,
            actionType: "like",
          }),
        });
        const interactionPayload = await interactionResponse.json().catch(() => null);
        if (!interactionResponse.ok) {
          throw new Error(interactionPayload?.error ?? "Failed to award like FBARS");
        }
      }
    } catch (error) {
      setLikedByAddresses(previousLikedByAddresses);
      setLikes(previousLikeCount);
      showActionFeedback("like", "error", error instanceof Error ? error.message : "Failed to save like");
    } finally {
      setIsSavingLike(false);
    }
  };

  const handleBookmark = () => {
    if (!isConnected) return;
    setUserBookmarked(!userBookmarked);
    setBookmarks((prev) => (userBookmarked ? prev - 1 : prev + 1));
  };

  const handleComment = () => {
    if (!isConnected) return;
    if (isLockedForInteractions) {
      setCommentError(lockAccessMessage);
      setIsCommentComposerOpen(false);
      return;
    }
    setCommentError("");
    setIsCommentComposerOpen((current) => !current);
  };

  useEffect(() => {
    if (!isCommentComposerOpen) {
      return;
    }

    const handleOutsidePointerDown = (event: MouseEvent) => {
      if (!commentComposerRef.current) {
        return;
      }

      if (commentComposerRef.current.contains(event.target as Node)) {
        return;
      }

      if (commentDraft.trim().length === 0) {
        setCommentError("");
        setCommentDraft("");
        if (commentInputRef.current) {
          commentInputRef.current.style.height = "32px";
        }
        setIsCommentComposerOpen(false);
        return;
      }

      onCommentDiscardRequest(cardId);
    };

    document.addEventListener("mousedown", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsidePointerDown);
    };
  }, [cardId, commentDraft, isCommentComposerOpen, onCommentDiscardRequest]);

  const handleSubmitComment = async () => {
    const nextCommentText = commentDraft.trim();
    if (!nextCommentText) {
      setCommentError("Comment cannot be empty");
      return;
    }

    if (!record?._id) {
      setCommentError("Comments are not available for this campaign yet");
      return;
    }

    if (isLockedForInteractions) {
      setCommentError(lockAccessMessage);
      return;
    }

    setIsSavingComment(true);
    setCommentError("");

    try {
      if (!currentWalletAddress) {
        throw new Error("Unable to resolve wallet address for comment");
      }

      const nextComment: CampaignComment = {
        text: nextCommentText,
        creatorAddress: currentWalletAddress,
        creatorHandle: buildDefaultHandle(currentWalletAddress),
        createdAt: new Date().toISOString(),
      };
      const nextComments = [...commentList, nextComment];
      const response = await fetch(`/api/campaign-records/${record._id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildCampaignRecordPayload({
          comments: nextComments,
          likeCount: likes,
          likedByAddresses,
          bookmarkCount: bookmarks,
          reshareCount: reshares,
          resharedByAddresses,
        })),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to save comment");
      }

      const signed = await withSignedNonce("interaction-comment");
      const interactionResponse = await fetch("/api/fbars/interaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...signed,
          recordId: record._id,
          actionType: "comment",
          commentCreatedAt: nextComment.createdAt,
          commentText: nextComment.text,
        }),
      });
      const interactionPayload = await interactionResponse.json().catch(() => null);
      if (!interactionResponse.ok) {
        throw new Error(interactionPayload?.error ?? "Failed to award comment FBARS");
      }

      setCommentList(nextComments);
      setCommentDraft("");
      if (commentInputRef.current) {
        commentInputRef.current.style.height = "32px";
      }
      setIsCommentComposerOpen(false);
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Failed to save comment");
    } finally {
      setIsSavingComment(false);
    }
  };

  const handleReshare = async () => {
    const freightUrl = `${window.location.origin}/campaign/${getCampaignStableId(c)}`;

    try {
      await copyText(freightUrl);
    } catch (error) {
      showActionFeedback("reshare", "error", error instanceof Error ? error.message : "Failed to copy freight link");
      return;
    }

    if (userReshared || isSavingReshare) {
      showActionFeedback("reshare", "success", "Freight link copied");
      return;
    }

    if (!normalizedCurrentWalletAddress || !record?._id) {
      showActionFeedback("reshare", "success", "Freight link copied");
      return;
    }

    const previousResharedByAddresses = resharedByAddresses;
    const previousReshareCount = reshares;
    const nextResharedByAddresses = [...resharedByAddresses, normalizedCurrentWalletAddress];
    const nextReshareCount = nextResharedByAddresses.length;

    setResharedByAddresses(nextResharedByAddresses);
    setReshares(nextReshareCount);
    setIsSavingReshare(true);
    setActionFeedback(null);

    try {
      const response = await fetch(`/api/campaign-records/${record._id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildCampaignRecordPayload({
          comments: commentList,
          likeCount: likes,
          likedByAddresses,
          bookmarkCount: bookmarks,
          reshareCount: nextReshareCount,
          resharedByAddresses: nextResharedByAddresses,
        })),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to save reshare");
      }

      const signed = await withSignedNonce("interaction-reshare");
      const interactionResponse = await fetch("/api/fbars/interaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...signed,
          recordId: record._id,
          actionType: "reshare",
        }),
      });
      const interactionPayload = await interactionResponse.json().catch(() => null);
      if (!interactionResponse.ok) {
        throw new Error(interactionPayload?.error ?? "Failed to award reshare FBARS");
      }

      showActionFeedback("reshare", "success", "Freight link copied");
    } catch (error) {
      setResharedByAddresses(previousResharedByAddresses);
      setReshares(previousReshareCount);
      showActionFeedback("reshare", "error", error instanceof Error ? error.message : "Failed to save reshare");
    } finally {
      setIsSavingReshare(false);
    }
  };

  const handleDepositClick = () => {
    if (!isConnected || isLockedForInteractions || isCampaignInactive || hasReachedMaxAmount || !supportState.supportEnabled) {
      return;
    }
    setShowDepositModal(true);
  };

  const handleDepositSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!signer || !depositAmount || isLockedForInteractions || isCampaignInactive || hasReachedMaxAmount || !supportState.supportEnabled) {
      return;
    }

    const parsedDepositAmount = Number.parseFloat(depositAmount);
    if (!Number.isFinite(parsedDepositAmount) || parsedDepositAmount <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    const amountShannons = BigInt(Math.floor(parsedDepositAmount * 100_000_000));
    if (amountShannons <= 0n) {
      alert("Please enter at least 0.01 CKB");
      return;
    }

    const maxAmount = data.maximumAmount - data.currentDeposits;
    if (amountShannons > maxAmount) {
      alert(`Maximum deposit available: ${(Number(maxAmount) / 1e8).toFixed(2)} CKB`);
      return;
    }

    setIsDepositing(true);
    try {
      const txHash = supportState.supportMode === "direct_creator"
        ? await sendCreatorTipShannons(signer, c, amountShannons)
        : await sendDepositShannons(signer, c, amountShannons);
      await fetch("/api/campaign-deposits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amountShannons: amountShannons.toString(),
          campaignId: getCampaignStableId(c),
          campaignRecordId: record?._id ?? null,
          depositedAt: new Date().toISOString(),
          depositorAddress: await signer.getRecommendedAddress(),
          kind: supportState.depositKind,
          supportMode: supportState.supportMode,
          txHash,
        }),
      }).catch(() => {
        // Non-fatal — transaction history can miss this row, but the on-chain deposit still succeeded.
      });

      const signed = await withSignedNonce("deposit");
      const depositResponse = await fetch("/api/fbars/deposit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...signed,
          recordId: record?._id,
          txHash,
          amountCkb: Number(amountShannons) / 1e8,
          kind: supportState.depositKind,
          supportMode: supportState.supportMode,
        }),
      });
      const depositPayload = await depositResponse.json().catch(() => null);
      if (!depositResponse.ok) {
        throw new Error(depositPayload?.error ?? "Failed to award deposit FBARS");
      }

      alert(`${supportState.supportMode === "direct_creator" ? "Tip" : "Deposit"} sent! Tx: ${txHash}`);
      setShowDepositModal(false);
      setDepositAmount("");
    } catch (error) {
      alert(`${supportState.supportMode === "direct_creator" ? "Tip" : "Deposit"} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDepositing(false);
    }
  };

  const handleGiftApprove = async () => {
    if (!record?._id) {
      showActionFeedback("like", "error", "Gift approvals are not available for this freight yet");
      return;
    }

    try {
      const signed = await withSignedNonce("gift-approve");
      const response = await fetch(`/api/campaign-records/${record._id}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(signed),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to approve gift freight");
      }

      showActionFeedback("like", "success", payload?.approvalsSatisfied ? "Gift approvals satisfied" : "Gift approved");
    } catch (error) {
      showActionFeedback("like", "error", error instanceof Error ? error.message : "Failed to approve gift freight");
    }
  };

  const handleGiftClaim = async () => {
    if (!record?._id) {
      showActionFeedback("reshare", "error", "Gift claims are not available for this freight yet");
      return;
    }

    try {
      const signed = await withSignedNonce("gift-claim");
      const response = await fetch(`/api/campaign-records/${record._id}/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(signed),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to claim gift freight");
      }

      showActionFeedback("reshare", "success", payload?.claimAmountLabel ? `Claim ready: ${payload.claimAmountLabel}` : "Gift claim submitted");
    } catch (error) {
      showActionFeedback("reshare", "error", error instanceof Error ? error.message : "Failed to claim gift freight");
    }
  };

  const handleGiftInfoClick = () => {
    if (!giftDeliverable.enabled) {
      return;
    }

    onSettlementInfoRequest({
      campaignTitle: displayTitle,
      randomnessHash: "",
      randomnessPreimage: null,
      evidenceItems: [
        `Gift approvals: ${giftDeliverable.approvals.length}/${giftDeliverable.requiredApprovalCount ?? 0}`,
        `Claim mode: ${giftDeliverable.claimants.length > 0 ? "restricted" : "open"}`,
        `Split mode: ${giftDeliverable.splitMode ?? "equal"}`,
      ],
      recipients: giftPreview.allocations.map((allocation) => ({
        address: "",
        username: allocation.handle,
        handle: allocation.handle,
        amountLabel: allocation.amountLabel,
        amountShannons: allocation.amountShannons,
      })),
      distributionTxHash: null,
      errorMessage: giftPreview.error,
      gift: {
        approvalCount: giftDeliverable.approvals.length,
        canApprove: giftDeliverable.approvers.length > 0 && !giftApprovalSatisfied,
        canClaim: giftClaimOpen,
        claimAmountLabel: giftPreview.perClaimAmountLabel,
        claimantsLabel: giftDeliverable.claimants.length > 0
          ? giftDeliverable.claimants.map((entry) => entry.handle).join(", ")
          : "Anyone can claim",
        errorMessage: giftPreview.error,
        giftEnabled: giftDeliverable.enabled,
        requiredApprovalCount: giftDeliverable.requiredApprovalCount,
      },
      _campaign: c,
      _record: record,
    });
  };

  const handleSettlementClick = async () => {
    if (!isRaffleCampaign) {
      return;
    }

    const randomnessHash = bytesToHex(data.randomnessHash);
    const randomnessPreimage = record?.randomnessPreimage ?? null;

    if (record?.settlementTxHash && Array.isArray(record.settledRecipients) && record.settledRecipients.length > 0) {
      onSettlementInfoRequest({
        campaignTitle: displayTitle,
        randomnessHash,
        randomnessPreimage,
        evidenceItems: [
          `Stored randomness hash: ${randomnessHash}`,
          `Verified participant count used: ${record.settledParticipantCount ?? "0"}`,
          `Reward count: ${String(data.rewardCount)}`,
          "Winner ordering: deterministic by join time, participant address, then outpoint.",
        ],
        recipients: record.settledRecipients,
        distributionTxHash: record.settlementTxHash,
        errorMessage: null,
        _campaign: c,
        _record: record,
      });
      return;
    }

    onSettlementInfoRequest({
      campaignTitle: displayTitle,
      randomnessHash,
      randomnessPreimage,
      evidenceItems: [],
      recipients: [],
      distributionTxHash: null,
      errorMessage: null,
      _campaign: c,
      _record: record,
    });

    try {
      const participantIndexResponse = await fetch(`/api/campaign-participants?campaignId=${encodeURIComponent(getCampaignStableId(c))}`, {
        cache: "no-store",
      });
      const participantIndexPayload = await participantIndexResponse.json().catch(() => null);
      if (!participantIndexResponse.ok) {
        throw new Error(participantIndexPayload?.error ?? "Failed to fetch indexed campaign participants");
      }
      const participantAddresses = Array.isArray(participantIndexPayload?.participants)
        ? participantIndexPayload.participants
            .map((value: { participantAddress?: unknown }) => typeof value?.participantAddress === "string" ? value.participantAddress : "")
            .filter(Boolean)
        : [];
      const participantAddressByHashEntries = await Promise.all(
        participantAddresses.map(async (address: string) => {
          try {
            const addressObj = await ccc.Address.fromString(address, client);
            return [bytesToHex(lockScriptToAddressBytes(addressObj.script)), address] as const;
          } catch {
            return null;
          }
        })
      );
      const participantAddressByHash = new Map(
        participantAddressByHashEntries.filter((entry): entry is readonly [string, string] => entry !== null)
      );
      const participants = await fetchParticipants(client, c, 500, participantAddresses);
      const revealedPreimage = randomnessPreimage ? hexToBytes(randomnessPreimage) : null;
      const winners = revealedPreimage
        ? previewDeterministicWinners(participants, data.rewardCount, revealedPreimage, c)
        : [];
      const winnerAddresses = winners.map((winner) => {
        const winnerHash = bytesToHex(winner.data.participantAddress);
        return participantAddressByHash.get(winnerHash) ?? winnerHash;
      });
      const uniqueWinnerAddresses = Array.from(new Set(winnerAddresses.map((value) => value.trim().toLowerCase()).filter(Boolean)));
      const profilesByAddress = new Map<string, { username: string; handle: string }>();

      if (uniqueWinnerAddresses.length > 0) {
        try {
          const profileResponse = await fetch(`/api/user-profiles?addresses=${encodeURIComponent(uniqueWinnerAddresses.join(","))}`, {
            cache: "no-store",
          });
          const profilePayload = await profileResponse.json().catch(() => null);
          if (profileResponse.ok && Array.isArray(profilePayload?.profiles)) {
            for (const profile of profilePayload.profiles as Array<{ address?: unknown; username?: unknown; handle?: unknown }>) {
              if (typeof profile.address !== "string") {
                continue;
              }

              const normalizedAddress = profile.address.trim().toLowerCase();
              if (!normalizedAddress) {
                continue;
              }

              profilesByAddress.set(normalizedAddress, {
                username: typeof profile.username === "string" && profile.username.trim().length > 0
                  ? profile.username.trim()
                  : buildDefaultUsername(profile.address),
                handle: typeof profile.handle === "string" && profile.handle.trim().length > 0
                  ? profile.handle.trim()
                  : buildDefaultHandle(profile.address),
              });
            }
          }
        } catch {
          // Non-fatal — fall back to generated handles below.
        }
      }

      const effectiveWinnerCount = data.rewardCount === 0n
        ? BigInt(participants.length)
        : BigInt(Math.min(Number(data.rewardCount), participants.length));
      const rewardPerWinner = effectiveWinnerCount > 0n ? data.currentDeposits / effectiveWinnerCount : 0n;
      const recipientAmountLabel = `${formatCkbAmount(rewardPerWinner)} CKB`;
      const recipientAmountShannons = rewardPerWinner.toString();
      const recipients: SettlementRecipient[] = winnerAddresses.map((address) => {
        const normalizedAddress = address.trim().toLowerCase();
        const profile = profilesByAddress.get(normalizedAddress);
        return {
          address,
          username: profile?.username ?? buildDefaultUsername(address),
          handle: profile?.handle ?? buildDefaultHandle(address),
          amountLabel: recipientAmountLabel,
          amountShannons: recipientAmountShannons,
        };
      });
      const participantCountText = String(participants.length);
      const evidenceItems = [
        `Stored randomness hash: ${randomnessHash}`,
        `Verified participant count used: ${participantCountText}`,
        `Reward count: ${String(data.rewardCount)}`,
        "Winner ordering: deterministic by join time, participant address, then outpoint.",
      ];

      let distributionTxHash: string | null = null;
      let errorMessage: string | null = null;
      if (shouldGlowSettlement) {
        const userHasPermission = signer ? await hasSettlementCreatorPermission(signer, client, c, currentWalletAddress, record) : false;
        if (!signer || !userHasPermission) {
          errorMessage = "Only the freight creator can distribute raffle rewards.";
        } else if (!revealedPreimage) {
          errorMessage = "Randomness preimage not found. This campaign may have been created before automatic preimage storage was added.";
        } else if (effectiveWinnerCount <= 0n || winners.length === 0) {
          errorMessage = "No eligible verified winners are available for settlement.";
        } else {
          try {
            distributionTxHash = await sendBatchDeliver(signer, c, winners, revealedPreimage);
          } catch (error) {
            if (error instanceof Error && /Transient CKB cell lookup failed/i.test(error.message)) {
              throw new Error("Settlement was interrupted while the chain was updating live cells. Please wait a moment and try Share2 again.");
            }
            throw error;
          }
          let settledAt = new Date().toISOString();

          if (record?._id) {
            try {
              const settleResponse = await fetch(`/api/campaign-records/${record._id}/settle`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  settlementTxHash: distributionTxHash,
                  settledAt,
                  settledByAddress: currentWalletAddress,
                  soldTicketCount: String(soldTickets),
                  settledParticipantCount: participantCountText,
                  settledRecipients: recipients,
                }),
              });
              const settlePayload = await settleResponse.json().catch(() => null);
              if (settleResponse.ok && typeof settlePayload?.settledAt === "string" && settlePayload.settledAt.trim()) {
                settledAt = settlePayload.settledAt.trim();
              }
              if (settleResponse.ok && Array.isArray(settlePayload?.settledRecipients)) {
                recipients.splice(0, recipients.length, ...settlePayload.settledRecipients);
              }
            } catch {
              // Non-fatal — optimistic UI update still uses the local timestamp.
            }
          }

          onSettlementCompleted(
            getCampaignStableId(c),
            distributionTxHash,
            settledAt,
            String(soldTickets),
            participantCountText,
            recipients,
          );
        }
      }

      onSettlementInfoRequest({
        campaignTitle: displayTitle,
        randomnessHash,
        randomnessPreimage,
        evidenceItems,
        recipients,
        distributionTxHash,
        errorMessage,
        _campaign: c,
        _record: record,
      });
    } catch (error) {
      onSettlementInfoRequest({
        campaignTitle: displayTitle,
        randomnessHash,
        randomnessPreimage,
        evidenceItems: [],
        recipients: [],
        distributionTxHash: null,
        errorMessage: error instanceof Error ? error.message : "Failed to distribute raffle rewards",
        _campaign: c,
        _record: record,
      });
    }
  };

  return {
    bookmarks,
    commentComposerRef,
    commentDraft,
    commentError,
    commentInputRef,
    comments,
    creatorAddress,
    creatorHandle,
    depositAmount,
    depositedCkb,
    displayDescription,
    displayTitle,
    giftDeliverable,
    handleBookmark,
    handleComment,
    handleDepositClick,
    handleDepositSubmit,
    handleGiftApprove,
    handleGiftClaim,
    handleGiftInfoClick,
    handleLike,
    handleReshare,
    handleSettlementClick,
    handleSubmitComment,
    hasNotStartedRaffle,
    hasReachedMaxAmount,
    hasSettledRewards,
    isCampaignInactive,
    isCommentComposerOpen,
    isConnected,
    canGiftApprove,
    canGiftClaim,
    isDepositing,
    isLockedForInteractions,
    isPurchaseDisabled,
    isSupportDisabled,
    lockAccessMessage,
    isRaffleCampaign,
    supportState,
    isSavingComment,
    likes,
    maxCkb,
    remainingTickets,
    reshares,
    rewardCountValue,
    setCommentDraft,
    setDepositAmount,
    setIsCommentComposerOpen,
    setShowDepositModal,
    showDepositModal,
    shouldGlowSettlement,
    showSettlementAction,
    soldTickets,
    ticketPriceShannons,
    totalTickets,
    userBookmarked,
    userCommented,
    userLiked,
    userReshared,
    actionFeedback,
  };
}
