"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { ArrowRight, LoaderCircle, RefreshCw, SendHorizontal, Trash2 } from "lucide-react";

import Link from "next/link";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { DEFAULT_FORMS_MOUNTABLE_CONFIG, normalizeFormsMountableConfig } from "@/app/_lib/formsMountable";
import type { FormsMountableConfig } from "@/app/_types/formsMountable";
import { CampaignType } from "@/lib/contract";
import {
  MIN_TASK_DURATION_MINUTES,
  MINUTES_PER_HOUR,
  normalizeCreateCampaignParams,
  TIMING_MINUTE_STEP,
} from "@/lib/campaignValidation";
import { createRandomnessCommitment, randomnessPreimageToHex } from "@/lib/randomness";
import { sendCreateCampaign } from "@/lib/transactions";

const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  [CampaignType.SimpleTask]: "SimpleTask",
  [CampaignType.FundedTask]: "FundedTask",
  [CampaignType.Crowdfunding]: "Crowdfunding",
  [CampaignType.TimedChallenge]: "TimedChallenge",
  [CampaignType.Raffle]: "Raffle",
};

const MOUNTABLE_TRIGGER_HASHTAG = "mounted";

const MOCK_USERS = ["alice", "bob", "charlie", "diana", "eve", "frank"];
const COMPULSORY_HASHTAG_SET = new Set([...Object.values(CAMPAIGN_TYPE_LABELS).map((label) => label.toLowerCase()), "mounted"]);
const CREATE_CONSTRAINTS_MESSAGE_PENDING = "Not all constraints passed, hover on info button for more";
const CREATE_MODAL_TITLE_MAX_CHARS = 30;
const CREATE_MODAL_BODY_MAX_CHARS = 455;
const CREATE_TOTAL_MAX_CHARS = 256;
const SUMMARY_MAX_BYTES = 64;
const summaryEncoder = new TextEncoder();

const getTextBytes = (text: string) => summaryEncoder.encode(text).length;
const getTextChars = (text: string) => text.length;
const buildCreateContent = (title: string, description: string) => [title, description].filter(Boolean).join("\n");
const normalizeSummarySource = (text: string) => text.replace(/\s+/g, " ").trim();
const stripTagsForCount = (text: string) => text.replace(/(^|\s)([#@]\w+)/g, "$1");
const getCountableChars = (text: string) => getTextChars(stripTagsForCount(text));

const truncateToUtf8Bytes = (text: string, maxBytes: number) => {
  let truncated = "";

  for (const char of Array.from(text)) {
    const candidate = truncated + char;
    if (getTextBytes(candidate) > maxBytes) {
      break;
    }
    truncated = candidate;
  }

  return truncated;
};

const truncateToTextLimit = (text: string, maxChars: number) => {
  let truncated = "";

  for (const char of Array.from(text)) {
    const candidate = truncated + char;
    if (getTextChars(candidate) > maxChars) {
      break;
    }
    truncated = candidate;
  }

  return truncated;
};

const buildOnchainSummary = ({ title, description }: { title: string; description: string }) => {
  const source = normalizeSummarySource(description) || normalizeSummarySource(title);
  return truncateToUtf8Bytes(source, SUMMARY_MAX_BYTES);
};

const parseStoredTimingHours = (value: string, minimumMinutes: number) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return minimumMinutes;
  }

  const clamped = Math.max(minimumMinutes, Math.round(parsed * MINUTES_PER_HOUR));
  return Math.round(clamped / TIMING_MINUTE_STEP) * TIMING_MINUTE_STEP;
};

const splitTimingParts = (value: string, minimumMinutes: number) => {
  const totalMinutes = parseStoredTimingHours(value, minimumMinutes);
  return {
    hours: Math.floor(totalMinutes / MINUTES_PER_HOUR),
    minutes: totalMinutes % MINUTES_PER_HOUR,
  };
};

const buildTimingHoursFromParts = (hoursPart: string, minutesPart: string, minimumMinutes: number) => {
  const hours = Number.parseInt(hoursPart, 10);
  const minutes = Number.parseInt(minutesPart, 10);
  const safeHours = Number.isFinite(hours) && hours >= 0 ? hours : 0;
  const safeMinutes = Number.isFinite(minutes) && minutes >= 0 ? Math.min(minutes, 59) : 0;
  const normalizedMinutes = Math.round(Math.max(minimumMinutes, safeHours * MINUTES_PER_HOUR + safeMinutes) / TIMING_MINUTE_STEP) * TIMING_MINUTE_STEP;
  const totalHours = normalizedMinutes / MINUTES_PER_HOUR;
  if (Number.isInteger(totalHours)) {
    return String(totalHours);
  }

  return totalHours.toFixed(10).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
};

const getNextListLine = (currentLine: string) => {
  const numberedMatch = currentLine.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (numberedMatch) {
    const [, indent, number, content] = numberedMatch;
    if (content.trim().length === 0) return { mode: "exit" as const };
    return { mode: "continue" as const, insertText: `\n${indent}${Number(number) + 1}. ` };
  }

  const checkboxMatch = currentLine.match(/^(\s*)([-*•]\s+)?\[( |x|X)\]\s+(.*)$/);
  if (checkboxMatch) {
    const [, indent, bulletPrefix = "", , content] = checkboxMatch;
    if (content.trim().length === 0) return { mode: "exit" as const };
    return { mode: "continue" as const, insertText: `\n${indent}${bulletPrefix}[ ] ` };
  }

  const bulletMatch = currentLine.match(/^(\s*)([-*•])\s+(.*)$/);
  if (bulletMatch) {
    const [, indent, bullet, content] = bulletMatch;
    if (content.trim().length === 0) return { mode: "exit" as const };
    return { mode: "continue" as const, insertText: `\n${indent}${bullet} ` };
  }

  const quoteMatch = currentLine.match(/^(\s*)(>)\s?(.*)$/);
  if (quoteMatch) {
    const [, indent, marker, content] = quoteMatch;
    if (content.trim().length === 0) return { mode: "exit" as const };
    return { mode: "continue" as const, insertText: `\n${indent}${marker} ` };
  }

  return null;
};

const deriveDefaultCreatorHandle = (address: string | null) => {
  const normalized = (address || "freightguest0000000000000000")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return `freight${normalized.slice(-20)}.ckb`;
};

const buildPreviewLines = (text: string, maxChars: number) => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [] as string[];
  }

  const lines = trimmed.split("\n");
  const output: string[] = [];
  let remaining = maxChars;

  for (const rawLine of lines) {
    if (remaining <= 0) {
      break;
    }

    const line = rawLine.replace(/\s+$/g, "");
    const take = line.slice(0, remaining);
    output.push(take);
    remaining -= take.length;

    if (line.length > take.length) {
      output[output.length - 1] = `${take.trimEnd()}…`;
      break;
    }
  }

  return output;
};

export type CreateModalStep = "compose" | "review";

type DraftSaveStatus = "idle" | "saving" | "saved" | "error";

type DraftRecordStatus = "draft" | "published" | "publish_failed";

type DraftRecord = {
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
    forms?: FormsMountableConfig | null;
  };
  socialMetadata?: {
    mentions?: string[];
  };
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  status?: DraftRecordStatus;
  txHash?: string | null;
  publishError?: string | null;
  randomnessPreimage?: string | null;
  activatedTxHash?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type DraftSnapshot = {
  title: string;
  description: string;
  campaignType: CampaignType;
  summaryDraft: string;
  taskStartDelayHours: string;
  taskDurationHours: string;
  maxAmountCkb: string;
  rewardCount: string;
  auxAmountCkb: string;
  mentions: string[];
  formsMountable?: FormsMountableConfig;
};

type CampaignIdentityOverride = {
  campaignId?: string | null;
  createdByHash?: string | null;
  chainCreatedAt?: string | null;
};

type PendingPublishedRecordSync = {
  draftRecordId: string;
  summaryDraft: string;
  txHash: string;
  campaignId: string;
  createdByHash: string;
  chainCreatedAt: string;
  randomnessPreimage: string | null;
};

export type CreateCampaignModalContentHandle = {
  hasDraftableChanges: () => boolean;
  saveDraftFromClose: () => Promise<void>;
  discardDraftSession: () => void;
  toggleDraftList: () => Promise<boolean>;
  applyDraftSelection: (draftId: string) => void;
  setFormsMountableEnabled: (enabled: boolean) => void;
  advanceToReviewAfterMountableSelection: () => Promise<void>;
};

export type CreateConstraintStatus = {
  titlePassed: boolean;
  bodyPassed: boolean;
  firstHashtagPassed: boolean;
  additionalHashtagsPassed: boolean;
};

type CreateCampaignModalContentProps = {
  mode: "modal" | "page";
  onRequestClose?: () => void;
  resetSignal?: number;
  stepBackSignal?: number;
  onStepChange?: (step: CreateModalStep) => void;
  onConstraintStatusChange?: (status: CreateConstraintStatus) => void;
  onPreviewErrorChange?: (message: string) => void;
  onDraftListOpenChange?: (isOpen: boolean) => void;
  onDraftSelectionRequest?: (draftId: string) => void;
  onPublishSuccess?: (txHash: string, randomnessPreimage: string | null) => void;
  onMountableSelectionRequired?: () => void;
  onMountableSelectionStateChange?: (state: { hasMountedHashtag: boolean; formsSelected: boolean }) => void;
};

function buildDraftSnapshot(snapshot: DraftSnapshot): DraftSnapshot {
  return {
    ...snapshot,
    title: snapshot.title.trim(),
    description: snapshot.description.trim(),
    summaryDraft: snapshot.summaryDraft.trim(),
    mentions: [...snapshot.mentions],
  };
}

function areDraftSnapshotsEqual(left: DraftSnapshot | null, right: DraftSnapshot | null) {
  if (!left || !right) {
    return left === right;
  }

  return JSON.stringify(buildDraftSnapshot(left)) === JSON.stringify(buildDraftSnapshot(right));
}

