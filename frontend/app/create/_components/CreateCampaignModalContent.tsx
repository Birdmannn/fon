"use client";

import { ccc } from "@ckb-ccc/connector-react";
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
const CREATE_CONSTRAINTS_MESSAGE_SUCCESS = "All contraints passed";
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
  onInfoEnter?: (target?: DOMRect) => void;
  onInfoLeave?: () => void;
  onInfoToggle?: (target?: DOMRect) => void;
  onConstraintStatusChange?: (status: CreateConstraintStatus) => void;
};

export default function CreateCampaignModalContent({
  mode,
  onRequestClose,
  resetSignal = 0,
  onInfoEnter,
  onInfoLeave,
  onInfoToggle,
  onConstraintStatusChange,
}: CreateCampaignModalContentProps) {
  const { open } = ccc.useCcc();
  const signer = ccc.useSigner();
  const pageEditorRef = useRef<HTMLDivElement>(null);
  const modalTitleRef = useRef<HTMLDivElement>(null);
  const modalDescriptionRef = useRef<HTMLDivElement>(null);
  const activeEditorRef = useRef<HTMLDivElement | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  const [campaignType, setCampaignType] = useState<CampaignType>(CampaignType.SimpleTask);
  const [summary, setSummary] = useState("");
  const [modalTitle, setModalTitle] = useState("");
  const [modalDescription, setModalDescription] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [taskDurationHours, setTaskDurationHours] = useState("24");
  const [maxAmountCkb, setMaxAmountCkb] = useState("1000");
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showHashtagMenu, setShowHashtagMenu] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [hashtagPosition, setHashtagPosition] = useState({ top: 0, left: 0 });
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [mentionQuery, setMentionQuery] = useState("");

  const isModal = mode === "modal";
  const descriptionText = isModal ? modalDescription : summary;
  const createContent = isModal ? buildCreateContent(modalTitle, modalDescription) : summary;
  const createContentChars = getTextChars(createContent);
  const trimmedModalTitle = modalTitle.trim();
  const trimmedModalDescription = modalDescription.trim();
  const onchainSummary = isModal
    ? buildOnchainSummary({ title: trimmedModalTitle, description: trimmedModalDescription })
    : buildOnchainSummary({ title: "", description: summary });
  const modalTitleChars = getTextChars(modalTitle);
  const modalDescriptionChars = getTextChars(modalDescription);
  const modalTitleMaxChars = CREATE_MODAL_TITLE_MAX_CHARS;
  const modalDescriptionMaxChars = CREATE_MODAL_BODY_MAX_CHARS;

  const hashtags = useMemo(() => {
    const matches = descriptionText.match(/#\w+/g) || [];
    return matches.map((h) => h.substring(1));
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
  const hasRequiredTitle = !isModal || modalTitle.trim().length > 0;
  const constraintsPassed = hasRequiredTitle && hasRequiredBodyLength && hasRequiredCompulsoryHashtag;

  useEffect(() => {
    if (isFirstHashtagCompulsory) {
      const typeEntry = Object.entries(CAMPAIGN_TYPE_LABELS).find(
        ([, label]) => label.toLowerCase() === normalizedFirstHashtag
      );
      if (typeEntry) {
        setCampaignType(Number(typeEntry[0]) as CampaignType);
      }
    }
  }, [isFirstHashtagCompulsory, normalizedFirstHashtag]);

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
    setShowHashtagMenu(false);
    setShowMentionMenu(false);
    setMentionQuery("");
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
  }, []);

  const handleEditorInput = (e: React.FormEvent<HTMLDivElement>) => {
    const text = e.currentTarget.textContent || "";
    let normalizedText = text.trim().length === 0 ? "" : text;

    if (isModal) {
      if (e.currentTarget === modalTitleRef.current) {
        normalizedText = truncateToTextLimit(normalizedText, CREATE_MODAL_TITLE_MAX_CHARS);
      } else if (e.currentTarget === modalDescriptionRef.current) {
        normalizedText = truncateToTextLimit(normalizedText, CREATE_MODAL_BODY_MAX_CHARS);
      }
    }

    if (e.currentTarget.textContent !== normalizedText) {
      e.currentTarget.textContent = normalizedText;
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(e.currentTarget);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    if (normalizedText.length === 0) {
      e.currentTarget.textContent = "";
    }

    activeEditorRef.current = e.currentTarget;
    setEditorTextByNode(e.currentTarget, normalizedText);

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(e.currentTarget);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const caretPos = preCaretRange.toString().length;
      const beforeCursor = normalizedText.substring(0, caretPos);

      const lastHashIndex = beforeCursor.lastIndexOf("#");
      const hashtagMatch =
        lastHashIndex !== -1 ? beforeCursor.substring(lastHashIndex + 1).match(/^[\w]*$/) : null;

      if (hashtagMatch && normalizedText[caretPos - 1] !== " " && normalizedText[caretPos - 1] !== "\n") {
        const rect = e.currentTarget.getBoundingClientRect();
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

      if (mentionMatch && normalizedText[caretPos - 1] !== " " && normalizedText[caretPos - 1] !== "\n") {
        const query = beforeCursor.substring(lastAtIndex + 1);
        setMentionQuery(query);
        const rect = e.currentTarget.getBoundingClientRect();
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

  const handleModalTitleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
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

    handleEditorKeyDown(e);
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    activeEditorRef.current = e.currentTarget;

    if (
      e.key === "Backspace" &&
      e.currentTarget === modalDescriptionRef.current &&
      (modalDescriptionRef.current?.textContent || "").trim().length === 0
    ) {
      e.preventDefault();
      const titleEl = modalTitleRef.current;
      if (titleEl) {
        const titleText = titleEl.textContent || "";
        const newTitleText = titleText.slice(0, -1);
        titleEl.textContent = newTitleText;
        setModalTitle(newTitleText);
        titleEl.focus();
        activeEditorRef.current = titleEl;
        const range = document.createRange();
        const selection = window.getSelection();
        if (titleEl.firstChild) {
          const endPos = titleEl.firstChild.textContent?.length ?? 0;
          range.setStart(titleEl.firstChild, endPos);
          range.collapse(true);
        } else {
          range.selectNodeContents(titleEl);
          range.collapse(false);
        }
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setShowHashtagMenu(false);
      setShowMentionMenu(false);
      return;
    }

    if (e.key === "Escape") {
      setShowHashtagMenu(false);
      setShowMentionMenu(false);
      e.preventDefault();
      return;
    }

    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const modKey = isMac ? e.metaKey : e.ctrlKey;

    if (modKey) {
      switch (e.key.toLowerCase()) {
        case "b":
          e.preventDefault();
          document.execCommand("bold", false);
          break;
        case "i":
          e.preventDefault();
          document.execCommand("italic", false);
          break;
        case "u":
          e.preventDefault();
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
          const sel = window.getSelection();
          if (targetEditor.firstChild) {
            newRange.setStart(targetEditor.firstChild, newPos);
            newRange.setEnd(targetEditor.firstChild, newPos);
            sel?.removeAllRanges();
            sel?.addRange(newRange);
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
          setMentions([...mentions, username]);
        }

        setTimeout(() => {
          const newPos = Math.min(lastAtIndex + username.length + 2, newText.length);
          const newRange = document.createRange();
          const sel = window.getSelection();
          if (targetEditor.firstChild) {
            newRange.setStart(targetEditor.firstChild, newPos);
            newRange.setEnd(targetEditor.firstChild, newPos);
            sel?.removeAllRanges();
            sel?.addRange(newRange);
          }
        }, 0);
      }
    }
  };

  const handleRemoveMention = (mention: string) => {
    setMentions(mentions.filter((m) => m !== mention));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (isModal && !hasRequiredTitle) {
      setErrorMsg("Please add a title");
      setStatus("error");
      return;
    }

    if (!hasRequiredBodyLength) {
      setErrorMsg(`Description must be at least ${minDescriptionChars} characters`);
      setStatus("error");
      return;
    }

    if (!isFirstHashtagCompulsory) {
      setErrorMsg("The first hashtag must be one of #SimpleTask, #FundedTask, #Crowdfunding, #TimedChallenge, or #Raffle");
      setStatus("error");
      return;
    }

    if (!hasExactlyOneCompulsoryHashtag) {
      setErrorMsg("Use exactly one compulsory hashtag (#SimpleTask, #FundedTask, #Crowdfunding, #TimedChallenge, or #Raffle)");
      setStatus("error");
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
      const taskSecs = BigInt(Math.round(parseFloat(taskDurationHours) * 3600));
      const maxCkb = BigInt(Math.round(parseFloat(maxAmountCkb)));

      const hash = await sendCreateCampaign(signer, {
        startDurationSecs: startSecs,
        taskDurationSecs: taskSecs,
        campaignType,
        maximumAmountCkb: maxCkb,
        auxAmountCkb: 0n,
        summary: onchainSummary,
      });

      setTxHash(hash);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  const summaryBytes = createContentChars;
  const title = "Create a Campaign";
  const isSubmitDisabled = status === "pending" || !constraintsPassed;

  useEffect(() => {
    if (mode === "modal") {
      resetComposer();
    }
  }, [mode, resetSignal, resetComposer]);

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
              <div className="relative w-full h-full flex flex-col">
                <div className="create-modal-title-wrap">
                  <div
                    ref={modalTitleRef}
                    contentEditable="true"
                    suppressContentEditableWarning
                    onInput={handleEditorInput}
                    onKeyDown={handleModalTitleKeyDown}
                    onFocus={(e) => {
                      activeEditorRef.current = e.currentTarget;
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setShowHashtagMenu(false);
                        setShowMentionMenu(false);
                      }, 100);
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      const text = e.clipboardData.getData("text/plain");
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
                  onFocus={(e) => {
                    activeEditorRef.current = e.currentTarget;
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      setShowHashtagMenu(false);
                      setShowMentionMenu(false);
                    }, 100);
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    const text = e.clipboardData.getData("text/plain");
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
                        .filter((v) => typeof v === "number")
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

              {/* {status === "error" && (
                <div
                  className="create-modal-error-box theme-bg border-2 border-red-500 rounded-xl flex flex-col gap-2"
                  style={{ bottom: mentions.length > 0 ? "7.6rem" : "3.2rem" }}
                >
                  <p className="text-sm font-semibold text-red-500">Error</p>
                  <p className="text-xs text-red-600 break-all">{errorMsg}</p>
                </div>
              )} */}

              <div className="create-modal-constraints-row">
                <p className={`create-modal-constraints-text ${constraintsPassed ? "create-modal-constraints-pass" : ""}`}>
                  {constraintsPassed ? CREATE_CONSTRAINTS_MESSAGE_SUCCESS : CREATE_CONSTRAINTS_MESSAGE_PENDING}
                </p>
              </div>

              <button
                type="submit"
                disabled={isSubmitDisabled}
                className={`create-modal-send-btn ${isSubmitDisabled ? "" : "create-modal-send-btn-active"}`.trim()}
                aria-label={status === "pending" ? "Publishing" : "Publish campaign"}
                title={status === "pending" ? "Publishing..." : "Publish Campaign"}
              >
                {status === "pending" ? "…" : "➤"}
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
                    onFocus={(e) => {
                      activeEditorRef.current = e.currentTarget;
                      e.currentTarget.style.minHeight = "11rem";
                      e.currentTarget.style.maxHeight = "20rem";
                      e.currentTarget.style.height = "auto";
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setShowHashtagMenu(false);
                        setShowMentionMenu(false);
                      }, 100);
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      const text = e.clipboardData.getData("text/plain");
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
                          .filter((v) => typeof v === "number")
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
                          onChange={(e) => setTaskDurationHours(e.target.value)}
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
                          onChange={(e) => setMaxAmountCkb(e.target.value)}
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
                disabled={isSubmitDisabled}
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
