"use client";

import { ccc } from "@ckb-ccc/connector-react";
import Link from "next/link";
import { useState, useRef, useMemo } from "react";
import { CampaignType } from "@/lib/contract";
import { sendCreateCampaign } from "@/lib/transactions";

const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  [CampaignType.SimpleTask]: "SimpleTask",
  [CampaignType.FundedTask]: "FundedTask",
  [CampaignType.Crowdfunding]: "Crowdfunding",
  [CampaignType.TimedChallenge]: "TimedChallenge",
  [CampaignType.Raffle]: "Raffle",
};

// TODO: Integrate with user database for real usernames and addresses
const MOCK_USERS = ["alice", "bob", "charlie", "diana", "eve", "frank"];

export default function CreateCampaignPage() {
  const signer = ccc.useSigner();
  const editorRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  const [campaignType, setCampaignType] = useState<CampaignType>(CampaignType.SimpleTask);
  const [summary, setSummary] = useState("");
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

  // Extract hashtags from summary
  const hashtags = useMemo(() => {
    const matches = summary.match(/#\w+/g) || [];
    return matches.map((h) => h.substring(1));
  }, [summary]);

  const firstHashtag = hashtags[0];
  const otherHashtags = hashtags.slice(1);

  // Auto-detect campaign type from first hashtag
  useMemo(() => {
    if (firstHashtag) {
      const typeEntry = Object.entries(CAMPAIGN_TYPE_LABELS).find(
        ([_, label]) => label.toLowerCase() === firstHashtag.toLowerCase()
      );
      if (typeEntry) {
        setCampaignType(Number(typeEntry[0]) as CampaignType);
      }
    }
  }, [firstHashtag]);

  const filteredMentions = MOCK_USERS.filter((user) =>
    user.toLowerCase().startsWith(mentionQuery.toLowerCase()) && mentionQuery.length > 0
  );

  const handleEditorInput = (e: React.FormEvent<HTMLDivElement>) => {
    const text = e.currentTarget.textContent || "";
    const html = e.currentTarget.innerHTML || "";
    setSummary(text);

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(e.currentTarget);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const caretPos = preCaretRange.toString().length;
      const beforeCursor = text.substring(0, caretPos);

      // Check for hashtag trigger (# followed by word chars)
      const lastHashIndex = beforeCursor.lastIndexOf("#");
      const hashtagMatch = lastHashIndex !== -1 ? beforeCursor.substring(lastHashIndex + 1).match(/^[\w]*$/) : null;

      if (hashtagMatch && text[caretPos - 1] !== " " && text[caretPos - 1] !== "\n") {
        const rect = editorRef.current?.getBoundingClientRect();
        if (rect) {
          setHashtagPosition({
            top: rect.top + rect.height,
            left: rect.left,
          });
          setShowHashtagMenu(true);
        }
      } else {
        setShowHashtagMenu(false);
      }

      // Check for mention trigger (@ followed by word chars)
      const lastAtIndex = beforeCursor.lastIndexOf("@");
      const mentionMatch = lastAtIndex !== -1 ? beforeCursor.substring(lastAtIndex + 1).match(/^[\w]*$/) : null;

      if (mentionMatch && text[caretPos - 1] !== " " && text[caretPos - 1] !== "\n") {
        const query = beforeCursor.substring(lastAtIndex + 1);
        setMentionQuery(query);
        const rect = editorRef.current?.getBoundingClientRect();
        if (rect) {
          setMentionPosition({
            top: rect.top + rect.height,
            left: rect.left,
          });
          setShowMentionMenu(true);
        }
      } else {
        setShowMentionMenu(false);
      }
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Close menus on Escape
    if (e.key === "Escape") {
      setShowHashtagMenu(false);
      setShowMentionMenu(false);
      e.preventDefault();
      return;
    }

    // Handle keyboard shortcuts for formatting
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modKey = isMac ? e.metaKey : e.ctrlKey;

    if (modKey) {
      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          document.execCommand('bold', false);
          break;
        case 'i':
          e.preventDefault();
          document.execCommand('italic', false);
          break;
        case 'u':
          e.preventDefault();
          document.execCommand('underline', false);
          break;
      }
    }
  };

  const applyFormat = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const handleHashtagSelect = (label: string) => {
    if (editorRef.current) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const text = editorRef.current.textContent || "";
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(editorRef.current);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        const caretPos = preCaretRange.toString().length;

        const lastHashIndex = text.lastIndexOf("#", caretPos - 1);
        if (lastHashIndex !== -1) {
          const newText = text.substring(0, lastHashIndex) + `#${label} ` + text.substring(caretPos);
          editorRef.current.textContent = newText;
          setSummary(newText);
          setShowHashtagMenu(false);

          // Move cursor after the inserted hashtag
          setTimeout(() => {
            if (editorRef.current) {
              const newPos = lastHashIndex + label.length + 2;
              const range = document.createRange();
              const sel = window.getSelection();
              if (editorRef.current.firstChild) {
                range.setStart(editorRef.current.firstChild, Math.min(newPos, newText.length));
                range.setEnd(editorRef.current.firstChild, Math.min(newPos, newText.length));
                sel?.removeAllRanges();
                sel?.addRange(range);
              }
            }
          }, 0);
        }
      }
    }
  };

  const handleMentionSelect = (username: string) => {
    if (editorRef.current) {
      const text = editorRef.current.textContent || "";
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(editorRef.current);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        const caretPos = preCaretRange.toString().length;

        const lastAtIndex = text.lastIndexOf("@", caretPos - 1);
        if (lastAtIndex !== -1) {
          const newText = text.substring(0, lastAtIndex) + `@${username} ` + text.substring(caretPos);
          editorRef.current.textContent = newText;
          setSummary(newText);
          setShowMentionMenu(false);

          if (!mentions.includes(username)) {
            setMentions([...mentions, username]);
          }

          // Move cursor after the inserted mention
          setTimeout(() => {
            if (editorRef.current) {
              const newPos = lastAtIndex + username.length + 2;
              const range = document.createRange();
              const sel = window.getSelection();
              if (editorRef.current.firstChild) {
                range.setStart(editorRef.current.firstChild, Math.min(newPos, newText.length));
                range.setEnd(editorRef.current.firstChild, Math.min(newPos, newText.length));
                sel?.removeAllRanges();
                sel?.addRange(range);
              }
            }
          }, 0);
        }
      }
    }
  };

  const handleRemoveMention = (mention: string) => {
    setMentions(mentions.filter((m) => m !== mention));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!summary.trim()) {
      setErrorMsg("Please add a description");
      setStatus("error");
      return;
    }

    if (!firstHashtag) {
      setErrorMsg("Please add a campaign type hashtag (e.g., #SimpleTask, #Raffle, etc.)");
      setStatus("error");
      return;
    }

    if (!signer) {
      setErrorMsg("Wallet not connected. Please connect your wallet to submit.");
      setStatus("error");
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
        summary,
      });

      setTxHash(hash);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  const summaryBytes = new TextEncoder().encode(summary).length;

  return (
    <main className="flex flex-col items-center min-h-screen gap-3 p-2 sm:p-4 max-w-2xl mx-auto theme-bg">
      {/* Header */}
      <div className="w-full flex items-center gap-3">
        <Link href="/" className="text-blue-500 underline text-sm hover:text-blue-600 font-medium">
          &lt; Back
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold theme-fg">Create a Campaign</h1>
      </div>

      {status === "success" ? (
        <div className="w-full p-3 theme-bg border-2 border-green-500 rounded-xl flex flex-col gap-2">
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
          <button
            onClick={() => {
              setStatus("idle");
              setTxHash("");
              setSummary("");
              setMentions([]);
              setCampaignType(CampaignType.SimpleTask);
              if (editorRef.current) editorRef.current.textContent = "";
            }}
            className="mt-1 text-sm text-blue-500 underline font-medium hover:text-blue-600 self-start"
          >
            Create another campaign
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
          {/* Main Description Box */}
          <div className="w-full border-2 theme-border rounded-2xl overflow-hidden theme-bg transition-colors">
            {/* Formatting Toolbar */}
            <div className="theme-secondary-bg border-b-2 theme-border p-2 flex items-center gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => applyFormat('bold')}
                className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-bold text-sm theme-fg"
                title="Bold (Ctrl/Cmd+B)"
              >
                B
              </button>
              <button
                type="button"
                onClick={() => applyFormat('italic')}
                className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors italic text-sm theme-fg"
                title="Italic (Ctrl/Cmd+I)"
              >
                I
              </button>
              <button
                type="button"
                onClick={() => applyFormat('underline')}
                className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors underline text-sm theme-fg"
                title="Underline (Ctrl/Cmd+U)"
              >
                U
              </button>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1"></div>
              <button
                type="button"
                onClick={() => applyFormat('insertUnorderedList')}
                className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-sm theme-fg"
                title="Bullet List"
              >
                • List
              </button>
              <button
                type="button"
                onClick={() => applyFormat('insertOrderedList')}
                className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-sm theme-fg"
                title="Numbered List"
              >
                1. List
              </button>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1"></div>
              <button
                type="button"
                onClick={() => applyFormat('strikeThrough')}
                className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors line-through text-sm theme-fg"
                title="Strikethrough"
              >
                S
              </button>
              <button
                type="button"
                onClick={() => applyFormat('removeFormat')}
                className="px-3 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-xs theme-fg"
                title="Clear Formatting"
              >
                ✕ Clear
              </button>
            </div>

            {/* Rich Text Editor */}
            <div className="relative">
              <div
                ref={editorRef}
                contentEditable="true"
                suppressContentEditableWarning
                onInput={handleEditorInput}
                onKeyDown={handleEditorKeyDown}
                onFocus={(e) => {
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
                  // Allow paste to work naturally
                  e.preventDefault();
                  const text = e.clipboardData.getData("text/plain");
                  document.execCommand("insertText", false, text);
                }}
                placeholder="What's your campaign about? Type #SimpleTask, #FundedTask, #Crowdfunding, #TimedChallenge, or #Raffle first..."
                className="w-full p-3 text-lg resize-none focus:outline-none focus:ring-0 theme-bg theme-fg min-h-44 max-h-80 overflow-y-auto whitespace-pre-wrap break-words"
                style={{
                  wordWrap: "break-word",
                  overflowWrap: "break-word",
                  outline: "none",
                  minHeight: "11rem",
                  maxHeight: "20rem",
                }}
              />

              {/* Hashtag Popup Menu */}
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

              {/* Mention Popup Menu */}
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

            {/* Bottom Toolbar */}
            <div className="theme-secondary-bg border-t-2 theme-border p-2 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs theme-fg opacity-70">
                <div className="flex gap-2 items-center flex-wrap">
                  {firstHashtag && (
                    <span className="px-2 py-1 bg-blue-500 text-white rounded text-xs font-semibold">
                      #{firstHashtag}
                    </span>
                  )}
                  {otherHashtags.map((tag) => (
                    <span key={tag} className="px-2 py-1 theme-border theme-fg rounded text-xs font-medium" style={{backgroundColor: 'var(--background)', opacity: 0.6}}>
                      #{tag}
                    </span>
                  ))}
                </div>
                <span className="font-medium">{summaryBytes}/256 chars</span>
              </div>

              {/* Metrics Row */}
              <div className="grid grid-cols-3 gap-2">
                {/* Duration */}
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

                {/* Max Deposit */}
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

                {/* Engagement */}
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

          {/* Mentions Display */}
          {mentions.length > 0 && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide theme-fg opacity-70">Tagged Sponsors</label>
              <div className="flex flex-wrap gap-2">
                {mentions.map((mention) => (
                  <div
                    key={mention}
                    className="flex items-center gap-2 px-3 py-1 theme-border theme-fg rounded-full text-xs font-medium"
                    style={{backgroundColor: 'var(--background)', opacity: 0.8}}
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

          {/* Error Message */}
          {status === "error" && (
            <div className="w-full p-3 theme-bg border-2 border-red-500 rounded-xl flex flex-col gap-2">
              <p className="text-sm font-semibold text-red-500">Error</p>
              <p className="text-xs text-red-600 break-all">{errorMsg}</p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={status === "pending" || !summary.trim()}
            className="w-full px-6 py-3 rounded-xl theme-button font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {status === "pending" ? "Publishing..." : "Publish Campaign"}
          </button>
        </form>
      )}
    </main>
  );
}
