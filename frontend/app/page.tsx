"use client";

import { ccc } from "@ckb-ccc/connector-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FREIGHT_CONTRACT } from "@/lib/contract";
import { fetchCampaigns, CampaignCell } from "@/lib/transactions";

export default function Home() {
  const { open, disconnect, client } = ccc.useCcc();
  const signer = ccc.useSigner();

  return (
    <main className="flex flex-col items-center min-h-screen gap-6 p-4 sm:p-8">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl sm:text-3xl font-bold">FreightOnNervos</h1>
          {/* DEBUG: connect wallet bypassed
          {signer ? (
            <button
              onClick={disconnect}
              className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-100 w-full sm:w-auto"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={open}
              className="px-4 py-2 rounded-full overflow-hidden font-semibold text-sm btn-wallet w-full sm:w-auto"
            >
              Connect Wallet
            </button>
          )}
          */}
          <a href="/create" className="px-4 py-2 rounded-full font-semibold text-sm btn-wallet w-full sm:w-auto text-center">
            Connect Wallet (debug)
          </a>
        </div>

        <p className="text-xs text-gray-400 font-mono break-all">
          Contract:{" "}
          <a
            href={`https://pudge.explorer.nervos.org/transaction/${FREIGHT_CONTRACT.outPoint.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {FREIGHT_CONTRACT.outPoint.txHash.slice(0, 22)}…
          </a>
        </p>

        {signer && (
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
            <ConnectedInfo signer={signer} />
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold">Campaigns</h2>
          {signer && (
            <Link
              href="/create"
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 w-full sm:w-auto"
            >
              + Create Campaign
            </Link>
          )}
        </div>

        <CampaignList client={client} />
      </div>
    </main>
  );
}

function ConnectedInfo({ signer }: { signer: ccc.Signer }) {
  const [address, setAddress] = useState<string>("");
  const [balance, setBalance] = useState<string>("");

  useEffect(() => {
    signer.getRecommendedAddress().then(setAddress);
    signer
      .getBalance()
      .then((b) => setBalance((Number(b) / 1e8).toFixed(2) + " CKB"));
  }, [signer]);

  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="font-mono text-xs text-gray-500 break-all">{address}</span>
      <span className="font-semibold">{balance || "Loading…"}</span>
    </div>
  );
}

function CampaignList({ client }: { client: ccc.Client }) {
  const [campaigns, setCampaigns] = useState<CampaignCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchCampaigns(client)
      .then(setCampaigns)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [client]);

  if (loading) {
    return <p className="text-sm text-gray-400">Loading campaigns…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  if (campaigns.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        No campaigns found on testnet yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {campaigns.map((c) => (
        <CampaignCard key={`${c.outPoint.txHash}:${c.outPoint.index}`} campaign={c} />
      ))}
    </div>
  );
}

const STATUS_LABELS = ["Created", "Active", "Completed", "Cancelled"];
const TYPE_LABELS = ["Simple Task", "Funded Task", "Crowdfunding", "Timed Challenge"];

function CampaignCard({ campaign: c }: { campaign: CampaignCell }) {
  const { data, outPoint } = c;
  const shortHash = outPoint.txHash.slice(0, 10) + "…";
  const createdAtDate = new Date(Number(data.createdAt)).toLocaleDateString();
  const maxCkb = (Number(data.maximumAmount) / 1e8).toFixed(2);
  const depositedCkb = (Number(data.currentDeposits) / 1e8).toFixed(2);

  return (
    <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-mono text-gray-400 break-all">
          <a
            href={`https://pudge.explorer.nervos.org/transaction/${outPoint.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {shortHash}
          </a>
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 w-fit">
          {STATUS_LABELS[data.status] ?? data.status}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 text-sm">
        <span className="font-medium">{TYPE_LABELS[data.campaignType] ?? data.campaignType}</span>
        <span className="text-gray-400 text-xs">Created {createdAtDate}</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-4 text-xs text-gray-500">
        <span>
          Deposits:{" "}
          <strong className="text-gray-800">
            {depositedCkb} / {maxCkb} CKB
          </strong>
        </span>
        {data.rewardCount > 0n && (
          <span>
            Reward count:{" "}
            <strong className="text-gray-800">{String(data.rewardCount)}</strong>
          </span>
        )}
      </div>
    </div>
  );
}
