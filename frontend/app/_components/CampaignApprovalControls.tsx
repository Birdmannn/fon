"use client";

import { useEffect, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import type { CampaignRecord } from "@/app/_types/campaignRecords";
import { useInfoError } from "./InfoErrorProvider";
import { CampaignStatus } from "@/lib/contract";
import { getCampaignStableId } from "@/lib/campaignIdentity";
import { bytesToHex, decodeCampaignData, hexToBytes, lockScriptToAddressBytes } from "@/lib/encoding";
import { raffleApprovalDeadlineMissed, raffleApprovalsSatisfied, raffleApprovalThresholdMet } from "@/lib/raffleApproval";
import { sendCancelCampaign, sendConfirmRaffleApproval, sendCampaignApproval, type CampaignCell } from "@/lib/transactions";

export const CAMPAIGN_APPROVAL_UPDATE_EVENT = "freight:approval-chain-update";

export default function CampaignApprovalControls({ campaign, record, signer, nowMs }: {
  campaign: CampaignCell;
  record: CampaignRecord | null;
  signer: ccc.Signer | null;
  nowMs: number;
}) {
  const approval = campaign.data.approval;
  const legacyGift = !campaign.data.gift && !!record?.giftDeliverable?.enabled;
  const hasApproval = !!approval || legacyGift || !!campaign.data.gift;
  const [walletHash, setWalletHash] = useState<string | null>(null);
  const [creator, setCreator] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lateReceipt, setLateReceipt] = useState(false);
  useInfoError(error);

  useEffect(() => {
    let cancelled = false;
    setWalletHash(null);
    setCreator(false);
    if (signer && hasApproval) void signer.getRecommendedAddressObj().then((address) => {
      if (cancelled) return;
      setWalletHash(address.script.hash());
      setCreator(campaign.data.gift ? address.script.hash() === bytesToHex(campaign.data.gift.creator) : bytesToHex(lockScriptToAddressBytes(address.script)) === bytesToHex(campaign.data.createdBy));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [signer, hasApproval, campaign.data.createdBy, campaign.data.gift]);

  const awaitingConfirmation = !!approval && approval.stage === "on-commence" && raffleApprovalThresholdMet(approval) && !approval.confirmed;
  useEffect(() => {
    let cancelled = false;
    setLateReceipt(false);
    if (awaitingConfirmation && signer) void signer.client.getTransactionWithHeader(campaign.outPoint.txHash).then((receipt) => {
      if (!cancelled && receipt?.header) setLateReceipt(receipt.header.timestamp >= campaign.data.createdAt + campaign.data.startDurationSecs * 1000n);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [awaitingConfirmation, signer, campaign.outPoint.txHash, campaign.data.createdAt, campaign.data.startDurationSecs]);

  if (legacyGift || !approval && campaign.data.gift) return (
    <div className="campaign-approval-controls">
      <p>{legacyGift ? "This older gift needs to be recreated with on-chain claim rules." : "Gift allocations and claims are enforced on-chain."}</p>
      {creator && (campaign.data.status === CampaignStatus.Created || campaign.data.status === CampaignStatus.Active) ? <button type="button" className="create-info-confirm-btn" disabled={busy} onClick={() => void act("cancel")}>Cancel freight</button> : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
  if (!approval) return null;
  const cancelled = campaign.data.status === CampaignStatus.Cancelled;
  const approvedCount = approval.approvers.filter((entry) => entry.approved).length;
  const failed = lateReceipt || raffleApprovalDeadlineMissed(campaign.data, nowMs);
  const entry = approval.approvers.find((value) => bytesToHex(value.lockHash) === walletHash);
  const complete = raffleApprovalsSatisfied(approval);
  const canApprove = !!entry && !entry.approved && !complete && !cancelled && !failed && !awaitingConfirmation;
  const canCancel = creator && (failed || !!campaign.data.gift || approval.stage === "gift-commence" && !complete)
    && (campaign.data.status === CampaignStatus.Created || campaign.data.status === CampaignStatus.Active);

  async function waitAndUpdate(txHash: string): Promise<CampaignCell> {
    if (!signer) throw new Error("Connect your wallet");
    const receipt = await signer.client.waitTransaction(txHash, 1, 180_000);
    if (!receipt || receipt.status !== "committed") throw new Error("Transaction is pending. Refresh once it is confirmed.");
    const output = receipt.transaction.outputs[0];
    if (!output?.type) throw new Error("Missing freight output");
    const updated: CampaignCell = {
      outPoint: { txHash, index: 0 },
      data: decodeCampaignData(hexToBytes(receipt.transaction.outputsData[0])),
      capacityShannons: output.capacity,
      lock: output.lock,
      type: output.type,
    };
    if (updated.data.approval?.stage === "on-commence" && !updated.data.approval.confirmed && receipt.blockHash) {
      updated.data.approval.recordedAt = (await signer.client.getHeaderByHash(receipt.blockHash))?.timestamp;
    }
    window.dispatchEvent(new CustomEvent(CAMPAIGN_APPROVAL_UPDATE_EVENT, { detail: { campaign: updated, campaignId: getCampaignStableId(updated) } }));
    return updated;
  }

  async function act(action: "approve" | "confirm" | "cancel") {
    if (!signer || busy) return;
    setBusy(true);
    setError(null);
    setMessage(action === "cancel" ? "Cancelling…" : "Recording approval…");
    try {
      let updated = await waitAndUpdate(await (action === "cancel" ? sendCancelCampaign(signer, campaign) : action === "confirm" ? sendConfirmRaffleApproval(signer, campaign) : sendCampaignApproval(signer, campaign)));
      if (action === "approve" && updated.data.approval?.stage === "on-commence" && raffleApprovalThresholdMet(updated.data.approval)) {
        setMessage("Confirming commencement approvals…");
        updated = await waitAndUpdate(await sendConfirmRaffleApproval(signer, updated));
      }
      setMessage(action === "cancel" ? "Freight cancelled." : "Approval recorded.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Freight action failed");
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="campaign-approval-controls" aria-label="Freight approvals">
      <p>{cancelled ? "Cancelled" : failed ? "Closed — approval deadline missed" : complete ? "Approved" : awaitingConfirmation ? "Approvals recorded — confirmation required" : `${approval.stage === "on-delivery" ? "Delivery" : "Commencement"} approvals pending`} · {approvedCount}/{approval.required}</p>
      <p>{(approval.stage === "gift-commence" ? record?.giftDeliverable?.approvers : record?.raffleApproval?.approvers)?.map((value) => value.handle).join(", ")}</p>
      <div className="flex items-center gap-2">
        {canApprove ? <button type="button" className="create-info-confirm-btn" disabled={busy} onClick={() => void act("approve")}>Approve</button> : null}
        {awaitingConfirmation && signer && !failed && !cancelled ? <button type="button" className="create-info-confirm-btn" disabled={busy} onClick={() => void act("confirm")}>Confirm commencement</button> : null}
        {canCancel ? <button type="button" className="create-info-confirm-btn" disabled={busy} onClick={() => void act("cancel")}>Cancel freight</button> : null}
      </div>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
