"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { CampaignComment, CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import { buildDefaultHandle, decodeCreatedByAddress, formatCkbAmount } from "@/lib/campaignDisplay";
import { CampaignStatus } from "@/lib/contract";
import { bytesToHex, decodeSummary, hexToBytes, lockScriptToAddressBytes } from "@/lib/encoding";
import { getCampaignChainCreatedAt, getCampaignCreatedByHash, getCampaignStableId, normalizeHash } from "@/lib/campaignIdentity";
import {
  fetchParticipants,
  previewDeterministicWinners,
  sendBatchDeliver,
  sendDeposit,
  type CampaignCell,
} from "@/lib/transactions";
import { ccc } from "@ckb-ccc/connector-react";

type SettlementModalData = {
  campaignTitle: string;
  randomnessHash: string;
  randomnessPreimage: string | null;
  evidenceItems: string[];
  recipients: string[];
  distributionTxHash: string | null;
  errorMessage?: string | null;
  _campaign?: CampaignCell;
  _record?: CampaignRecord | null;
};

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
  currentWalletAddress: string | null;
  onCommentDiscardRequest: (cardId: string) => void;
  commentDiscardDecision: { cardId: string; discard: boolean } | null;
  onSettlementInfoRequest: (data: SettlementModalData) => void;
};

