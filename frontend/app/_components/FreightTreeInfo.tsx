"use client";

import { GitBranch, Link2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type FreightNode = {
  campaignId: string;
  parentCampaignId?: string | null;
  title?: string;
  description?: string;
  creatorAddress?: string;
  depth?: number;
};

type FreightTree = {
  currentCampaignId: string;
  requiresLinkedFreight: boolean;
  nodes: FreightNode[];
  linked: FreightNode[];
  linkedFrom: FreightNode[];
};

type FreightTreeMode = "parent" | "child" | "linked" | "view" | null;

function parseFreightId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/(?:freight|campaign)\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]).toLowerCase() : trimmed.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

export default function FreightTreeInfo({ campaignId, mode, walletAddress, isCreator, signAction }: {
  campaignId: string;
  mode: FreightTreeMode;
  walletAddress: string | null;
  isCreator: boolean;
  signAction: (purpose: string) => Promise<{ address: string; nonce: string; nonceSignature: { signature: string; identity: string; signType: string } }>;
}) {
  const [tree, setTree] = useState<FreightTree | null>(null);
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch(`/api/freights/tree?campaignId=${encodeURIComponent(campaignId)}`, { cache: "no-store" });
    const payload = await response.json() as FreightTree & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load freight tree");
    setTree(payload);
  }, [campaignId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load freight tree");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mode || mode === "view" || busy) return;
    const otherCampaignId = parseFreightId(target);
    if (!otherCampaignId || otherCampaignId === campaignId.toLowerCase()) {
      setError("Choose a different published freight");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const signed = await signAction("freight-tree");
      const response = await fetch("/api/freights/tree", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signed, campaignId, otherCampaignId, relation: mode }),
      });
      const payload = await response.json() as FreightTree & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to update freight tree");
      setTree(payload);
      setTarget("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update freight tree");
    } finally {
      setBusy(false);
    }
  };

  const toggleRequirement = async () => {
    if (!tree || busy) return;
    setBusy(true);
    setError("");
    try {
      const signed = await signAction("freight-tree");
      const response = await fetch("/api/freights/tree", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signed, campaignId, relation: "require-linked", required: !tree.requiresLinkedFreight }),
      });
      const payload = await response.json() as FreightTree & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to update requirement");
      setTree(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update requirement");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="create-info-constraints-copy">
      {mode === "view" && loading ? <p className="create-info-constraint-item text-gray-500">Loading...</p> : null}
      {mode === "view" && tree?.nodes.map((node) => (
        <a key={node.campaignId} href={`/freight/${encodeURIComponent(node.campaignId)}`}
          className={`flex items-start gap-2 py-1 text-sm ${node.campaignId === campaignId ? "text-purple-700" : "text-gray-700 hover:underline"}`}
          style={{ paddingLeft: `${Math.min(node.depth ?? 0, 8) * 18}px` }}>
          <GitBranch size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{node.title?.trim() || node.campaignId}</span>
        </a>
      ))}
      {mode === "view" && tree && tree.nodes.length === 1 ? <p className="create-info-constraint-item text-gray-500">No parent or child freight yet.</p> : null}
      {mode === "view" && tree?.linked.length ? (
        <div className="mt-3">
          <p className="create-review-section-label text-gray-900">Linked freights:</p>
          {tree.linked.map((node) => (
            <a key={node.campaignId} href={`/freight/${encodeURIComponent(node.campaignId)}`} className="flex items-center gap-2 py-1 text-sm text-gray-700 hover:underline">
              <Link2 size={15} aria-hidden="true" /> {node.title?.trim() || node.campaignId}
            </a>
          ))}
        </div>
      ) : null}
      {mode === "view" && tree?.linkedFrom.length ? (
        <div className="mt-3">
          <p className="create-review-section-label text-gray-900">Linked from:</p>
          {tree.linkedFrom.map((node) => (
            <a key={node.campaignId} href={`/freight/${encodeURIComponent(node.campaignId)}`} className="flex items-center gap-2 py-1 text-sm text-gray-700 hover:underline">
              <Link2 size={15} aria-hidden="true" /> {node.title?.trim() || node.campaignId}
            </a>
          ))}
        </div>
      ) : null}
      {mode === "view" && isCreator && tree ? (
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={tree.requiresLinkedFreight} disabled={busy}
            onChange={() => void toggleRequirement()} />
          Require each participant to create a linked freight
        </label>
      ) : null}
      {mode && mode !== "view" ? (
        <form onSubmit={(event) => void submit(event)} className="mt-3 flex flex-col gap-2">
          <label htmlFor="freight-tree-target" className="create-review-section-label text-gray-900">
            {mode === "parent" ? "Parent freight:" : mode === "child" ? "Child freight:" : "Linked freight:"}
          </label>
          <input id="freight-tree-target" className="create-info-ticket-input w-full" value={target}
            onChange={(event) => { setTarget(event.target.value); setError(""); }} placeholder="Freight link or ID" disabled={busy} />
          <button type="submit" className="create-info-confirm-btn create-info-confirm-btn-primary self-start" disabled={busy || !target.trim() || !walletAddress}>
            {busy ? "Adding..." : "Add freight"}
          </button>
        </form>
      ) : null}
      {error ? <p role="alert" className="create-info-constraint-item text-red-500">{error}</p> : null}
    </div>
  );
}
