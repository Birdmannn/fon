"use client";

import { Bookmark, Heart, Quote, Share2, UserRound } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { buildDefaultHandle } from "@/lib/campaignDisplay";

type CampaignComment = { text: string; creatorAddress?: string | null; creatorHandle?: string | null; createdAt?: string };
type PublicProfile = { address?: unknown; displayName?: unknown; username?: unknown };
type CommentAction = "like" | "save";

type Props = {
  comments: CampaignComment[];
  campaignId?: string | null;
  walletAddress?: string | null;
  emptyMessage?: string;
  fallbackAddress?: string;
  locked?: boolean;
  lockedMessage?: string;
  title?: string;
  variant?: "card" | "inline";
  showHeader?: boolean;
  showEmptyState?: boolean;
};

function CommentAvatar({ address, name }: { address: string; name: string }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  return (
    <span className="campaign-detail-comment-avatar" aria-label={name}>
      {address && !photoFailed ? (
        <Image src={`/api/user-profiles/photo?address=${encodeURIComponent(address)}`} alt="" fill unoptimized onError={() => setPhotoFailed(true)} />
      ) : <UserRound size={18} aria-hidden="true" />}
    </span>
  );
}

function commentAnchor(comment: CampaignComment, index: number) {
  return `comment-${(comment.createdAt ?? "").replace(/[^a-zA-Z0-9]/g, "")}-${index}`;
}

function subscribeCommentActions(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("fon-comment-actions", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("fon-comment-actions", callback);
  };
}

