"use client";

import { ccc } from "@ckb-ccc/connector-react";
import Link from "next/link";
import { useState } from "react";
import { CampaignType } from "@/lib/contract";
import { sendCreateCampaign } from "@/lib/transactions";

const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  [CampaignType.SimpleTask]: "Simple Task",
  [CampaignType.FundedTask]: "Funded Task",
  [CampaignType.Crowdfunding]: "Crowdfunding",
  [CampaignType.TimedChallenge]: "Timed Challenge",
};

export default function CreateCampaignPage() {
  const signer = ccc.useSigner();

  const [startDelayHours, setStartDelayHours] = useState("0");
  const [taskDurationHours, setTaskDurationHours] = useState("24");
  const [campaignType, setCampaignType] = useState<CampaignType>(CampaignType.SimpleTask);
  const [maxAmountCkb, setMaxAmountCkb] = useState("1000");
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!signer) return;

    setStatus("pending");
    setErrorMsg("");

    try {
      const startSecs = BigInt(Math.round(parseFloat(startDelayHours) * 3600));
      const taskSecs = BigInt(Math.round(parseFloat(taskDurationHours) * 3600));
      const maxCkb = BigInt(Math.round(parseFloat(maxAmountCkb)));

      const hash = await sendCreateCampaign(signer, {
        startDurationSecs: startSecs,
        taskDurationSecs: taskSecs,
        campaignType,
        maximumAmountCkb: maxCkb,
      });

      setTxHash(hash);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  if (!signer) {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
        <p className="text-gray-500">Connect your wallet first.</p>
        <Link href="/" className="text-blue-600 underline text-sm">
          ← Back to home
        </Link>
      </main>
    );
  }

  return (
    <main className="flex flex-col items-center min-h-screen gap-6 p-8 max-w-lg mx-auto">
      <div className="w-full flex items-center gap-4">
        <Link href="/" className="text-blue-600 underline text-sm">
          ← Back
        </Link>
        <h1 className="text-2xl font-bold">Create Campaign</h1>
      </div>

      {status === "success" ? (
        <div className="w-full p-4 bg-green-50 border border-green-200 rounded-lg flex flex-col gap-2">
          <p className="font-semibold text-green-800">Campaign created!</p>
          <p className="text-xs font-mono break-all text-green-700">
            TX:{" "}
            <a
              href={`https://pudge.explorer.nervos.org/transaction/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {txHash}
            </a>
          </p>
          <button
            onClick={() => { setStatus("idle"); setTxHash(""); }}
            className="mt-2 text-sm text-blue-600 underline self-start"
          >
            Create another
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Campaign Type</span>
            <select
              value={campaignType}
              onChange={(e) => setCampaignType(Number(e.target.value) as CampaignType)}
              className="border border-gray-300 rounded px-3 py-2 text-sm"
            >
              {(Object.values(CampaignType).filter((v) => typeof v === "number") as CampaignType[]).map(
                (t) => (
                  <option key={t} value={t}>
                    {CAMPAIGN_TYPE_LABELS[t]}
                  </option>
                )
              )}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Start Delay (hours)</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={startDelayHours}
              onChange={(e) => setStartDelayHours(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm"
              required
            />
            <span className="text-xs text-gray-500">
              How long after creation before the campaign starts accepting participants.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Task Duration (hours)</span>
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={taskDurationHours}
              onChange={(e) => setTaskDurationHours(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm"
              required
            />
            <span className="text-xs text-gray-500">
              How long the campaign runs once started.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Maximum Deposit (CKB)</span>
            <input
              type="number"
              min="1"
              step="1"
              value={maxAmountCkb}
              onChange={(e) => setMaxAmountCkb(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm"
              required
            />
            <span className="text-xs text-gray-500">
              Maximum total CKB that can be deposited into this campaign.
            </span>
          </label>

          {status === "error" && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3 break-all">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={status === "pending"}
            className="px-6 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === "pending" ? "Submitting…" : "Create Campaign"}
          </button>
        </form>
      )}
    </main>
  );
}
