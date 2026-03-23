"use client";

import { ccc } from "@ckb-ccc/connector-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FREIGHT_CONTRACT } from "@/lib/contract";
import { fetchCampaigns, sendDeposit, CampaignCell } from "@/lib/transactions";

export default function Home() {
  const { open, disconnect, client } = ccc.useCcc();
  const signer = ccc.useSigner();

  return (
    <main className="flex flex-col items-center min-h-screen gap-6 p-4 sm:p-8">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl sm:text-3xl font-bold">FreightOnNervos</h1>
          {/* DEBUG: connect wallet bypassed */}
          {signer ? (
            <button
              onClick={disconnect}
              className="px-4 py-2 rounded-full overflow-hidden font-semibold text-sm btn-wallet w-full sm:w-auto"
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
         
          {/* <a href="/create" className="px-4 py-2 rounded-full font-semibold text-sm btn-wallet w-full sm:w-auto text-center">
            Connect Wallet (debug)
          </a> */}
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
        </div>

        <CampaignList client={client} />
      </div>

      {signer && (
        <Link
          href="/create"
          className="fixed left-8 create-campaign-fab"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          >
            <line x1="24" y1="8" x2="24" y2="40" />
            <line x1="8" y1="24" x2="40" y2="24" />
          </svg>
        </Link>
      )}
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

  const refresh = () => {
    setLoading(true);
    fetchCampaigns(client)
      .then(setCampaigns)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <CampaignCard key={`${c.outPoint.txHash}:${c.outPoint.index}`} campaign={c} onDepositSuccess={refresh} />
      ))}
    </div>
  );
}

const STATUS_LABELS = ["Created", "Active", "Completed", "Cancelled"];
const TYPE_LABELS = ["Simple Task", "Funded Task", "Crowdfunding", "Timed Challenge"];

function CampaignCard({ campaign: c, onDepositSuccess }: { campaign: CampaignCell; onDepositSuccess: () => void }) {
  const { data, outPoint } = c;
  const signer = ccc.useSigner();
  const shortHash = outPoint.txHash.slice(0, 10) + "…";
  const createdAtDate = new Date(Number(data.createdAt)).toLocaleDateString();
  const maxCkb = (Number(data.maximumAmount) / 1e8).toFixed(2);
  const depositedCkb = (Number(data.currentDeposits) / 1e8).toFixed(2);

  // Action state
  const [likes, setLikes] = useState(0);
  const [bookmarks, setBookmarks] = useState(0);
  const [comments, setComments] = useState(0);
  const [reshares, setReshares] = useState(0);
  const [userLiked, setUserLiked] = useState(false);
  const [userBookmarked, setUserBookmarked] = useState(false);
  const [userCommented, setUserCommented] = useState(false);
  const [userReshared, setUserReshared] = useState(false);

  // Deposit modal state
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);

  const isConnected = !!signer;

  const handleLike = () => {
    if (!isConnected) return;
    setUserLiked(!userLiked);
    setLikes((prev) => (userLiked ? prev - 1 : prev + 1));
  };

  const handleBookmark = () => {
    if (!isConnected) return;
    setUserBookmarked(!userBookmarked);
    setBookmarks((prev) => (userBookmarked ? prev - 1 : prev + 1));
  };

  const handleComment = () => {
    if (!isConnected) return;
    setUserCommented(!userCommented);
    setComments((prev) => (userCommented ? prev - 1 : prev + 1));
  };

  const handleReshare = () => {
    if (!isConnected) return;
    setUserReshared(!userReshared);
    setReshares((prev) => (userReshared ? prev - 1 : prev + 1));
  };

  const handleDepositClick = () => {
    if (!isConnected) return;
    setShowDepositModal(true);
  };

  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signer || !depositAmount) return;

    const amount = BigInt(Math.floor(parseFloat(depositAmount) * 100_000_000));
    if (amount <= 0n) {
      alert("Please enter a valid amount");
      return;
    }

    const maxAmount = data.maximumAmount - data.currentDeposits;
    if (amount > maxAmount) {
      alert(`Maximum deposit available: ${(Number(maxAmount) / 1e8).toFixed(2)} CKB`);
      return;
    }

    setIsDepositing(true);
    try {
      const txHash = await sendDeposit(signer, c, BigInt(Math.floor(parseFloat(depositAmount))));
      alert(`Deposit sent! Tx: ${txHash}`);
      setShowDepositModal(false);
      setDepositAmount("");
      // Wait a couple seconds for the indexer to pick up the new cell, then refresh
      setTimeout(onDepositSuccess, 3000);
    } catch (error) {
      alert(`Deposit failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDepositing(false);
    }
  };

  return (
    <div className="flex flex-col gap-0">
      <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-4">
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
        {data.rewardCount > 0n && (
          <span>
            Reward count:{" "}
            <strong className="text-gray-800">{String(data.rewardCount)}</strong>
          </span>
        )}
      </div>
      </div>

      {/* Campaign Actions */}
      <div className="flex items-center gap-2 pt-2 pb-3 text-xs">
        <button
          onClick={handleLike}
          className={`campaign-action-btn ${userLiked ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
          data-tooltip={!isConnected ? "Connect wallet to like" : "Like"}
        >
          <svg
            className="campaign-action-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <span className="campaign-action-count">{likes}</span>
        </button>

        <button
          onClick={handleBookmark}
          className={`campaign-action-btn ${userBookmarked ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
          data-tooltip={!isConnected ? "Connect wallet to bookmark" : "Bookmark"}
        >
          <svg
            className="campaign-action-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          <span className="campaign-action-count">{bookmarks}</span>
        </button>

        <button
          onClick={handleComment}
          className={`campaign-action-btn ${userCommented ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
          data-tooltip={!isConnected ? "Connect wallet to comment" : "Comment"}
        >
          <svg
            className="campaign-action-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="campaign-action-count">{comments}</span>
        </button>

        <button
          onClick={handleReshare}
          className={`campaign-action-btn ${userReshared ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
          data-tooltip={!isConnected ? "Connect wallet to reshare" : "Reshare"}
        >
          <svg
            className="campaign-action-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M1 4v6h6M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64M3.51 15A9 9 0 0 0 18.36 18.36" />
          </svg>
          <span className="campaign-action-count">{reshares}</span>
        </button>

        <button
          onClick={handleDepositClick}
          className={`campaign-action-btn ml-auto ${!isConnected ? "campaign-action-disabled" : ""}`}
          data-tooltip={!isConnected ? "Connect wallet to deposit" : "Deposit CKB"}
        >
          <svg
            className="campaign-action-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 1v22M17 5H9a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />
          </svg>
          <span className="campaign-action-count font-mono">{depositedCkb} / {maxCkb} CKB</span>
        </button>
      </div>

      {/* Deposit Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-4">Deposit CKB</h3>
            <form onSubmit={handleDepositSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Amount (CKB)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={Number(data.maximumAmount - data.currentDeposits) / 1e8}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                  disabled={isDepositing}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Max available: {(Number(data.maximumAmount - data.currentDeposits) / 1e8).toFixed(2)} CKB
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowDepositModal(false);
                    setDepositAmount("");
                  }}
                  disabled={isDepositing}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDepositing || !depositAmount}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {isDepositing ? "Processing..." : "Deposit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