export default function CampaignCommentsPanel({
  comments, campaignId, walletAddress, emptyMessage = "No comments yet.",
  fallbackAddress = "0x0000000000000000000000000000000000000000",
  locked = false, lockedMessage = "Comments are locked by mounted criteria.",
  title = "Comments", variant = "card", showHeader = true, showEmptyState = true,
}: Props) {
  const router = useRouter();
  const scrolledHashRef = useRef("");
  const [profiles, setProfiles] = useState<Record<string, { displayName: string; username: string }>>({});
  const [copiedComment, setCopiedComment] = useState<string | null>(null);
  const normalizedWallet = walletAddress?.trim().toLowerCase() ?? "";
  const reactionStorageKey = `fon:comment-actions:${normalizedWallet}`;
  const reactionsRaw = useSyncExternalStore(
    subscribeCommentActions,
    () => normalizedWallet ? localStorage.getItem(reactionStorageKey) || "{}" : "{}",
    () => "{}",
  );
  const reactions = useMemo<Record<string, CommentAction[]>>(() => {
    try {
      const stored = JSON.parse(reactionsRaw);
      return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    } catch {
      return {};
    }
  }, [reactionsRaw]);
  const addresses = useMemo(() => [...new Set(comments.map((comment) => comment.creatorAddress?.trim().toLowerCase()).filter((address): address is string => Boolean(address)))], [comments]);

  useEffect(() => {
    if (addresses.length === 0) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const results = await Promise.all(Array.from({ length: Math.ceil(addresses.length / 30) }, (_, index) =>
          fetch(`/api/user-profiles?addresses=${encodeURIComponent(addresses.slice(index * 30, (index + 1) * 30).join(","))}`, {
            cache: "no-store", signal: controller.signal,
          }).then(async (response) => response.ok ? response.json() as Promise<{ profiles?: PublicProfile[] }> : { profiles: [] }),
        ));
        const next: Record<string, { displayName: string; username: string }> = {};
        for (const result of results) for (const profile of result.profiles ?? []) {
          if (typeof profile.address !== "string") continue;
          next[profile.address.trim().toLowerCase()] = {
            displayName: typeof profile.displayName === "string" ? profile.displayName.trim() : "",
            username: typeof profile.username === "string" ? profile.username.trim().replace(/\.ckb$/i, "") : "",
          };
        }
        if (!controller.signal.aborted) setProfiles(next);
      } catch {
        // Keep comments visible when profile lookup is unavailable.
      }
    };
    void load();
    return () => controller.abort();
  }, [addresses]);

  useEffect(() => {
    if (comments.length === 0 || !window.location.hash.startsWith("#comment-")) return;
    const hash = window.location.hash.slice(1);
    if (scrolledHashRef.current === hash) return;
    const anchor = decodeURIComponent(hash);
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(anchor);
      if (target) {
        target.scrollIntoView({ block: "center" });
        scrolledHashRef.current = hash;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [comments]);

  const toggleReaction = (key: string, action: CommentAction) => {
    if (!normalizedWallet) return;
    const selected = new Set(reactions[key] ?? []);
    if (selected.has(action)) selected.delete(action);
    else selected.add(action);
    const next = { ...reactions, [key]: [...selected] };
    try {
      localStorage.setItem(reactionStorageKey, JSON.stringify(next));
      window.dispatchEvent(new Event("fon-comment-actions"));
    } catch {
      // Storage may be unavailable in private browsing.
    }
  };

  const getCommentUrl = (anchor: string) => `${window.location.origin}${campaignId ? `/freight/${encodeURIComponent(campaignId)}` : window.location.pathname}#${anchor}`;
  const shareComment = async (anchor: string) => {
    try {
      await navigator.clipboard.writeText(getCommentUrl(anchor));
      setCopiedComment(anchor);
    } catch {
      setCopiedComment(null);
    }
  };
  const referenceComment = (comment: CampaignComment, author: string, handle: string, anchor: string) => {
    const quote = comment.text.split("\n").map((line) => `> ${line}`).join("\n");
    sessionStorage.setItem("freight:reference-quote", `${quote}\n\n${author} (${handle})\n${getCommentUrl(anchor)}`);
    router.push("/");
  };

  if (!locked && comments.length === 0 && !showEmptyState) return null;
  return (
    <div className={variant === "inline" ? "campaign-detail-comments-panel campaign-detail-comments-panel-inline" : "campaign-detail-comments-panel campaign-detail-card-shell campaign-detail-comments-card"}>
      {showHeader ? <div className="campaign-detail-comments-header">
        <h2 className="campaign-detail-comments-title">{title}</h2>
        <span className="campaign-detail-comments-count">{locked ? "—" : comments.length}</span>
      </div> : null}
      {locked ? <p className="campaign-detail-comments-empty">{lockedMessage}</p> : comments.length > 0 ? (
        <div className="campaign-detail-comments-list">
          {comments.map((comment, index) => {
            const address = comment.creatorAddress?.trim().toLowerCase() ?? "";
            const profile = profiles[address];
            const handle = profile?.username ? `${profile.username}.ckb` : (comment.creatorHandle ?? buildDefaultHandle(address || fallbackAddress)).replace(/^@/, "");
            const author = profile?.displayName || "Freight user";
            const key = `${campaignId ?? ""}:${address}:${comment.createdAt ?? index}:${comment.text}`;
            const anchor = commentAnchor(comment, index);
            const selected = reactions[key] ?? [];
            const date = comment.createdAt && !Number.isNaN(new Date(comment.createdAt).getTime())
              ? new Date(comment.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
            return (
              <article key={key} id={anchor} className="campaign-detail-comment-item">
                <CommentAvatar key={address} address={address} name={author} />
                <div className="campaign-detail-comment-content">
                  <div className="campaign-detail-comment-meta">
                    <span className="campaign-detail-comment-identity"><span className="campaign-detail-comment-author">{author}</span><span className="campaign-detail-comment-handle">({handle})</span></span>
                    {date ? <time className="campaign-detail-comment-date" dateTime={comment.createdAt}>{date}</time> : null}
                  </div>
                  <p className="campaign-detail-comment-text">{comment.text}</p>
                  <div className="campaign-detail-comment-actions">
                    <button type="button" onClick={() => toggleReaction(key, "like")} disabled={!normalizedWallet}
                      className={selected.includes("like") ? "campaign-detail-comment-action-active" : ""}
                      aria-label="Like comment" aria-pressed={selected.includes("like")} data-tooltip={normalizedWallet ? "Like" : "Connect wallet to like"}><Heart size={16} aria-hidden="true" /></button>
                    <button type="button" onClick={() => toggleReaction(key, "save")} disabled={!normalizedWallet}
                      className={selected.includes("save") ? "campaign-detail-comment-action-active" : ""}
                      aria-label="Save comment" aria-pressed={selected.includes("save")} data-tooltip={normalizedWallet ? "Save" : "Connect wallet to save"}><Bookmark size={16} aria-hidden="true" /></button>
                    <button type="button" onClick={() => void shareComment(anchor)} aria-label="Share comment" data-tooltip={copiedComment === anchor ? "Link copied" : "Share"}><Share2 size={16} aria-hidden="true" /></button>
                    <button type="button" onClick={() => referenceComment(comment, author, handle, anchor)} aria-label="Reference comment in new freight" data-tooltip="Reference"><Quote size={16} aria-hidden="true" /></button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : showEmptyState ? <p className="campaign-detail-comments-empty">{emptyMessage}</p> : null}
    </div>
  );
}
