"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CampaignType } from "@/lib/contract";
import { sendCreateCampaign } from "@/lib/transactions";

const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  [CampaignType.SimpleTask]: "SimpleTask",
  [CampaignType.FundedTask]: "FundedTask",
  [CampaignType.Crowdfunding]: "Crowdfunding",
  [CampaignType.TimedChallenge]: "TimedChallenge",
  [CampaignType.Raffle]: "Raffle",
};

const MOCK_USERS = ["alice", "bob", "charlie", "diana", "eve", "frank"];
const COMPULSORY_HASHTAG_SET = new Set(Object.values(CAMPAIGN_TYPE_LABELS).map((label) => label.toLowerCase()));
const CREATE_CONSTRAINTS_MESSAGE_PENDING = "Not all constraints passed, hover on info button for more";
const CREATE_MODAL_TITLE_MAX_CHARS = 30;
const CREATE_MODAL_BODY_MAX_CHARS = 250;
const CREATE_TOTAL_MAX_CHARS = 256;
const SUMMARY_MAX_BYTES = 64;
const summaryEncoder = new TextEncoder();

const getTextBytes = (text: string) => summaryEncoder.encode(text).length;
const getTextChars = (text: string) => text.length;
const buildCreateContent = (title: string, description: string) => [title, description].filter(Boolean).join("\n");
const normalizeSummarySource = (text: string) => text.replace(/\s+/g, " ").trim();

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