export function useCampaignCardState({
  campaign: c,
  record,
  displayStatus,
  signer,
  client,
  currentWalletAddress,
  onCommentDiscardRequest,
  commentDiscardDecision,
  onSettlementInfoRequest,
}: UseCampaignCardStateArgs) {
  const { data, outPoint } = c;
  const cardId = getCampaignStableId(c);
  const maxCkb = formatCkbAmount(data.maximumAmount);
  const depositedCkb = formatCkbAmount(data.currentDeposits);
  const isRaffleCampaign = data.campaignType === 4;
  const ticketPriceShannons = data.auxAmount > 0n ? data.auxAmount : 0n;
  const totalTickets = isRaffleCampaign && ticketPriceShannons > 0n ? data.maximumAmount / ticketPriceShannons : 0n;
  const soldTickets = isRaffleCampaign && ticketPriceShannons > 0n ? data.currentDeposits / ticketPriceShannons : 0n;
  const remainingTickets = totalTickets > soldTickets ? totalTickets - soldTickets : 0n;
  const remainingDepositCapacity = data.maximumAmount > data.currentDeposits ? data.maximumAmount - data.currentDeposits : 0n;
  const onchainSummary = decodeSummary(data.summary);
  const creatorAddress = record?.creatorAddress || decodeCreatedByAddress(c);
  const creatorHandle = record?.creatorHandle || buildDefaultHandle(creatorAddress);
  const displayTitle = record?.title?.trim() || onchainSummary;
  const displayDescription = record?.description?.trim() || onchainSummary;
  const mentions = record?.socialMetadata?.mentions ?? [];
  const hasReachedMaxAmount = remainingDepositCapacity <= 0n;
  const hasNoRemainingTickets = isRaffleCampaign && remainingTickets <= 0n;
  const isCampaignInactive = displayStatus === CampaignStatus.Completed || displayStatus === CampaignStatus.Cancelled;
  const hasNotStartedRaffle = isRaffleCampaign && displayStatus === CampaignStatus.Created;
  const rewardCountValue = Number(data.rewardCount);
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
  const normalizedCurrentWalletAddress = normalizeHash(currentWalletAddress);
  const [likes, setLikes] = useState(record?.socialMetadata?.likeCount ?? 0);
  const [likedByAddresses, setLikedByAddresses] = useState<string[]>(initialLikedByAddresses);
  const [bookmarks, setBookmarks] = useState(record?.socialMetadata?.bookmarkCount ?? 0);
  const [commentList, setCommentList] = useState<CampaignComment[]>(initialComments);
  const [reshares, setReshares] = useState(record?.socialMetadata?.reshareCount ?? 0);
  const [userBookmarked, setUserBookmarked] = useState(false);
  const [userReshared, setUserReshared] = useState(false);
  const [isCommentComposerOpen, setIsCommentComposerOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [isSavingLike, setIsSavingLike] = useState(false);
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [commentError, setCommentError] = useState("");
  const commentComposerRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);

  const isConnected = !!signer;
  const isPurchaseDisabled = !isConnected || isCampaignInactive || hasNotStartedRaffle || hasReachedMaxAmount || hasNoRemainingTickets;
  const comments = commentList.length;
  const userLiked = normalizedCurrentWalletAddress.length > 0 && likedByAddresses.includes(normalizedCurrentWalletAddress);
  const userCommented = normalizedCurrentWalletAddress.length > 0
    && commentList.some((comment) => normalizeHash(comment.creatorAddress) === normalizedCurrentWalletAddress);
  const hasSettledRewards = isRaffleCampaign && displayStatus === CampaignStatus.Completed && data.currentDeposits === 0n;
  const shouldGlowSettlement = isRaffleCampaign && displayStatus === CampaignStatus.Completed && rewardCountValue > 0 && !hasSettledRewards;

  useEffect(() => {
    setLikes(record?.socialMetadata?.likeCount ?? 0);
    setLikedByAddresses(initialLikedByAddresses);
    setBookmarks(record?.socialMetadata?.bookmarkCount ?? 0);
    setCommentList(initialComments);
    setReshares(record?.socialMetadata?.reshareCount ?? 0);
  }, [
    initialComments,
    initialLikedByAddresses,
    record?.socialMetadata?.bookmarkCount,
    record?.socialMetadata?.likeCount,
    record?.socialMetadata?.reshareCount,
  ]);

  const buildCampaignRecordPayload = (nextSocialMetadata: {
    comments: CampaignComment[];
    likeCount: number;
    likedByAddresses: string[];
    bookmarkCount: number;
    reshareCount: number;
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
    },
    socialMetadata: {
      mentions,
      comments: nextSocialMetadata.comments,
      likeCount: nextSocialMetadata.likeCount,
      likedByAddresses: nextSocialMetadata.likedByAddresses,
      bookmarkCount: nextSocialMetadata.bookmarkCount,
      reshareCount: nextSocialMetadata.reshareCount,
    },
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
  });

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
    if (!isConnected || !record?._id || !normalizedCurrentWalletAddress || isSavingLike) {
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
        })),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to save like");
      }
    } catch {
      setLikedByAddresses(previousLikedByAddresses);
      setLikes(previousLikeCount);
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
        })),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to save comment");
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

  const handleReshare = () => {
    if (!isConnected) return;
    setUserReshared(!userReshared);
    setReshares((prev) => (userReshared ? prev - 1 : prev + 1));
  };

  const handleDepositClick = () => {
    if (isPurchaseDisabled) return;
    setShowDepositModal(true);
  };

  const handleDepositSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!signer || !depositAmount || isPurchaseDisabled) return;

    const parsedDepositAmount = Number.parseFloat(depositAmount);
    if (!Number.isFinite(parsedDepositAmount) || parsedDepositAmount <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    const amountShannons = BigInt(Math.floor(parsedDepositAmount * 100_000_000));
    const amountCkb = amountShannons / 100_000_000n;
    if (amountCkb <= 0n) {
      alert("Please enter at least 1 CKB");
      return;
    }

    const maxAmount = data.maximumAmount - data.currentDeposits;
    if (amountShannons > maxAmount) {
      alert(`Maximum deposit available: ${(Number(maxAmount) / 1e8).toFixed(2)} CKB`);
      return;
    }

    setIsDepositing(true);
    try {
      const txHash = await sendDeposit(signer, c, amountCkb);
      alert(`Deposit sent! Tx: ${txHash}`);
      setShowDepositModal(false);
      setDepositAmount("");
    } catch (error) {
      alert(`Deposit failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDepositing(false);
    }
  };

  const handleSettlementClick = async () => {
    if (!isRaffleCampaign) {
      return;
    }

    const randomnessHash = bytesToHex(data.randomnessHash);
    const randomnessPreimage = record?.randomnessPreimage ?? null;
    console.log("[raffle-settlement] settlement click", {
      campaignTxHash: c.outPoint.txHash,
      campaignIndex: c.outPoint.index,
      normalizedCampaignTxHash: normalizeHash(c.outPoint.txHash),
      campaignType: data.campaignType,
      record,
      recordTxHash: record?.txHash ?? null,
      normalizedRecordTxHash: normalizeHash(record?.txHash),
      randomnessHash,
      randomnessPreimage,
      hasRandomnessPreimage: typeof randomnessPreimage === "string" && randomnessPreimage.length > 0,
    });
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
      const participants = await fetchParticipants(client, c);
      const revealedPreimage = randomnessPreimage ? hexToBytes(randomnessPreimage) : null;
      const winners = revealedPreimage
        ? previewDeterministicWinners(participants, data.rewardCount, revealedPreimage, c)
        : [];
      const recipientAddresses = winners.map((winner) => bytesToHex(winner.data.participantAddress));
      const evidenceItems = [
        `Stored randomness hash: ${randomnessHash}`,
        randomnessPreimage ? `Revealed preimage: ${randomnessPreimage}` : "Revealed preimage is not available in the current record store.",
        `Verified participant count used: ${String(participants.length)}`,
        `Reward count: ${String(data.rewardCount)}`,
        "Winner ordering is deterministic by join time, participant address, then outpoint.",
      ];

      let distributionTxHash: string | null = null;
      let errorMessage: string | null = null;
      if (shouldGlowSettlement) {
        const userHasPermission = signer ? await hasSettlementCreatorPermission(signer, client, c, currentWalletAddress, record) : false;
        if (!signer || !userHasPermission) {
          errorMessage = "Only the freight creator can distribute raffle rewards.";
        } else if (!revealedPreimage) {
          errorMessage = "Randomness preimage not found. This campaign may have been created before automatic preimage storage was added. The preimage was shown in the creation success modal — check your notes.";
        } else {
          distributionTxHash = await sendBatchDeliver(signer, c, winners, revealedPreimage);
        }
      }

      onSettlementInfoRequest({
        campaignTitle: displayTitle,
        randomnessHash,
        randomnessPreimage,
        evidenceItems,
        recipients: recipientAddresses,
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
    handleBookmark,
    handleComment,
    handleDepositClick,
    handleDepositSubmit,
    handleLike,
    handleReshare,
    handleSettlementClick,
    handleSubmitComment,
    hasNoRemainingTickets,
    hasNotStartedRaffle,
    hasReachedMaxAmount,
    hasSettledRewards,
    isCampaignInactive,
    isCommentComposerOpen,
    isConnected,
    isDepositing,
    isPurchaseDisabled,
    isRaffleCampaign,
    isSavingComment,
    likes,
    maxCkb,
    remainingTickets,
    rewardCountValue,
    reshares,
    setCommentDraft,
    setDepositAmount,
    setShowDepositModal,
    shouldGlowSettlement,
    showDepositModal,
    soldTickets,
    ticketPriceShannons,
    totalTickets,
    userBookmarked,
    userCommented,
    userLiked,
    userReshared,
  };
}