function formatDraftUpdatedAt(value: string | undefined) {
  if (!value) {
    return "Just now";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const CreateCampaignModalContent = forwardRef<CreateCampaignModalContentHandle, CreateCampaignModalContentProps>(function CreateCampaignModalContent({
  mode,
  resetSignal = 0,
  stepBackSignal = 0,
  onStepChange,
  onConstraintStatusChange,
  onPreviewErrorChange,
  onDraftListOpenChange,
  onDraftSelectionRequest,
  onPublishSuccess,
  onMountableSelectionRequired,
  onMountableSelectionStateChange,
}: CreateCampaignModalContentProps, ref) {
  const { open } = ccc.useCcc();
  const signer = ccc.useSigner();
  const pageEditorRef = useRef<HTMLDivElement>(null);
  const modalTitleRef = useRef<HTMLDivElement>(null);
  const modalDescriptionRef = useRef<HTMLDivElement>(null);
  const activeEditorRef = useRef<HTMLDivElement | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const lastHandledStepBackSignalRef = useRef(stepBackSignal);
  const applyDraftAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftListRequestIdRef = useRef(0);
  const previousShowDraftsPaneRef = useRef(false);

  const [campaignType, setCampaignType] = useState<CampaignType>(CampaignType.SimpleTask);
  const [summary, setSummary] = useState("");
  const [modalTitle, setModalTitle] = useState("");
  const [modalDescription, setModalDescription] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [taskStartDelayHours, setTaskStartDelayHours] = useState("0");
  const [taskDurationHours, setTaskDurationHours] = useState("24");
  const [maxAmountCkb, setMaxAmountCkb] = useState("1000");
  const [rewardCount, setRewardCount] = useState("1");
  const [raffleTicketPriceCkb, setRaffleTicketPriceCkb] = useState("1");
  const [formsMountable, setFormsMountable] = useState<FormsMountableConfig>(DEFAULT_FORMS_MOUNTABLE_CONFIG);
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [showHashtagMenu, setShowHashtagMenu] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [hashtagPosition, setHashtagPosition] = useState({ top: 0, left: 0 });
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [mentionQuery, setMentionQuery] = useState("");
  const [modalStep, setModalStep] = useState<CreateModalStep>("compose");
  const [reviewSummary, setReviewSummary] = useState("");
  const [activeDraftRecordId, setActiveDraftRecordId] = useState<string | null>(null);
  const [draftRecords, setDraftRecords] = useState<DraftRecord[]>([]);
  const [isDraftListOpen, setIsDraftListOpen] = useState(false);
  const [isDraftListLoading, setIsDraftListLoading] = useState(false);
  const [draftListError, setDraftListError] = useState("");
  const [draftDeleteId, setDraftDeleteId] = useState<string | null>(null);
  const [showNoDraftsMessage, setShowNoDraftsMessage] = useState(false);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<DraftSnapshot | null>(null);
  const [isApplyingDraft, setIsApplyingDraft] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>("idle");
  const [draftSaveError, setDraftSaveError] = useState("");
  const [pendingAdvanceToReview, setPendingAdvanceToReview] = useState(false);
  const [pendingPublishedRecordSync, setPendingPublishedRecordSync] = useState<PendingPublishedRecordSync | null>(null);
  const activeDraftRecord = useMemo(
    () => draftRecords.find((record) => record._id === activeDraftRecordId) ?? null,
    [activeDraftRecordId, draftRecords]
  );

  const isModal = mode === "modal";
  const isReviewStep = isModal && modalStep === "review";
  const descriptionText = isModal ? modalDescription : summary;
  const createContent = isModal ? buildCreateContent(modalTitle, modalDescription) : summary;
  const createContentChars = getCountableChars(createContent);
  const trimmedModalTitle = modalTitle.trim();
  const trimmedModalDescription = modalDescription.trim();
  const generatedOnchainSummary = isModal
    ? buildOnchainSummary({ title: trimmedModalTitle, description: trimmedModalDescription })
    : buildOnchainSummary({ title: "", description: summary });
  const activeReviewSummary = isModal ? reviewSummary : generatedOnchainSummary;
  const modalTitleChars = getCountableChars(modalTitle);
  const modalDescriptionChars = getCountableChars(modalDescription);
  const modalTitleMaxChars = CREATE_MODAL_TITLE_MAX_CHARS;
  const modalDescriptionMaxChars = CREATE_MODAL_BODY_MAX_CHARS;
  const reviewSummaryBytes = getTextBytes(activeReviewSummary);

  const hashtags = useMemo(() => {
    const matches = descriptionText.match(/#\w+/g) || [];
    return matches.map((hashtag) => hashtag.substring(1));
  }, [descriptionText]);

  const firstHashtag = hashtags[0];
  const otherHashtags = hashtags.slice(1);
  const normalizedFirstHashtag = firstHashtag?.toLowerCase() ?? "";
  const compulsoryHashtags = hashtags.filter((tag) => COMPULSORY_HASHTAG_SET.has(tag.toLowerCase()));
  const isFirstHashtagCompulsory = normalizedFirstHashtag.length > 0 && COMPULSORY_HASHTAG_SET.has(normalizedFirstHashtag);
  const hasExactlyOneCompulsoryHashtag = compulsoryHashtags.length >= 1;
  const hasRequiredCompulsoryHashtag = isFirstHashtagCompulsory && hasExactlyOneCompulsoryHashtag;
  const descriptionChars = getCountableChars(descriptionText.trim());
  const minDescriptionChars = normalizedFirstHashtag === "raffle" ? 15 : 120;
  const hasRequiredBodyLength = descriptionChars >= minDescriptionChars;
  const hasRequiredTitle = !isModal || trimmedModalTitle.length > 0;
  const constraintsPassed = hasRequiredTitle && hasRequiredBodyLength && hasRequiredCompulsoryHashtag;
  const summaryBytes = createContentChars;
  const title = "Create a Campaign";
  const createPreviewLines = buildPreviewLines(trimmedModalDescription, 220);
  const activeModalError = draftSaveError || errorMsg;
  const isNextDisabled = status === "pending" || !constraintsPassed;
  const startDelayParts = useMemo(() => splitTimingParts(taskStartDelayHours, 0), [taskStartDelayHours]);
  const durationParts = useMemo(() => splitTimingParts(taskDurationHours, MIN_TASK_DURATION_MINUTES), [taskDurationHours]);
  const updateStartDelayFromParts = useCallback((hoursPart: string, minutesPart: string) => {
    setTaskStartDelayHours(buildTimingHoursFromParts(hoursPart, minutesPart, 0));
  }, []);
  const updateDurationFromParts = useCallback((hoursPart: string, minutesPart: string) => {
    setTaskDurationHours(buildTimingHoursFromParts(hoursPart, minutesPart, MIN_TASK_DURATION_MINUTES));
  }, []);
  const handleStartDelayHoursChange = useCallback((value: string) => {
    updateStartDelayFromParts(value, String(startDelayParts.minutes));
  }, [startDelayParts.minutes, updateStartDelayFromParts]);
  const handleStartDelayMinutesChange = useCallback((value: string) => {
    updateStartDelayFromParts(String(startDelayParts.hours), value);
  }, [startDelayParts.hours, updateStartDelayFromParts]);
  const handleDurationHoursChange = useCallback((value: string) => {
    updateDurationFromParts(value, String(durationParts.minutes));
  }, [durationParts.minutes, updateDurationFromParts]);
  const handleDurationMinutesChange = useCallback((value: string) => {
    updateDurationFromParts(String(durationParts.hours), value);
  }, [durationParts.hours, updateDurationFromParts]);
  const shouldCollectRaffleTicketPrice = normalizedFirstHashtag === "raffle";
  const hasMountedHashtag = hashtags.some((tag) => tag.toLowerCase() === "mounted");
  const normalizedCreateParams = useMemo(() => {
    try {
      return {
        value: normalizeCreateCampaignParams({
          maxAmountCkb,
          raffleTicketPriceCkb,
          rewardCount,
          shouldCollectRaffleTicketPrice,
          summary: activeReviewSummary,
          taskDurationHours,
          taskStartDelayHours,
        }),
        error: null as string | null,
      };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : "Invalid campaign parameters",
      };
    }
  }, [
    activeReviewSummary,
    maxAmountCkb,
    raffleTicketPriceCkb,
    rewardCount,
    shouldCollectRaffleTicketPrice,
    taskDurationHours,
    taskStartDelayHours,
  ]);
  const currentDraftSummary = isReviewStep ? activeReviewSummary : generatedOnchainSummary;
  const currentAuxAmountCkb = shouldCollectRaffleTicketPrice ? raffleTicketPriceCkb : "0";
  const currentDraftSnapshot = useMemo<DraftSnapshot>(() => buildDraftSnapshot({
    title: trimmedModalTitle,
    description: trimmedModalDescription,
    campaignType,
    summaryDraft: currentDraftSummary,
    taskStartDelayHours,
    taskDurationHours,
    maxAmountCkb,
    rewardCount,
    auxAmountCkb: currentAuxAmountCkb,
    mentions,
    formsMountable,
  }), [
    campaignType,
    currentAuxAmountCkb,
    currentDraftSummary,
    maxAmountCkb,
    formsMountable,
    mentions,
    rewardCount,
    taskDurationHours,
    taskStartDelayHours,
    trimmedModalDescription,
    trimmedModalTitle,
  ]);
  const hasTypedDraftContent = currentDraftSnapshot.title.length > 0 || currentDraftSnapshot.description.length > 0;
  const hasDraftableChanges = hasTypedDraftContent && !areDraftSnapshotsEqual(currentDraftSnapshot, lastSavedSnapshot);
  const isPublishDisabled =
    status === "pending" ||
    draftSaveStatus === "saving" ||
    (!draftSaveError && normalizedCreateParams.error !== null);
  const showDraftsPane = isModal && modalStep === "compose" && isDraftListOpen;
  const composeHelperMessage = showNoDraftsMessage
    ? "No saved drafts yet"
    : isDraftListLoading
      ? "Retrieving"
      : showDraftsPane && draftRecords.length > 0
        ? `${draftRecords.length} draft${draftRecords.length === 1 ? "" : "s"} available`
        : !constraintsPassed
          ? CREATE_CONSTRAINTS_MESSAGE_PENDING
          : "";

  useEffect(() => {
    if (isFirstHashtagCompulsory) {
      const typeEntry = Object.entries(CAMPAIGN_TYPE_LABELS).find(([, label]) => label.toLowerCase() === normalizedFirstHashtag);
      if (typeEntry) {
        setCampaignType(Number(typeEntry[0]) as CampaignType);
      }
    }
  }, [isFirstHashtagCompulsory, normalizedFirstHashtag]);

  useEffect(() => {
    onStepChange?.(status === "success" ? "compose" : modalStep);
  }, [modalStep, onStepChange, status]);

  const filteredMentions = MOCK_USERS.filter(
    (user) => user.toLowerCase().startsWith(mentionQuery.toLowerCase()) && mentionQuery.length > 0
  );

  const setEditorTextByNode = useCallback((node: HTMLDivElement | null, text: string) => {
    if (!node) return;
    if (node === modalTitleRef.current) {
      setModalTitle(text);
      return;
    }
    if (node === modalDescriptionRef.current) {
      setModalDescription(text);
      return;
    }
    setSummary(text);
  }, []);

  const getActiveEditor = useCallback(() => {
    return activeEditorRef.current ?? (isModal ? modalDescriptionRef.current : pageEditorRef.current);
  }, [isModal]);

  const getCaretPosition = useCallback((target: HTMLDivElement, selection = window.getSelection()) => {
    if (!selection || selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(target);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    return preCaretRange.toString().length;
  }, []);

  const setCaretPosition = useCallback((target: HTMLDivElement, position: number) => {
    const selection = window.getSelection();
    if (!selection) return;

    const fullText = target.textContent || "";
    if (position >= fullText.length) {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let remaining = position;
    let currentNode = walker.nextNode();

    while (currentNode) {
      const textLength = currentNode.textContent?.length ?? 0;
      if (remaining <= textLength) {
        const range = document.createRange();
        range.setStart(currentNode, remaining);
        range.setEnd(currentNode, remaining);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      remaining -= textLength;
      currentNode = walker.nextNode();
    }

    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const renderEditorText = useCallback((target: HTMLDivElement | null, text: string) => {
    if (!target) return;

    if (target === modalDescriptionRef.current || target === pageEditorRef.current) {
      if (text.length === 0) {
        target.replaceChildren();
        return;
      }

      const fragment = document.createDocumentFragment();
      const lines = text.split("\n");

      lines.forEach((line, index) => {
        if (index > 0) {
          fragment.appendChild(document.createTextNode("\n"));
        }

        if (/^\s*##\s+/.test(line)) {
          const headingLine = document.createElement("span");
          headingLine.textContent = line;
          headingLine.style.fontSize = "1.45rem";
          headingLine.style.lineHeight = "1.25";
          headingLine.style.fontWeight = "700";
          fragment.appendChild(headingLine);
          return;
        }

        fragment.appendChild(document.createTextNode(line));
      });

      if (text.endsWith("\n")) {
        fragment.appendChild(document.createElement("br"));
      }

      target.replaceChildren(fragment);
      return;
    }

    target.textContent = text;
  }, []);

  const hideMenus = useCallback(() => {
    setShowHashtagMenu(false);
    setShowMentionMenu(false);
    setMentionQuery("");
  }, []);

  const resetComposer = useCallback(() => {
    setStatus("idle");
    setSummary("");
    setModalTitle("");
    setModalDescription("");
    setErrorMsg("");
    setMentions([]);
    setCampaignType(CampaignType.SimpleTask);
    setTaskStartDelayHours("0");
    setTaskDurationHours("24");
    setMaxAmountCkb("1000");
    setRewardCount("1");
    setRaffleTicketPriceCkb("1");
    setFormsMountable(DEFAULT_FORMS_MOUNTABLE_CONFIG);
    setModalStep("compose");
    setReviewSummary("");
    setActiveDraftRecordId(null);
    setDraftRecords([]);
    setIsDraftListOpen(false);
    setIsDraftListLoading(false);
    setDraftListError("");
    setDraftDeleteId(null);
    setShowNoDraftsMessage(false);
    setLastSavedSnapshot(null);
    setPendingPublishedRecordSync(null);
    setIsApplyingDraft(false);
    if (applyDraftAnimationTimerRef.current) {
      clearTimeout(applyDraftAnimationTimerRef.current);
      applyDraftAnimationTimerRef.current = null;
    }
    setDraftSaveStatus("idle");
    setDraftSaveError("");
    hideMenus();
    if (pageEditorRef.current) {
      pageEditorRef.current.textContent = "";
    }
    if (modalTitleRef.current) {
      modalTitleRef.current.textContent = "";
    }
    if (modalDescriptionRef.current) {
      modalDescriptionRef.current.textContent = "";
    }
    activeEditorRef.current = null;
  }, [hideMenus]);

  useEffect(() => {
    if (mode === "modal") {
      resetComposer();
    }
  }, [mode, resetSignal, resetComposer]);

  useEffect(() => {
    if (
      !isModal ||
      stepBackSignal === 0 ||
      stepBackSignal === lastHandledStepBackSignalRef.current ||
      modalStep !== "review" ||
      status === "pending"
    ) {
      return;
    }

    lastHandledStepBackSignalRef.current = stepBackSignal;
    setModalStep("compose");
    setStatus("idle");
    setErrorMsg("");
    setDraftSaveStatus("idle");
    setDraftSaveError("");
    hideMenus();
  }, [hideMenus, isModal, modalStep, status, stepBackSignal]);

  useEffect(() => {
    onConstraintStatusChange?.({
      titlePassed: hasRequiredTitle,
      bodyPassed: hasRequiredBodyLength,
      firstHashtagPassed: hasRequiredCompulsoryHashtag,
      additionalHashtagsPassed: true,
    });
  }, [
    hasRequiredTitle,
    hasRequiredBodyLength,
    hasRequiredCompulsoryHashtag,
    onConstraintStatusChange,
  ]);

  useEffect(() => {
    onPreviewErrorChange?.(isReviewStep ? activeModalError : "");
  }, [activeModalError, isReviewStep, onPreviewErrorChange]);

  useEffect(() => {
    onDraftListOpenChange?.(isDraftListOpen);
  }, [isDraftListOpen, onDraftListOpenChange]);

  const handleEditorInput = (event: React.FormEvent<HTMLDivElement>) => {
    setShowNoDraftsMessage(false);
    const text = event.currentTarget.textContent || "";
    let normalizedText = text.trim().length === 0 ? "" : text;

    if (isModal) {
      if (event.currentTarget === modalTitleRef.current) {
        normalizedText = truncateToTextLimit(normalizedText, CREATE_MODAL_TITLE_MAX_CHARS);
      } else if (event.currentTarget === modalDescriptionRef.current) {
        normalizedText = truncateToTextLimit(normalizedText, CREATE_MODAL_BODY_MAX_CHARS);
      }
    }

    const selection = window.getSelection();
    const caretPos = getCaretPosition(event.currentTarget, selection);

    if (normalizedText.length === 0) {
      renderEditorText(event.currentTarget, "");
    } else if (
      text !== normalizedText ||
      event.currentTarget === modalDescriptionRef.current ||
      event.currentTarget === pageEditorRef.current
    ) {
      renderEditorText(event.currentTarget, normalizedText);
      setCaretPosition(event.currentTarget, Math.min(caretPos, normalizedText.length));
    }

    activeEditorRef.current = event.currentTarget;
    setEditorTextByNode(event.currentTarget, normalizedText);

    const activeSelection = window.getSelection();
    if (activeSelection && activeSelection.rangeCount > 0) {
      const range = activeSelection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(event.currentTarget);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const updatedCaretPos = preCaretRange.toString().length;
      const beforeCursor = normalizedText.substring(0, updatedCaretPos);

      const lastHashIndex = beforeCursor.lastIndexOf("#");
      const hashtagMatch =
        lastHashIndex !== -1 ? beforeCursor.substring(lastHashIndex + 1).match(/^[\w]*$/) : null;

      const allowHashtagMenu =
        event.currentTarget === modalDescriptionRef.current || event.currentTarget === pageEditorRef.current;

      if (
        allowHashtagMenu &&
        hashtagMatch &&
        normalizedText[updatedCaretPos - 1] !== " " &&
        normalizedText[updatedCaretPos - 1] !== "\n"
      ) {
        const rect = event.currentTarget.getBoundingClientRect();
        setHashtagPosition({
          top: rect.top + rect.height,
          left: rect.left,
        });
        setShowHashtagMenu(true);
      } else {
        setShowHashtagMenu(false);
      }

      const lastAtIndex = beforeCursor.lastIndexOf("@");
      const mentionMatch =
        lastAtIndex !== -1 ? beforeCursor.substring(lastAtIndex + 1).match(/^[\w]*$/) : null;

      if (mentionMatch && normalizedText[updatedCaretPos - 1] !== " " && normalizedText[updatedCaretPos - 1] !== "\n") {
        const query = beforeCursor.substring(lastAtIndex + 1);
        setMentionQuery(query);
        const rect = event.currentTarget.getBoundingClientRect();
        setMentionPosition({
          top: rect.top + rect.height,
          left: rect.left,
        });
        setShowMentionMenu(true);
      } else {
        setShowMentionMenu(false);
      }
    }
  };

  const handleModalTitleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const descriptionEl = modalDescriptionRef.current;
      if (descriptionEl) {
        descriptionEl.focus();
        activeEditorRef.current = descriptionEl;
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(descriptionEl);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return;
    }

    handleEditorKeyDown(event);
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    activeEditorRef.current = event.currentTarget;

    if (event.key === "Enter") {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        event.preventDefault();
        const range = selection.getRangeAt(0);
        const text = event.currentTarget.textContent || "";
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(event.currentTarget);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        const caretPos = preCaretRange.toString().length;
        const lineStartBreakIndex = text.lastIndexOf("\n", Math.max(caretPos - 1, 0));
        const lineStartIndex = lineStartBreakIndex === -1 ? 0 : lineStartBreakIndex + 1;
        const lineEndBreakIndex = text.indexOf("\n", caretPos);
        const lineEndIndex = lineEndBreakIndex === -1 ? text.length : lineEndBreakIndex;
        const currentLine = text.slice(lineStartIndex, lineEndIndex);
        const nextListLine = getNextListLine(currentLine);

        let newText =
          nextListLine?.mode === "exit"
            ? text.slice(0, lineStartIndex) + text.slice(lineEndIndex)
            : text.slice(0, caretPos) + (nextListLine?.insertText ?? "\n") + text.slice(caretPos);

        if (isModal && event.currentTarget === modalDescriptionRef.current) {
          newText = truncateToTextLimit(newText, CREATE_MODAL_BODY_MAX_CHARS);
        }

        renderEditorText(event.currentTarget, newText);
        setEditorTextByNode(event.currentTarget, newText);
        hideMenus();

        const newCaretPos = Math.min(
          nextListLine?.mode === "exit"
            ? lineStartIndex
            : caretPos + (nextListLine?.insertText?.length ?? 1),
          newText.length
        );

        setCaretPosition(event.currentTarget, newCaretPos);
        return;
      }
    }

    if (
      event.key === "Backspace" &&
      event.currentTarget === modalDescriptionRef.current &&
      (modalDescriptionRef.current?.textContent || "").trim().length === 0
    ) {
      event.preventDefault();
      const titleEl = modalTitleRef.current;
      if (titleEl) {
        const titleText = titleEl.textContent || "";
        const newTitleText = titleText.slice(0, -1);
        titleEl.textContent = newTitleText;
        renderEditorText(titleEl, newTitleText);
        setModalTitle(newTitleText);
        titleEl.focus();
        activeEditorRef.current = titleEl;
        setCaretPosition(titleEl, newTitleText.length);
      }
      hideMenus();
      return;
    }

    if (event.key === "Escape") {
      hideMenus();
      event.preventDefault();
      return;
    }

    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const modKey = isMac ? event.metaKey : event.ctrlKey;

    if (modKey) {
      switch (event.key.toLowerCase()) {
        case "b":
          event.preventDefault();
          document.execCommand("bold", false);
          break;
        case "i":
          event.preventDefault();
          document.execCommand("italic", false);
          break;
        case "u":
          event.preventDefault();
          document.execCommand("underline", false);
          break;
      }
    }
  };

  const applyFormat = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    const targetEditor = getActiveEditor();
    targetEditor?.focus();
    activeEditorRef.current = targetEditor;
  };

  const handleHashtagSelect = (label: string) => {
    const targetEditor = getActiveEditor();
    if (!targetEditor) return;

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const text = targetEditor.textContent || "";
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(targetEditor);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const caretPos = preCaretRange.toString().length;

      const lastHashIndex = text.lastIndexOf("#", caretPos - 1);
      if (lastHashIndex !== -1) {
        const insertedText = text.substring(0, lastHashIndex) + `#${label} ` + text.substring(caretPos);
        const newText =
          isModal && targetEditor === modalDescriptionRef.current
            ? truncateToTextLimit(insertedText, CREATE_MODAL_BODY_MAX_CHARS)
            : isModal && targetEditor === modalTitleRef.current
              ? truncateToTextLimit(insertedText, CREATE_MODAL_TITLE_MAX_CHARS)
              : insertedText;

        targetEditor.textContent = newText;
        setEditorTextByNode(targetEditor, newText);
        setShowHashtagMenu(false);

        setTimeout(() => {
          const newPos = Math.min(lastHashIndex + label.length + 2, newText.length);
          const newRange = document.createRange();
          const activeSelection = window.getSelection();
          if (targetEditor.firstChild) {
            newRange.setStart(targetEditor.firstChild, newPos);
            newRange.setEnd(targetEditor.firstChild, newPos);
            activeSelection?.removeAllRanges();
            activeSelection?.addRange(newRange);
          }
        }, 0);
      }
    }
  };

  const handleMentionSelect = (username: string) => {
    const targetEditor = getActiveEditor();
    if (!targetEditor) return;

    const text = targetEditor.textContent || "";
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(targetEditor);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const caretPos = preCaretRange.toString().length;

      const lastAtIndex = text.lastIndexOf("@", caretPos - 1);
      if (lastAtIndex !== -1) {
        const insertedText = text.substring(0, lastAtIndex) + `@${username} ` + text.substring(caretPos);
        const newText =
          isModal && targetEditor === modalDescriptionRef.current
            ? truncateToTextLimit(insertedText, CREATE_MODAL_BODY_MAX_CHARS)
            : isModal && targetEditor === modalTitleRef.current
              ? truncateToTextLimit(insertedText, CREATE_MODAL_TITLE_MAX_CHARS)
              : insertedText;

        targetEditor.textContent = newText;
        setEditorTextByNode(targetEditor, newText);
        setShowMentionMenu(false);

        if (!mentions.includes(username) && newText.includes(`@${username}`)) {
          setMentions((current) => [...current, username]);
        }

        setTimeout(() => {
          const newPos = Math.min(lastAtIndex + username.length + 2, newText.length);
          const newRange = document.createRange();
          const activeSelection = window.getSelection();
          if (targetEditor.firstChild) {
            newRange.setStart(targetEditor.firstChild, newPos);
            newRange.setEnd(targetEditor.firstChild, newPos);
            activeSelection?.removeAllRanges();
            activeSelection?.addRange(newRange);
          }
        }, 0);
      }
    }
  };

  const handleRemoveMention = (mention: string) => {
    setMentions((current) => current.filter((item) => item !== mention));
  };

  const validateComposeConstraints = () => {
    if (isModal && !hasRequiredTitle) {
      setErrorMsg("Please add a title");
      setStatus("error");
      return false;
    }

    if (!hasRequiredBodyLength) {
      setErrorMsg(`Description must be at least ${minDescriptionChars} characters`);
      setStatus("error");
      return false;
    }

    if (!isFirstHashtagCompulsory) {
      setErrorMsg("The first hashtag must be one of #SimpleTask, #FundedTask, #Crowdfunding, #TimedChallenge, or #Raffle");
      setStatus("error");
      return false;
    }

    if (!hasExactlyOneCompulsoryHashtag) {
      setErrorMsg("Use exactly one compulsory hashtag (#SimpleTask, #FundedTask, #Crowdfunding, #TimedChallenge, or #Raffle)");
      setStatus("error");
      return false;
    }

    return true;
  };

  const syncEditorsFromState = useCallback((nextTitle: string, nextDescription: string) => {
    renderEditorText(modalTitleRef.current, nextTitle);
    renderEditorText(modalDescriptionRef.current, nextDescription);
    renderEditorText(pageEditorRef.current, nextDescription);
  }, [renderEditorText]);

  useEffect(() => {
    if (!isModal || modalStep !== "compose") {
      previousShowDraftsPaneRef.current = showDraftsPane;
      return;
    }

    const wasShowingDraftsPane = previousShowDraftsPaneRef.current;
    previousShowDraftsPaneRef.current = showDraftsPane;

    if (wasShowingDraftsPane && !showDraftsPane) {
      syncEditorsFromState(modalTitle, modalDescription);
    }
  }, [isModal, modalDescription, modalStep, modalTitle, showDraftsPane, syncEditorsFromState]);

  const getCreatorAddress = useCallback(async () => {
    if (!signer) {
      throw new Error("Connect wallet to manage drafts");
    }

    const creatorAddress = await signer.getRecommendedAddress();
    if (!creatorAddress) {
      throw new Error("Unable to resolve wallet address for drafts");
    }

    return creatorAddress;
  }, [signer]);

  const applyDraftRecord = useCallback((record: DraftRecord) => {
    const nextTitle = record.title?.trim() ?? "";
    const nextDescription = record.description?.trim() ?? "";
    const nextCampaignType = typeof record.campaignType === "number"
      ? (record.campaignType as CampaignType)
      : CampaignType.SimpleTask;
    const nextSummary = record.summaryDraft?.trim() ?? "";
    const nextMentions = Array.isArray(record.socialMetadata?.mentions) ? record.socialMetadata.mentions : [];
    const nextStartDelay = record.argsDraft?.taskStartDelayHours ?? "0";
    const nextDuration = record.argsDraft?.taskDurationHours ?? "24";
    const nextMaxAmount = record.argsDraft?.maxAmountCkb ?? "1000";
    const nextRewardCount = record.argsDraft?.rewardCount ?? "1";
    const nextAuxAmount = record.argsDraft?.auxAmountCkb ?? "0";
    const isRaffleDraft = nextCampaignType === CampaignType.Raffle;

    setModalTitle(nextTitle);
    setModalDescription(nextDescription);
    setSummary(nextDescription);
    setCampaignType(nextCampaignType);
    setMentions(nextMentions);
    setTaskStartDelayHours(nextStartDelay);
    setTaskDurationHours(nextDuration);
    setMaxAmountCkb(nextMaxAmount);
    setRewardCount(nextRewardCount);
    setRaffleTicketPriceCkb(isRaffleDraft ? nextAuxAmount : "1");
    setReviewSummary(nextSummary || buildOnchainSummary({ title: nextTitle, description: nextDescription }));
    setFormsMountable(normalizeFormsMountableConfig(record.mountables?.forms));
    setActiveDraftRecordId(record._id ?? null);
    setModalStep("compose");
    setIsDraftListOpen(false);
    setDraftSaveStatus("idle");
    setDraftSaveError("");
    setDraftListError("");
    setPendingPublishedRecordSync(null);
    setStatus("idle");
    setErrorMsg("");
    syncEditorsFromState(nextTitle, nextDescription);

    const nextSnapshot = buildDraftSnapshot({
      title: nextTitle,
      description: nextDescription,
      campaignType: nextCampaignType,
      summaryDraft: nextSummary || buildOnchainSummary({ title: nextTitle, description: nextDescription }),
      taskStartDelayHours: nextStartDelay,
      taskDurationHours: nextDuration,
      maxAmountCkb: nextMaxAmount,
      rewardCount: nextRewardCount,
      auxAmountCkb: nextAuxAmount,
      mentions: nextMentions,
      formsMountable: normalizeFormsMountableConfig(record.mountables?.forms),
    });
    setLastSavedSnapshot(nextSnapshot);

    setIsApplyingDraft(true);
    if (applyDraftAnimationTimerRef.current) {
      clearTimeout(applyDraftAnimationTimerRef.current);
    }
    applyDraftAnimationTimerRef.current = setTimeout(() => {
      setIsApplyingDraft(false);
      applyDraftAnimationTimerRef.current = null;
    }, 420);
  }, [syncEditorsFromState]);

  const loadDraftRecords = useCallback(async () => {
    const requestId = draftListRequestIdRef.current + 1;
    draftListRequestIdRef.current = requestId;
    setIsDraftListOpen(true);
    setIsDraftListLoading(true);
    setDraftListError("");
    setShowNoDraftsMessage(false);

    try {
      const creatorAddress = await getCreatorAddress();
      const response = await fetch(`/api/campaign-records/drafts?creatorAddress=${encodeURIComponent(creatorAddress)}`, {
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to load drafts");
      }

      if (draftListRequestIdRef.current !== requestId) {
        return false;
      }

      const nextRecords = Array.isArray(data?.records) ? (data.records as DraftRecord[]) : [];
      setDraftRecords(nextRecords);
      if (nextRecords.length === 0) {
        setIsDraftListOpen(false);
        setShowNoDraftsMessage(true);
        return false;
      }
      return true;
    } catch (error) {
      if (draftListRequestIdRef.current !== requestId) {
        return false;
      }

      setDraftRecords([]);
      setIsDraftListOpen(true);
      setDraftListError(error instanceof Error ? error.message : "Failed to load drafts");
      throw error;
    } finally {
      if (draftListRequestIdRef.current === requestId) {
        setIsDraftListLoading(false);
      }
    }
  }, [getCreatorAddress]);

  const deleteDraftRecord = useCallback(async (recordId: string) => {
    setDraftDeleteId(recordId);
    setDraftListError("");

    try {
      const creatorAddress = await getCreatorAddress();
      const response = await fetch(`/api/campaign-records/${recordId}?creatorAddress=${encodeURIComponent(creatorAddress)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to delete draft");
      }

      setDraftRecords((current) => current.filter((record) => record._id !== recordId));
      if (activeDraftRecordId === recordId) {
        setActiveDraftRecordId(null);
        setModalTitle("");
        setModalDescription("");
        setSummary("");
        setReviewSummary("");
        setCampaignType(CampaignType.SimpleTask);
        setMentions([]);
        setTaskStartDelayHours("0");
        setTaskDurationHours("24");
        setMaxAmountCkb("1000");
        setRewardCount("1");
        setRaffleTicketPriceCkb("1");
        setFormsMountable(DEFAULT_FORMS_MOUNTABLE_CONFIG);
        setLastSavedSnapshot(null);
        setDraftSaveStatus("idle");
        setDraftSaveError("");
        setStatus("idle");
        setErrorMsg("");
        setModalStep("compose");
        hideMenus();
        syncEditorsFromState("", "");
        activeEditorRef.current = null;
      }
    } catch (error) {
      setDraftListError(error instanceof Error ? error.message : "Failed to delete draft");
      throw error;
    } finally {
      setDraftDeleteId(null);
    }
  }, [activeDraftRecordId, getCreatorAddress, hideMenus, syncEditorsFromState]);

  const buildDraftPayload = useCallback(
    async (
      summaryDraft: string,
      draftStatus: DraftRecordStatus,
      txHashValue: string | null,
      publishError: string | null,
      randomnessPreimage: string | null = null,
      identityOverride: CampaignIdentityOverride | null = null
    ) => {
      const creatorAddress = await getCreatorAddress();
      const resolvedIdentity = identityOverride ?? activeDraftRecord;

      return {
        title: trimmedModalTitle,
        description: trimmedModalDescription,
        campaignId: resolvedIdentity?.campaignId ?? null,
        createdByHash: resolvedIdentity?.createdByHash ?? null,
        chainCreatedAt: resolvedIdentity?.chainCreatedAt ?? null,
        campaignType,
        summaryDraft,
        argsDraft: {
          taskStartDelayHours,
          taskDurationHours,
          maxAmountCkb,
          rewardCount,
          auxAmountCkb: shouldCollectRaffleTicketPrice ? raffleTicketPriceCkb : "0",
        },
        mountables: {
          forms: formsMountable.enabled ? formsMountable : null,
        },
        socialMetadata: {
          mentions,
          comments: [],
          likeCount: 0,
          likedByAddresses: [],
          bookmarkCount: 0,
          reshareCount: 0,
        },
        creatorAddress,
        creatorHandle: deriveDefaultCreatorHandle(creatorAddress),
        status: draftStatus,
        txHash: txHashValue,
        publishError,
        randomnessPreimage,
      };
    },
    [
      activeDraftRecord,
      campaignType,
      formsMountable,
      getCreatorAddress,
      maxAmountCkb,
      mentions,
      raffleTicketPriceCkb,
      rewardCount,
      shouldCollectRaffleTicketPrice,
      taskDurationHours,
      taskStartDelayHours,
      trimmedModalDescription,
      trimmedModalTitle,
    ]
  );

  const persistDraftRecord = useCallback(
    async (
      summaryDraft: string,
      draftStatus: DraftRecordStatus,
      txHashValue: string | null = null,
      publishError: string | null = null,
      randomnessPreimage: string | null = null,
      recordIdOverride: string | null = activeDraftRecordId,
      identityOverride: CampaignIdentityOverride | null = null
    ) => {
      setDraftSaveStatus("saving");
      setDraftSaveError("");

      try {
        const payload = await buildDraftPayload(summaryDraft, draftStatus, txHashValue, publishError, randomnessPreimage, identityOverride);
        const response = await fetch(recordIdOverride ? `/api/campaign-records/${recordIdOverride}` : "/api/campaign-records", {
          method: recordIdOverride ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error ?? "Failed to save campaign record");
        }

        const persistedId = data?.id ?? recordIdOverride;
        if (persistedId) {
          setActiveDraftRecordId(persistedId);
        }

        const nextSnapshot = buildDraftSnapshot({
          title: trimmedModalTitle,
          description: trimmedModalDescription,
          campaignType,
          summaryDraft,
          taskStartDelayHours,
          taskDurationHours,
          maxAmountCkb,
          rewardCount,
          auxAmountCkb: shouldCollectRaffleTicketPrice ? raffleTicketPriceCkb : "0",
          mentions,
          formsMountable,
        });
        setLastSavedSnapshot(nextSnapshot);

        setDraftRecords((current) => {
          const updatedRecord: DraftRecord = {
            _id: persistedId ?? undefined,
            title: trimmedModalTitle,
            description: trimmedModalDescription,
            campaignId: identityOverride?.campaignId ?? activeDraftRecord?.campaignId ?? null,
            createdByHash: identityOverride?.createdByHash ?? activeDraftRecord?.createdByHash ?? null,
            chainCreatedAt: identityOverride?.chainCreatedAt ?? activeDraftRecord?.chainCreatedAt ?? null,
            campaignType,
            summaryDraft,
            argsDraft: {
              taskStartDelayHours,
              taskDurationHours,
              maxAmountCkb,
              rewardCount,
              auxAmountCkb: shouldCollectRaffleTicketPrice ? raffleTicketPriceCkb : "0",
            },
            mountables: {
              forms: formsMountable.enabled ? formsMountable : null,
            },
            socialMetadata: {
              mentions,
            },
            status: draftStatus,
            txHash: txHashValue,
            publishError,
            randomnessPreimage,
            activatedTxHash: activeDraftRecord?.activatedTxHash ?? null,
            updatedAt: new Date().toISOString(),
          };

          if (!persistedId) {
            return current;
          }

          const remaining = current.filter((record) => record._id !== persistedId);
          if (draftStatus === "published") {
            return remaining;
          }

          return [updatedRecord, ...remaining];
        });

        setDraftSaveStatus("saved");
        return persistedId;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save campaign record";
        setDraftSaveStatus("error");
        setDraftSaveError(message);
        throw error;
      }
    },
    [
      activeDraftRecordId,
      buildDraftPayload,
      campaignType,
      maxAmountCkb,
      mentions,
      raffleTicketPriceCkb,
      rewardCount,
      shouldCollectRaffleTicketPrice,
      taskDurationHours,
      taskStartDelayHours,
      trimmedModalDescription,
      trimmedModalTitle,
    ]
  );

  useEffect(() => {
    return () => {
      if (applyDraftAnimationTimerRef.current) {
        clearTimeout(applyDraftAnimationTimerRef.current);
      }
    };
  }, []);

  const handleAdvanceToReview = useCallback(async (skipMountedSelection = false) => {
    if (!validateComposeConstraints()) {
      return;
    }

    if (!skipMountedSelection && hasMountedHashtag) {
      onMountableSelectionRequired?.();
      return;
    }

    if (!signer) {
      setPendingAdvanceToReview(true);
      setStatus("idle");
      setErrorMsg("");
      open();
      return;
    }

    setPendingAdvanceToReview(false);

    const nextSummary = buildOnchainSummary({ title: trimmedModalTitle, description: trimmedModalDescription });
    setReviewSummary(nextSummary);
    setStatus("idle");
    setDraftSaveStatus("idle");
    setDraftSaveError("");
    setModalStep("review");
    setErrorMsg("");
    hideMenus();

    try {
      await persistDraftRecord(nextSummary, "draft");
    } catch {
      setStatus("error");
    }
  }, [formsMountable.enabled, hasMountedHashtag, hideMenus, onMountableSelectionRequired, open, persistDraftRecord, signer, trimmedModalDescription, trimmedModalTitle, validateComposeConstraints]);

  const handleSaveDraftFromClose = useCallback(async () => {
    if (!hasDraftableChanges) {
      return;
    }

    setStatus("idle");
    setErrorMsg("");
    await persistDraftRecord(currentDraftSummary, "draft");
  }, [currentDraftSummary, hasDraftableChanges, persistDraftRecord]);

  const handleDiscardDraftSession = useCallback(() => {
    setActiveDraftRecordId(null);
    setIsDraftListOpen(false);
    setDraftListError("");
    setDraftDeleteId(null);
    setShowNoDraftsMessage(false);
    setLastSavedSnapshot(null);
    setPendingAdvanceToReview(false);
    setPendingPublishedRecordSync(null);
    setIsApplyingDraft(false);
    if (applyDraftAnimationTimerRef.current) {
      clearTimeout(applyDraftAnimationTimerRef.current);
      applyDraftAnimationTimerRef.current = null;
    }
    setDraftSaveStatus("idle");
    setDraftSaveError("");
    setStatus("idle");
    setErrorMsg("");
    hideMenus();
  }, [hideMenus]);

  const handleToggleDraftList = useCallback(async () => {
    if (isDraftListOpen) {
      setIsDraftListOpen(false);
      setDraftListError("");
      setShowNoDraftsMessage(false);
      return false;
    }

    return loadDraftRecords();
  }, [isDraftListOpen, loadDraftRecords]);

  const handleApplyDraftSelection = useCallback((draftId: string) => {
    const nextRecord = draftRecords.find((record) => record._id === draftId);
    if (!nextRecord) {
      return;
    }

    applyDraftRecord(nextRecord);
  }, [applyDraftRecord, draftRecords]);

  const handleSetFormsMountableEnabled = useCallback((enabled: boolean) => {
    setFormsMountable((current) => normalizeFormsMountableConfig({
      ...current,
      enabled,
    }));
  }, []);

  useImperativeHandle(ref, () => ({
    hasDraftableChanges: () => hasDraftableChanges,
    saveDraftFromClose: handleSaveDraftFromClose,
    discardDraftSession: handleDiscardDraftSession,
    toggleDraftList: handleToggleDraftList,
    applyDraftSelection: handleApplyDraftSelection,
    setFormsMountableEnabled: handleSetFormsMountableEnabled,
    advanceToReviewAfterMountableSelection: () => handleAdvanceToReview(true),
  }), [
    handleAdvanceToReview,
    handleApplyDraftSelection,
    handleDiscardDraftSession,
    handleSaveDraftFromClose,
    handleSetFormsMountableEnabled,
    handleToggleDraftList,
    hasDraftableChanges,
  ]);

  useEffect(() => {
    if (!pendingAdvanceToReview || !signer || !isModal || modalStep !== "compose") {
      return;
    }

    void handleAdvanceToReview();
  }, [handleAdvanceToReview, isModal, modalStep, pendingAdvanceToReview, signer]);

  useEffect(() => {
    if (!isModal) {
      return;
    }

    onMountableSelectionStateChange?.({
      hasMountedHashtag,
      formsSelected: formsMountable.enabled,
    });
  }, [formsMountable.enabled, hasMountedHashtag, isModal, onMountableSelectionStateChange]);

  const finalizePublishedRecordSync = useCallback(
    async (sync: PendingPublishedRecordSync) => {
      const persistedId = await persistDraftRecord(
        sync.summaryDraft,
        "published",
        sync.txHash,
        null,
        sync.randomnessPreimage,
        sync.draftRecordId,
        {
          campaignId: sync.campaignId,
          createdByHash: sync.createdByHash,
          chainCreatedAt: sync.chainCreatedAt,
        }
      );

      if (!persistedId) {
        throw new Error("Failed to finalize published campaign record");
      }

      setPendingPublishedRecordSync(null);
      return persistedId;
    },
    [persistDraftRecord]
  );

  const handleRetryDraftSave = async () => {
    setStatus("idle");
    setErrorMsg("");

    try {
      if (pendingPublishedRecordSync) {
        await finalizePublishedRecordSync(pendingPublishedRecordSync);
        onPublishSuccess?.(pendingPublishedRecordSync.txHash, pendingPublishedRecordSync.randomnessPreimage);
        setStatus("success");
        return;
      }

      await persistDraftRecord(activeReviewSummary, "draft");
    } catch {
      setStatus("error");
    }
  };

  const validateReviewInputs = () => {
    if (draftSaveStatus === "saving") {
      setErrorMsg("Please wait while the draft is being saved");
      setStatus("error");
      return false;
    }

    if (draftSaveStatus === "error" && !pendingPublishedRecordSync) {
      setErrorMsg("Please retry saving the draft before publishing");
      setStatus("error");
      return false;
    }

    if (normalizedCreateParams.error) {
      setErrorMsg(normalizedCreateParams.error);
      setStatus("error");
      return false;
    }

    return true;
  };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (isModal && modalStep === "compose") {
      await handleAdvanceToReview();
      return;
    }

    if (!validateComposeConstraints()) {
      return;
    }

    if (isModal && !validateReviewInputs()) {
      return;
    }

    if (!signer) {
      setStatus("idle");
      setErrorMsg("");
      open();
      return;
    }

    const summaryToPublish = isModal
      ? truncateToUtf8Bytes(activeReviewSummary.trim(), SUMMARY_MAX_BYTES)
      : generatedOnchainSummary;
    let stagedDraftRecordId: string | null = null;
    let attemptedOnchainPublish = false;
    let pendingSync: PendingPublishedRecordSync | null = null;

    setStatus("pending");
    setErrorMsg("");
    setPendingPublishedRecordSync(null);

    try {
      const normalizedParams = normalizedCreateParams.value;
      if (!normalizedParams) {
        throw new Error(normalizedCreateParams.error ?? "Invalid campaign parameters");
      }

      // debug
      const randomnessCommitment = shouldCollectRaffleTicketPrice ? createRandomnessCommitment() : null;
      const randomnessHash = randomnessCommitment?.commitment ?? new Uint8Array(32);
      const randomnessPreimageHex = randomnessCommitment ? randomnessPreimageToHex(randomnessCommitment.preimage) : null;

      if (isModal && randomnessPreimageHex) {
        stagedDraftRecordId = await persistDraftRecord(summaryToPublish, "draft", null, null, randomnessPreimageHex);
        if (!stagedDraftRecordId) {
          throw new Error("Failed to save the raffle preimage before publishing");
        }
      }

      attemptedOnchainPublish = true;
      const publishResult = await sendCreateCampaign(signer, {
        startDurationSecs: normalizedParams.startDurationSecs,
        taskDurationSecs: normalizedParams.taskDurationSecs,
        campaignType,
        maximumAmountCkb: normalizedParams.maximumAmountCkb,
        auxAmountCkb: normalizedParams.auxAmountCkb,
        rewardCount: normalizedParams.rewardCount,
        summary: summaryToPublish,
        randomnessHash,
      });

      if (isModal) {
        const draftRecordId = stagedDraftRecordId ?? activeDraftRecordId;
        if (!draftRecordId) {
          throw new Error("Failed to resolve the campaign record after publishing");
        }

        pendingSync = {
          draftRecordId,
          summaryDraft: summaryToPublish,
          txHash: publishResult.txHash,
          campaignId: publishResult.campaignId,
          createdByHash: publishResult.createdByHash,
          chainCreatedAt: publishResult.chainCreatedAt,
          randomnessPreimage: randomnessPreimageHex,
        };
        await finalizePublishedRecordSync(pendingSync);
      }

      onPublishSuccess?.(publishResult.txHash, randomnessPreimageHex);
      setStatus("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (pendingSync) {
        setPendingPublishedRecordSync(pendingSync);
        setDraftSaveStatus("error");
        setDraftSaveError(`Campaign published on-chain, but saving the published record failed: ${message}`);
        setErrorMsg("");
        setStatus("error");
        return;
      }

      if (isModal && attemptedOnchainPublish) {
        const failedRecordId = stagedDraftRecordId ?? activeDraftRecordId;
        if (failedRecordId) {
          try {
            await persistDraftRecord(
              summaryToPublish,
              "publish_failed",
              null,
              message,
              null,
              failedRecordId,
              null
            );
          } catch {
            // Preserve the original publish failure message.
          }
        }
      }

      setPendingPublishedRecordSync(null);
      setErrorMsg(message);
      setStatus("error");
    }
  }

  const renderModalArgsInputs = () => (
    <div className="create-review-args-grid">
      <div className="create-review-arg-field">
        <label className="create-review-arg-label">Start delay</label>
        <div className="create-review-arg-control gap-2">
          <input
            type="number"
            min="0"
            step="1"
            value={String(startDelayParts.hours)}
            onChange={(event) => handleStartDelayHoursChange(event.target.value)}
            className="create-review-arg-input"
          />
          <span className="create-review-arg-unit">hrs</span>
          <input
            type="number"
            min="0"
            max="55"
            step={TIMING_MINUTE_STEP}
            value={String(startDelayParts.minutes)}
            onChange={(event) => handleStartDelayMinutesChange(event.target.value)}
            className="create-review-arg-input"
          />
          <span className="create-review-arg-unit">min</span>
        </div>
      </div>

      <div className="create-review-arg-field">
        <label className="create-review-arg-label">Duration</label>
        <div className="create-review-arg-control gap-2">
          <input
            type="number"
            min="0"
            step="1"
            value={String(durationParts.hours)}
            onChange={(event) => handleDurationHoursChange(event.target.value)}
            className="create-review-arg-input"
          />
          <span className="create-review-arg-unit">hrs</span>
          <input
            type="number"
            min={MIN_TASK_DURATION_MINUTES}
            max="55"
            step={TIMING_MINUTE_STEP}
            value={String(durationParts.minutes)}
            onChange={(event) => handleDurationMinutesChange(event.target.value)}
            className="create-review-arg-input"
          />
          <span className="create-review-arg-unit">min</span>
        </div>
      </div>

      <div className="create-review-arg-field">
        <label className="create-review-arg-label">{shouldCollectRaffleTicketPrice ? "Number of tickets" : "Max deposit"}</label>
        <div className="create-review-arg-control">
          <input
            type="number"
            min="1"
            step="1"
            value={maxAmountCkb}
            onChange={(event) => setMaxAmountCkb(event.target.value)}
            className="create-review-arg-input"
          />
          <span className="create-review-arg-unit">{shouldCollectRaffleTicketPrice ? "tickets" : "CKB"}</span>
        </div>
      </div>

      <div className="create-review-arg-field">
        <label className="create-review-arg-label">Split count</label>
        <div className="create-review-arg-control">
          <input
            type="number"
            min="1"
            step="1"
            value={rewardCount}
            onChange={(event) => setRewardCount(event.target.value)}
            className="create-review-arg-input"
          />
          <span className="create-review-arg-unit">people</span>
        </div>
      </div>

      {shouldCollectRaffleTicketPrice ? (
        <div className="create-review-arg-field">
          <label className="create-review-arg-label">Ticket price</label>
          <div className="create-review-arg-control">
            <input
              type="number"
              min="1"
              step="1"
              value={raffleTicketPriceCkb}
              onChange={(event) => setRaffleTicketPriceCkb(event.target.value)}
              className="create-review-arg-input"
            />
            <span className="create-review-arg-unit">CKB</span>
          </div>
        </div>
      ) : (
        <div className="create-review-arg-field">
          <label className="create-review-arg-label">Social</label>
          <div className="create-review-social-control" aria-label="Social actions enabled">
            <span>Like</span>
            <span>Reply</span>
            <span>Share</span>
          </div>
        </div>
      )}
    </div>
  );

  const renderDraftListSkeleton = () => (
    <div className="create-drafts-skeleton-list" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="create-draft-card create-draft-card-skeleton">
          <div className="create-draft-card-main create-draft-card-main-skeleton">
            <div className="create-draft-card-row">
              <span className="create-draft-skeleton-block create-draft-skeleton-title" />
              <span className="create-draft-skeleton-block create-draft-skeleton-time" />
            </div>
            <div className="create-draft-skeleton-copy">
              <span className="create-draft-skeleton-block create-draft-skeleton-line" />
              <span className="create-draft-skeleton-block create-draft-skeleton-line create-draft-skeleton-line-short" />
            </div>
          </div>
          <span className="create-draft-skeleton-block create-draft-skeleton-delete" />
        </div>
      ))}
    </div>
  );

  const renderDraftsPane = () => (
    <div className="create-drafts-pane">
      <div className="create-drafts-pane-header">
        <p className="create-review-section-label">Saved drafts</p>
      </div>

      {draftListError ? <p className="create-drafts-feedback create-drafts-feedback-error">{draftListError}</p> : null}
      {isDraftListLoading ? renderDraftListSkeleton() : null}

      {!isDraftListLoading && draftRecords.length > 0 ? (
        <div className="create-drafts-list create-drafts-list-full">
          {draftRecords.map((record) => {
            const isDeleting = draftDeleteId === record._id;
            return (
              <div key={record._id} className="create-draft-card">
                <button
                  type="button"
                  className="create-draft-card-main"
                  onClick={() => {
                    if (record._id) {
                      onDraftSelectionRequest?.(record._id);
                    }
                  }}
                >
                  <div className="create-draft-card-row">
                    <span className="create-draft-card-title">{record.title?.trim() || "Untitled draft"}</span>
                    <span className="create-draft-card-time">{formatDraftUpdatedAt(record.updatedAt)}</span>
                  </div>
                  <p className="create-draft-card-summary">{record.summaryDraft?.trim() || "No summary yet."}</p>
                </button>
                <button
                  type="button"
                  className="create-draft-card-delete"
                  onClick={() => {
                    if (record._id) {
                      void deleteDraftRecord(record._id).catch(() => undefined);
                    }
                  }}
                  disabled={isDeleting}
                  aria-label="Delete draft"
                >
                  <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  const renderModalComposePane = () => (
    <div className={`create-modal-step-pane create-modal-step-pane-compose ${isApplyingDraft ? "create-modal-step-pane-compose-applying" : ""}`}>
      <div className="relative w-full h-full flex flex-col">
        {showDraftsPane ? (
          renderDraftsPane()
        ) : (
          <>
            <div className="create-modal-title-wrap">
              <div
                ref={modalTitleRef}
                contentEditable="true"
                suppressContentEditableWarning
                onInput={handleEditorInput}
                onKeyDown={handleModalTitleKeyDown}
                onFocus={(event) => {
                  activeEditorRef.current = event.currentTarget;
                }}
                onBlur={() => {
                  setTimeout(() => {
                    hideMenus();
                  }, 100);
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  const text = event.clipboardData.getData("text/plain");
                  document.execCommand("insertText", false, text);
                }}
                data-placeholder="title"
                role="textbox"
                aria-placeholder="title"
                className="w-full px-5 pt-5 pb-2 text-[2.1rem] font-bold leading-[1.1] focus:outline-none focus:ring-0 theme-bg theme-fg whitespace-pre-wrap break-words"
                style={{
                  wordWrap: "break-word",
                  overflowWrap: "break-word",
                  outline: "none",
                }}
              />
              <div className="create-modal-counter create-modal-title-counter">
                {modalTitleChars}/{modalTitleMaxChars}
              </div>
            </div>

            <div
              ref={modalDescriptionRef}
              contentEditable="true"
              suppressContentEditableWarning
              onInput={handleEditorInput}
              onKeyDown={handleEditorKeyDown}
              onFocus={(event) => {
                activeEditorRef.current = event.currentTarget;
              }}
              onBlur={() => {
                setTimeout(() => {
                  hideMenus();
                }, 100);
              }}
              onPaste={(event) => {
                event.preventDefault();
                const text = event.clipboardData.getData("text/plain");
                document.execCommand("insertText", false, text);
              }}
              data-placeholder="description"
              role="textbox"
              aria-placeholder="description"
              className="w-full flex-1 px-5 pt-2 pb-24 text-[1.05rem] leading-5 focus:outline-none focus:ring-0 theme-bg theme-fg whitespace-pre-wrap break-words overflow-y-auto"
              style={{
                wordWrap: "break-word",
                overflowWrap: "break-word",
                outline: "none",
                caretColor: "currentColor",
              }}
            />

            <div className="create-modal-counter create-modal-body-counter">
              {modalDescriptionChars}/{modalDescriptionMaxChars}
            </div>

            {showHashtagMenu && (
              <div
                className="fixed theme-bg border-2 theme-border rounded-lg shadow-lg z-50 min-w-48"
                style={{
                  top: `${hashtagPosition.top}px`,
                  left: `${hashtagPosition.left}px`,
                }}
              >
                <div className="p-2">
                  {Object.values(CampaignType)
                    .filter((value) => typeof value === "number")
                    .map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => handleHashtagSelect(CAMPAIGN_TYPE_LABELS[type as CampaignType])}
                        className="w-full text-left px-3 py-2 hover:opacity-80 rounded theme-fg font-medium text-sm transition-colors"
                      >
                        #{CAMPAIGN_TYPE_LABELS[type as CampaignType]}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {showMentionMenu && (
              <div
                ref={mentionMenuRef}
                className="fixed theme-bg border-2 theme-border rounded-lg shadow-lg z-50 min-w-48 max-h-40 overflow-y-auto"
                style={{
                  top: `${mentionPosition.top}px`,
                  left: `${mentionPosition.left}px`,
                }}
              >
                <div className="p-2">
                  {filteredMentions.length > 0 ? (
                    filteredMentions.map((user) => (
                      <button
                        key={user}
                        type="button"
                        onClick={() => handleMentionSelect(user)}
                        className="w-full text-left px-3 py-2 hover:opacity-80 rounded theme-fg font-medium text-sm transition-colors"
                      >
                        @{user}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-xs theme-fg opacity-60">No users found</div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {!showDraftsPane && mentions.length > 0 && (
        <div className="create-modal-mentions-row">
          {mentions.map((mention) => (
            <div
              key={mention}
              className="flex items-center gap-2 px-3 py-1 theme-border theme-fg rounded-full text-xs font-medium"
              style={{ backgroundColor: "var(--background)", opacity: 0.8 }}
            >
              <span>@{mention}</span>
              <button
                type="button"
                onClick={() => handleRemoveMention(mention)}
                className="theme-fg opacity-70 hover:opacity-100 font-bold"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="create-modal-constraints-row">
        <p className={`create-modal-constraints-text ${constraintsPassed && !showDraftsPane && !isDraftListLoading && !showNoDraftsMessage ? "create-modal-constraints-pass" : ""}`}>
          {composeHelperMessage}
        </p>
      </div>
    </div>
  );

  const renderModalReviewPane = () => (
    <div className="create-modal-step-pane create-modal-step-pane-review">
      <div className="create-review-pane-inner">
        <div className="create-review-preview-card create-review-preview-card-main">
          <p className="create-review-section-label">Preview</p>
          {trimmedModalTitle.length > 0 && <h2 className="create-review-preview-title">{trimmedModalTitle}</h2>}
          {createPreviewLines.length > 0 ? (
            <div className="create-review-preview-content">
              {createPreviewLines.map((line, index) => {
                const isQuote = /^\s*>/.test(line);

                return isQuote ? (
                  <div key={`${line}-${index}`} className="create-review-preview-quote-row">
                    {line.replace(/^\s*>\s?/, "")}
                  </div>
                ) : (
                  <p key={`${line}-${index}`} className="create-review-preview-body">
                    {line}
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="create-review-preview-body">No preview available yet.</p>
          )}
          {(firstHashtag || otherHashtags.length > 0) && (
            <div className="create-review-tag-row">
              {firstHashtag && <span className="create-review-primary-tag">#{firstHashtag}</span>}
              {otherHashtags.map((tag) => (
                <span key={tag} className="create-review-secondary-tag">#{tag}</span>
              ))}
            </div>
          )}
        </div>

        <div className="create-review-summary-card">
          <div className="flex items-center justify-between gap-3">
            <p className="create-review-section-label">Generated summary</p>
            <span className="create-review-summary-bytes">{reviewSummaryBytes}/{SUMMARY_MAX_BYTES} bytes</span>
          </div>
          <input
            type="text"
            value={activeReviewSummary}
            onChange={(event) => {
              setReviewSummary(truncateToUtf8Bytes(event.target.value, SUMMARY_MAX_BYTES));
              setErrorMsg("");
            }}
            className="create-review-summary-input theme-input"
            placeholder="Summary that will be stored on-chain"
          />
        </div>

        <div className="create-review-args-card">
          <div className="create-review-card-heading-row">
            <p className="create-review-section-label">Freight args</p>
            <span className="create-review-offchain-note">Content saved off-chain</span>
          </div>
          {renderModalArgsInputs()}
        </div>

        <div className="create-review-draft-status-row" aria-hidden="true" />
      </div>
    </div>
  );

  return (
    <div
      className={
        isModal
          ? "w-full h-full flex flex-col theme-bg"
          : "flex flex-col items-center min-h-screen gap-3 p-2 sm:p-4 max-w-2xl mx-auto theme-bg"
      }
    >
      {mode === "page" && (
        <div className="w-full flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-blue-500 underline text-sm hover:text-blue-600 font-medium">
              &lt; Back
            </Link>
            <h1 className="text-2xl sm:text-3xl font-bold theme-fg">{title}</h1>
          </div>
        </div>
      )}

      {status === "success" ? null : (
        <form onSubmit={handleSubmit} className={isModal ? "w-full h-full relative" : "w-full flex flex-col gap-3"}>
          {isModal ? (
            <>
              <div className="create-modal-step-viewport">
                <div className={`create-modal-step-track ${isReviewStep ? "create-modal-step-track-review" : ""}`}>
                  {renderModalComposePane()}
                  {renderModalReviewPane()}
                </div>
              </div>

              {activeModalError && (
                isReviewStep ? (
                  <div className="create-modal-constraints-row">
                    <p className="create-modal-constraints-text text-red-500">An Error Occurred. Hover on info for more</p>
                  </div>
                ) : (
                  <div
                    className="create-modal-error-box theme-bg border-2 border-red-500 rounded-xl flex flex-col gap-2"
                    style={{ bottom: mentions.length > 0 ? "7.6rem" : "3.2rem" }}
                  >
                    <p className="text-sm font-semibold text-red-500">Error</p>
                    <p className="text-xs text-red-600 break-all">{activeModalError}</p>
                  </div>
                )
              )}

              {(!showDraftsPane || isReviewStep) && (
                <button
                  type={isReviewStep && draftSaveStatus !== "error" && draftSaveStatus !== "saving" ? "submit" : "button"}
                  disabled={
                    isReviewStep
                      ? draftSaveStatus === "saving"
                        ? true
                        : draftSaveStatus === "error"
                          ? false
                          : isPublishDisabled
                      : isNextDisabled
                  }
                  onClick={
                    isReviewStep
                      ? draftSaveStatus === "error"
                        ? () => void handleRetryDraftSave()
                        : undefined
                      : () => void handleAdvanceToReview()
                  }
                  className={`create-modal-send-btn ${(draftSaveStatus === "saving" || status === "pending") ? "create-modal-send-btn-loading" : ""} ${(
                    isReviewStep
                      ? draftSaveStatus === "saving"
                        ? true
                        : draftSaveStatus === "error"
                          ? false
                          : isPublishDisabled
                      : isNextDisabled
                  ) ? "" : "create-modal-send-btn-active"}`.trim()}
                  aria-label={
                    isReviewStep
                      ? draftSaveStatus === "saving"
                        ? "Saving preview"
                        : draftSaveStatus === "error"
                          ? pendingPublishedRecordSync
                            ? "Retry saving published record"
                            : "Retry saving preview"
                          : status === "pending"
                            ? "Publishing"
                            : "Publish campaign"
                      : "Next"
                  }
                  title={
                    isReviewStep
                      ? draftSaveStatus === "saving"
                        ? "Saving preview..."
                        : draftSaveStatus === "error"
                          ? pendingPublishedRecordSync
                            ? "Retry saving published record"
                            : "Retry saving preview"
                          : status === "pending"
                            ? "Publishing..."
                            : "Publish campaign"
                      : "Next"
                  }
                >
                  {draftSaveStatus === "saving" || status === "pending" ? (
                    <LoaderCircle className="create-modal-send-spinner" size={40} strokeWidth={2} aria-hidden="true" />
                  ) : draftSaveStatus === "error" ? (
                    <RefreshCw size={22} strokeWidth={2} aria-hidden="true" />
                  ) : isReviewStep ? (
                    <SendHorizontal size={30} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <ArrowRight size={30} strokeWidth={2} aria-hidden="true" />
                  )}
                </button>
              )}
            </>
          ) : (
            <>
              <div className="w-full border-2 theme-border rounded-2xl overflow-hidden theme-bg transition-colors">
                <div className="theme-secondary-bg border-b-2 theme-border p-2 flex items-center gap-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => applyFormat("bold")}
                    className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-bold text-sm theme-fg"
                    title="Bold (Ctrl/Cmd+B)"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat("italic")}
                    className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors italic text-sm theme-fg"
                    title="Italic (Ctrl/Cmd+I)"
                  >
                    I
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat("underline")}
                    className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors underline text-sm theme-fg"
                    title="Underline (Ctrl/Cmd+U)"
                  >
                    U
                  </button>
                  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
                  <button
                    type="button"
                    onClick={() => applyFormat("insertUnorderedList")}
                    className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-sm theme-fg"
                    title="Bullet List"
                  >
                    • List
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat("insertOrderedList")}
                    className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-sm theme-fg"
                    title="Numbered List"
                  >
                    1. List
                  </button>
                  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
                  <button
                    type="button"
                    onClick={() => applyFormat("strikeThrough")}
                    className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors line-through text-sm theme-fg"
                    title="Strikethrough"
                  >
                    S
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat("removeFormat")}
                    className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-xs theme-fg"
                    title="Clear Formatting"
                  >
                    ✕ Clear
                  </button>
                </div>

                <div className="relative">
                  <div
                    ref={pageEditorRef}
                    contentEditable="true"
                    suppressContentEditableWarning
                    onInput={handleEditorInput}
                    onKeyDown={handleEditorKeyDown}
                    onFocus={(event) => {
                      activeEditorRef.current = event.currentTarget;
                      event.currentTarget.style.minHeight = "11rem";
                      event.currentTarget.style.maxHeight = "20rem";
                      event.currentTarget.style.height = "auto";
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        hideMenus();
                      }, 100);
                    }}
                    onPaste={(event) => {
                      event.preventDefault();
                      const text = event.clipboardData.getData("text/plain");
                      document.execCommand("insertText", false, text);
                    }}
                    data-placeholder="What's your campaign about? Type #SimpleTask, #FundedTask, #Crowdfunding, #TimedChallenge, or #Raffle first..."
                    role="textbox"
                    aria-placeholder="What's your campaign about? Type #SimpleTask, #FundedTask, #Crowdfunding, #TimedChallenge, or #Raffle first..."
                    className="w-full p-3 text-lg resize-none focus:outline-none focus:ring-0 theme-bg theme-fg min-h-44 max-h-80 overflow-y-auto whitespace-pre-wrap break-words"
                    style={{
                      wordWrap: "break-word",
                      overflowWrap: "break-word",
                      outline: "none",
                      minHeight: "11rem",
                      maxHeight: "20rem",
                    }}
                  />

                  {showHashtagMenu && (
                    <div
                      className="fixed theme-bg border-2 theme-border rounded-lg shadow-lg z-50 min-w-48"
                      style={{
                        top: `${hashtagPosition.top}px`,
                        left: `${hashtagPosition.left}px`,
                      }}
                    >
                      <div className="p-2">
                        {Object.values(CampaignType)
                          .filter((value) => typeof value === "number")
                          .map((type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => handleHashtagSelect(CAMPAIGN_TYPE_LABELS[type as CampaignType])}
                              className="w-full text-left px-3 py-2 hover:opacity-80 rounded theme-fg font-medium text-sm transition-colors"
                            >
                              #{CAMPAIGN_TYPE_LABELS[type as CampaignType]}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {showMentionMenu && (
                    <div
                      ref={mentionMenuRef}
                      className="fixed theme-bg border-2 theme-border rounded-lg shadow-lg z-50 min-w-48 max-h-40 overflow-y-auto"
                      style={{
                        top: `${mentionPosition.top}px`,
                        left: `${mentionPosition.left}px`,
                      }}
                    >
                      <div className="p-2">
                        {filteredMentions.length > 0 ? (
                          filteredMentions.map((user) => (
                            <button
                              key={user}
                              type="button"
                              onClick={() => handleMentionSelect(user)}
                              className="w-full text-left px-3 py-2 hover:opacity-80 rounded theme-fg font-medium text-sm transition-colors"
                            >
                              @{user}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-2 text-xs theme-fg opacity-60">No users found</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="theme-secondary-bg border-t-2 theme-border p-2 flex flex-col gap-3">
                  <div className="flex items-center justify-between text-xs theme-fg opacity-70">
                    <div className="flex gap-2 items-center flex-wrap">
                      {firstHashtag && (
                        <span className="px-2 py-1 bg-blue-500 text-white rounded text-xs font-semibold">#{firstHashtag}</span>
                      )}
                      {otherHashtags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-1 theme-border theme-fg rounded text-xs font-medium"
                          style={{ backgroundColor: "var(--background)", opacity: 0.6 }}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <span className="font-medium">{summaryBytes}/{CREATE_TOTAL_MAX_CHARS} chars</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold theme-fg">⏱️ Duration</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={String(durationParts.hours)}
                          onChange={(event) => handleDurationHoursChange(event.target.value)}
                          className="flex-1 px-2 py-1 text-xs border-2 theme-input rounded-lg focus:outline-none focus:border-orange-500"
                        />
                        <span className="text-xs theme-fg opacity-70 whitespace-nowrap font-medium">hrs</span>
                        <input
                          type="number"
                          min={MIN_TASK_DURATION_MINUTES}
                          max="55"
                          step={TIMING_MINUTE_STEP}
                          value={String(durationParts.minutes)}
                          onChange={(event) => handleDurationMinutesChange(event.target.value)}
                          className="flex-1 px-2 py-1 text-xs border-2 theme-input rounded-lg focus:outline-none focus:border-orange-500"
                        />
                        <span className="text-xs theme-fg opacity-70 whitespace-nowrap font-medium">min</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold theme-fg">{shouldCollectRaffleTicketPrice ? "🎟️ Number of Tickets" : "💰 Max Deposit"}</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={maxAmountCkb}
                          onChange={(event) => setMaxAmountCkb(event.target.value)}
                          className="flex-1 px-2 py-1 text-xs border-2 theme-input rounded-lg focus:outline-none focus:border-pink-500"
                        />
                        <span className="text-xs theme-fg opacity-70 whitespace-nowrap font-medium">{shouldCollectRaffleTicketPrice ? "tickets" : "CKB"}</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold theme-fg">🎁 Split Count</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={rewardCount}
                          onChange={(event) => setRewardCount(event.target.value)}
                          className="flex-1 px-2 py-1 text-xs border-2 theme-input rounded-lg focus:outline-none focus:border-emerald-500"
                        />
                        <span className="text-xs theme-fg opacity-70 whitespace-nowrap font-medium">people</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold theme-fg">💬 Social</label>
                      <div className="flex items-center justify-center gap-1 theme-bg border-2 theme-border rounded-lg px-2 py-1">
                        <span className="text-red-500 font-bold text-sm">❤️</span>
                        <span className="text-green-500 font-bold text-sm">💬</span>
                        <span className="text-orange-500 font-bold text-sm">🔄</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {mentions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide theme-fg opacity-70">Tagged Sponsors</label>
                  <div className="flex flex-wrap gap-2">
                    {mentions.map((mention) => (
                      <div
                        key={mention}
                        className="flex items-center gap-2 px-3 py-1 theme-border theme-fg rounded-full text-xs font-medium"
                        style={{ backgroundColor: "var(--background)", opacity: 0.8 }}
                      >
                        <span>@{mention}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveMention(mention)}
                          className="theme-fg opacity-70 hover:opacity-100 font-bold"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {status === "error" && (
                <div className="w-full p-3 theme-bg border-2 border-red-500 rounded-xl flex flex-col gap-2">
                  <p className="text-sm font-semibold text-red-500">Error</p>
                  <p className="text-xs text-red-600 break-all">{errorMsg}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={status === "pending" || !constraintsPassed}
                className="w-full px-6 py-3 rounded-xl theme-button font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {status === "pending" ? "Publishing..." : "Publish Campaign"}
              </button>
            </>
          )}
        </form>
      )}
    </div>
  );
});

export default CreateCampaignModalContent;