const buildPreviewExcerpt = (text: string, maxChars: number) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars).trimEnd()}…`;
};

export type CreateModalStep = "compose" | "review";

type DraftSaveStatus = "idle" | "saving" | "saved" | "error";
type DraftRecordStatus = "draft" | "published" | "publish_failed";

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
};

export default function CreateCampaignModalContent({
  mode,
  onRequestClose,
  resetSignal = 0,
  stepBackSignal = 0,
  onStepChange,
  onConstraintStatusChange,
  onPreviewErrorChange,
}: CreateCampaignModalContentProps) {
  const { open } = ccc.useCcc();
  const signer = ccc.useSigner();
  const pageEditorRef = useRef<HTMLDivElement>(null);
  const modalTitleRef = useRef<HTMLDivElement>(null);
  const modalDescriptionRef = useRef<HTMLDivElement>(null);
  const activeEditorRef = useRef<HTMLDivElement | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const lastHandledStepBackSignalRef = useRef(stepBackSignal);

  const [campaignType, setCampaignType] = useState<CampaignType>(CampaignType.SimpleTask);
  const [summary, setSummary] = useState("");
  const [modalTitle, setModalTitle] = useState("");
  const [modalDescription, setModalDescription] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [taskDurationHours, setTaskDurationHours] = useState("24");
  const [maxAmountCkb, setMaxAmountCkb] = useState("1000");
  const [raffleTicketPriceCkb, setRaffleTicketPriceCkb] = useState("1");
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showHashtagMenu, setShowHashtagMenu] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [hashtagPosition, setHashtagPosition] = useState({ top: 0, left: 0 });
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [mentionQuery, setMentionQuery] = useState("");
  const [modalStep, setModalStep] = useState<CreateModalStep>("compose");
  const [reviewSummary, setReviewSummary] = useState("");
  const [draftRecordId, setDraftRecordId] = useState<string | null>(null);
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>("idle");
  const [draftSaveError, setDraftSaveError] = useState("");

  const isModal = mode === "modal";
  const isReviewStep = isModal && modalStep === "review";
  const descriptionText = isModal ? modalDescription : summary;
  const createContent = isModal ? buildCreateContent(modalTitle, modalDescription) : summary;
  const createContentChars = getTextChars(createContent);
  const trimmedModalTitle = modalTitle.trim();
  const trimmedModalDescription = modalDescription.trim();
  const generatedOnchainSummary = isModal
    ? buildOnchainSummary({ title: trimmedModalTitle, description: trimmedModalDescription })
    : buildOnchainSummary({ title: "", description: summary });
  const activeReviewSummary = isModal ? reviewSummary : generatedOnchainSummary;
  const modalTitleChars = getTextChars(modalTitle);
  const modalDescriptionChars = getTextChars(modalDescription);
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
  const hasExactlyOneCompulsoryHashtag = compulsoryHashtags.length === 1;
  const hasRequiredCompulsoryHashtag = isFirstHashtagCompulsory && hasExactlyOneCompulsoryHashtag;
  const descriptionChars = descriptionText.trim().length;
  const minDescriptionChars = normalizedFirstHashtag === "raffle" ? 15 : 120;
  const hasRequiredBodyLength = descriptionChars >= minDescriptionChars;
  const hasRequiredTitle = !isModal || trimmedModalTitle.length > 0;
  const constraintsPassed = hasRequiredTitle && hasRequiredBodyLength && hasRequiredCompulsoryHashtag;
  const summaryBytes = createContentChars;
  const title = "Create a Campaign";
  const createPreviewBody = buildPreviewExcerpt(trimmedModalDescription, 220);
  const activeModalError = draftSaveError || errorMsg;
  const isNextDisabled = status === "pending" || !constraintsPassed;
  const parsedDurationHours = Number.parseFloat(taskDurationHours);
  const parsedMaxAmountCkb = Number.parseFloat(maxAmountCkb);
  const parsedRaffleTicketPriceCkb = Number.parseFloat(raffleTicketPriceCkb);
  const shouldCollectRaffleTicketPrice = normalizedFirstHashtag === "raffle";
  const hasValidReviewSummary = activeReviewSummary.trim().length > 0 && reviewSummaryBytes <= SUMMARY_MAX_BYTES;
  const hasValidDuration = Number.isFinite(parsedDurationHours) && parsedDurationHours > 0;
  const hasValidMaxAmount = Number.isFinite(parsedMaxAmountCkb) && parsedMaxAmountCkb > 0;
  const hasValidRaffleTicketPrice = !shouldCollectRaffleTicketPrice || (Number.isFinite(parsedRaffleTicketPriceCkb) && parsedRaffleTicketPriceCkb > 0);
  const isPublishDisabled =
    status === "pending" ||
    draftSaveStatus === "saving" ||
    (!draftSaveError && !hasValidReviewSummary) ||
    (!draftSaveError && !hasValidDuration) ||
    (!draftSaveError && !hasValidMaxAmount) ||
    (!draftSaveError && !hasValidRaffleTicketPrice);

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
    setTxHash("");
    setSummary("");
    setModalTitle("");
    setModalDescription("");
    setErrorMsg("");
    setMentions([]);
    setCampaignType(CampaignType.SimpleTask);
    setTaskDurationHours("24");
    setMaxAmountCkb("1000");
    setRaffleTicketPriceCkb("1");
    setModalStep("compose");
    setReviewSummary("");
    setDraftRecordId(null);
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

  const handleEditorInput = (event: React.FormEvent<HTMLDivElement>) => {
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

      if (hashtagMatch && normalizedText[updatedCaretPos - 1] !== " " && normalizedText[updatedCaretPos - 1] !== "\n") {
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

  const buildDraftPayload = async (summaryDraft: string, draftStatus: DraftRecordStatus, txHashValue: string | null, publishError: string | null) => {
    let creatorAddress: string | null = null;

    if (signer) {
      try {
        creatorAddress = await signer.getRecommendedAddress();
      } catch {
        creatorAddress = null;
      }
    }

    return {
      title: trimmedModalTitle,
      description: trimmedModalDescription,
      campaignType,
      summaryDraft,
      argsDraft: {
        taskDurationHours,
        maxAmountCkb,
        auxAmountCkb: shouldCollectRaffleTicketPrice ? raffleTicketPriceCkb : "0",
      },
      socialMetadata: {
        mentions,
        comments: [],
        likeCount: 0,
        bookmarkCount: 0,
        reshareCount: 0,
      },
      creatorAddress,
      status: draftStatus,
      txHash: txHashValue,
      publishError,
    };
  };

  const persistDraftRecord = async (
    summaryDraft: string,
    draftStatus: DraftRecordStatus,
    txHashValue: string | null = null,
    publishError: string | null = null
  ) => {
    setDraftSaveStatus("saving");
    setDraftSaveError("");

    try {
      const payload = await buildDraftPayload(summaryDraft, draftStatus, txHashValue, publishError);
      const response = await fetch(draftRecordId ? `/api/campaign-records/${draftRecordId}` : "/api/campaign-records", {
        method: draftRecordId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to save campaign record");
      }

      if (!draftRecordId && data?.id) {
        setDraftRecordId(data.id);
      }

      setDraftSaveStatus("saved");
      return data?.id ?? draftRecordId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save campaign record";
      setDraftSaveStatus("error");
      setDraftSaveError(message);
      throw error;
    }
  };

  const handleAdvanceToReview = async () => {
    if (!validateComposeConstraints()) {
      return;
    }

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
  };

  const handleRetryDraftSave = async () => {
    setStatus("idle");
    setErrorMsg("");

    try {
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

    if (draftSaveStatus === "error") {
      setErrorMsg("Please retry saving the draft before publishing");
      setStatus("error");
      return false;
    }

    if (!hasValidReviewSummary) {
      setErrorMsg("Summary must be non-empty and fit within 64 UTF-8 bytes");
      setStatus("error");
      return false;
    }

    if (!hasValidDuration) {
      setErrorMsg("Please enter a valid duration greater than 0 hours");
      setStatus("error");
      return false;
    }

    if (!hasValidMaxAmount) {
      setErrorMsg("Please enter a valid max deposit greater than 0 CKB");
      setStatus("error");
      return false;
    }

    if (!hasValidRaffleTicketPrice) {
      setErrorMsg("Please enter a valid raffle ticket price greater than 0 CKB");
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

    setStatus("pending");
    setErrorMsg("");

    try {
      const startSecs = 0n;
      const taskSecs = BigInt(Math.round(parsedDurationHours * 3600));
      const maxCkb = BigInt(Math.round(parsedMaxAmountCkb));
      const auxAmountCkb = shouldCollectRaffleTicketPrice
        ? BigInt(Math.round(parsedRaffleTicketPriceCkb))
        : 0n;
      const summaryToPublish = isModal
        ? truncateToUtf8Bytes(activeReviewSummary.trim(), SUMMARY_MAX_BYTES)
        : generatedOnchainSummary;

      const hash = await sendCreateCampaign(signer, {
        startDurationSecs: startSecs,
        taskDurationSecs: taskSecs,
        campaignType,
        maximumAmountCkb: maxCkb,
        auxAmountCkb,
        summary: summaryToPublish,
      });

      if (isModal && draftRecordId) {
        try {
          await persistDraftRecord(summaryToPublish, "published", hash, null);
        } catch {
          // Keep the publish success state even if the off-chain patch fails.
        }
      }

      setTxHash(hash);
      setStatus("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isModal && draftRecordId) {
        try {
          await persistDraftRecord(activeReviewSummary.trim(), "publish_failed", null, message);
        } catch {
          // Preserve the original publish failure message.
        }
      }

      setErrorMsg(message);
      setStatus("error");
    }
  }

  const renderModalArgsInputs = () => (
    <div className="create-review-args-grid">
      <div className="create-review-arg-field">
        <label className="create-review-arg-label">Duration</label>
        <div className="create-review-arg-control">
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={taskDurationHours}
            onChange={(event) => setTaskDurationHours(event.target.value)}
            className="create-review-arg-input"
          />
          <span className="create-review-arg-unit">hrs</span>
        </div>
      </div>

      <div className="create-review-arg-field">
        <label className="create-review-arg-label">Max deposit</label>
        <div className="create-review-arg-control">
          <input
            type="number"
            min="1"
            step="1"
            value={maxAmountCkb}
            onChange={(event) => setMaxAmountCkb(event.target.value)}
            className="create-review-arg-input"
          />
          <span className="create-review-arg-unit">CKB</span>
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

  const renderModalComposePane = () => (
    <div className="create-modal-step-pane create-modal-step-pane-compose">
      <div className="relative w-full h-full flex flex-col">
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
      </div>

      {mentions.length > 0 && (
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
        <p className={`create-modal-constraints-text ${constraintsPassed ? "create-modal-constraints-pass" : ""}`}>
          {!constraintsPassed && CREATE_CONSTRAINTS_MESSAGE_PENDING}
        </p>
      </div>
    </div>
  );

  const renderModalReviewPane = () => (
    <div className="create-modal-step-pane create-modal-step-pane-review">
      <div className="create-review-pane-inner">
        <div className="create-review-preview-card">
          <p className="create-review-section-label">Preview</p>
          {trimmedModalTitle.length > 0 && <h2 className="create-review-preview-title">{trimmedModalTitle}</h2>}
          <p className="create-review-preview-body">{createPreviewBody || "No preview available yet."}</p>
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
          <textarea
            value={activeReviewSummary}
            onChange={(event) => {
              setReviewSummary(truncateToUtf8Bytes(event.target.value, SUMMARY_MAX_BYTES));
              setErrorMsg("");
            }}
            rows={4}
            className="create-review-summary-input theme-input"
            placeholder="Summary that will be stored on-chain"
          />
        </div>

        <div className="create-review-args-card">
          <div className="create-review-card-heading-row">
            <p className="create-review-section-label">Campaign args</p>
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

      {status === "success" ? (
        <div
          className={
            isModal
              ? "w-full h-full p-4 flex flex-col justify-center gap-3"
              : "w-full p-3 theme-bg border-2 border-green-500 rounded-xl flex flex-col gap-2"
          }
        >
          <div className="flex items-center gap-2">
            <span className="text-2xl">✓</span>
            <p className="font-semibold text-green-600">Campaign published!</p>
          </div>
          <p className="text-xs font-mono break-all text-gray-600">
            TX:{" "}
            <a
              href={`https://pudge.explorer.nervos.org/transaction/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 underline hover:text-blue-600"
            >
              {txHash}
            </a>
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={resetComposer}
              className="mt-1 text-sm text-blue-500 underline font-medium hover:text-blue-600 self-start"
            >
              Create another campaign
            </button>
            {mode === "modal" && onRequestClose && (
              <button
                type="button"
                onClick={onRequestClose}
                className="mt-1 text-sm text-blue-500 underline font-medium hover:text-blue-600 self-start"
              >
                Close
              </button>
            )}
          </div>
        </div>
      ) : (
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
                className={`create-modal-send-btn ${(
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
                        ? "Retry saving preview"
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
                        ? "Retry saving preview"
                        : status === "pending"
                          ? "Publishing..."
                          : "Publish campaign"
                    : "Next"
                }
              >
                {draftSaveStatus === "saving" ? (
                  <LoaderCircle className="create-modal-send-spinner" size={44} strokeWidth={2.2} aria-hidden="true" />
                ) : draftSaveStatus === "error" ? (
                  <RefreshCw size={22} strokeWidth={2} aria-hidden="true" />
                ) : status === "pending" ? "…" : "➤"}
              </button>
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
                          min="0.5"
                          step="0.5"
                          value={taskDurationHours}
                          onChange={(event) => setTaskDurationHours(event.target.value)}
                          className="flex-1 px-2 py-1 text-xs border-2 theme-input rounded-lg focus:outline-none focus:border-orange-500"
                        />
                        <span className="text-xs theme-fg opacity-70 whitespace-nowrap font-medium">hrs</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold theme-fg">💰 Max Deposit</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={maxAmountCkb}
                          onChange={(event) => setMaxAmountCkb(event.target.value)}
                          className="flex-1 px-2 py-1 text-xs border-2 theme-input rounded-lg focus:outline-none focus:border-pink-500"
                        />
                        <span className="text-xs theme-fg opacity-70 whitespace-nowrap font-medium">CKB</span>
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
}
