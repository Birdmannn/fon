import { Address, type Cell, type Client, type Transaction } from "@ckb-ccc/core";

import { buildStableCampaignId } from "@/lib/campaignIdentity";
import { CampaignType, FREIGHT_CONTRACT, ParticipantStatus } from "@/lib/contract";
import { bytesToHex, decodeCampaignData, decodeParticipantData, hexToBytes, lockScriptToAddressBytes } from "@/lib/encoding";

type RecordIdentity = Record<string, unknown>;

type Recipient = { address: string; amountShannons: string };

function campaignIdFromData(data: string) {
  const campaign = decodeCampaignData(hexToBytes(data));
  return {
    campaign,
    id: buildStableCampaignId(bytesToHex(campaign.createdBy), campaign.createdAt, campaign.campaignType),
  };
}

function expectedCampaignId(record: RecordIdentity, campaignType: number) {
  const id = buildStableCampaignId(
    typeof record.createdByHash === "string" ? record.createdByHash : null,
    typeof record.chainCreatedAt === "string" || typeof record.chainCreatedAt === "number" ? record.chainCreatedAt : null,
    typeof record.campaignType === "number" ? record.campaignType : null,
  );
  if (!id || Number(record.campaignType) !== campaignType) {
    throw new Error("Freight has no matching on-chain raffle identity");
  }
  return id;
}

function verifyCampaignCells(input: Cell, transaction: Transaction, record: RecordIdentity, campaignType: number) {
  const type = input.cellOutput.type;
  if (!type || type.codeHash.toLowerCase() !== FREIGHT_CONTRACT.codeHash.toLowerCase() || type.hashType !== FREIGHT_CONTRACT.hashType) {
    throw new Error("Transaction does not spend a freight contract cell");
  }
  if (!transaction.outputs[0]?.type?.eq(type) || !transaction.outputs[0].lock.eq(input.cellOutput.lock)) {
    throw new Error("Transaction does not preserve the freight contract cell");
  }
  const original = campaignIdFromData(input.outputData);
  const updated = campaignIdFromData(transaction.outputsData[0] ?? "0x");
  const expectedId = expectedCampaignId(record, campaignType);
  if (original.id !== expectedId || updated.id !== expectedId) {
    throw new Error("Transaction belongs to a different freight");
  }
  return { original: original.campaign, updated: updated.campaign };
}

function verifyParticipantLock(input: Cell) {
  const lock = input.cellOutput.lock;
  if (lock.codeHash.toLowerCase() !== FREIGHT_CONTRACT.codeHash.toLowerCase()
    || lock.hashType !== FREIGHT_CONTRACT.hashType || !lock.args.toLowerCase().startsWith("0xff")) {
    throw new Error("Winner ticket is not locked by the freight contract");
  }
}

function matchingParticipant(input: Cell, outputData: string, campaignId: string, status: number) {
  const before = decodeParticipantData(hexToBytes(input.outputData));
  const after = decodeParticipantData(hexToBytes(outputData));
  const beforeId = buildStableCampaignId(bytesToHex(before.campaignCreatedBy), before.campaignCreatedAt, before.campaignType);
  const afterId = buildStableCampaignId(bytesToHex(after.campaignCreatedBy), after.campaignCreatedAt, after.campaignType);
  if (beforeId !== campaignId || afterId !== campaignId
    || bytesToHex(before.participantAddress) !== bytesToHex(after.participantAddress)
    || before.joinedAt !== after.joinedAt || after.status !== status) {
    throw new Error("Transaction does not prove a matching paid participant");
  }
  return { before, after };
}

export async function verifyRaffleSettlement(
  client: Client,
  transaction: Transaction,
  record: RecordIdentity,
  recipients: Recipient[],
) {
  if (recipients.length === 0 || transaction.inputs.length < recipients.length + 1) {
    throw new Error("Settlement has no matching winner inputs");
  }
  const campaignInput = await transaction.inputs[0].getCell(client);
  const { original, updated } = verifyCampaignCells(campaignInput, transaction, record, CampaignType.Raffle);
  const campaignId = expectedCampaignId(record, CampaignType.Raffle);
  const awards = [];
  let distributed = 0n;

  for (let index = 0; index < recipients.length; index += 1) {
    const recipient = recipients[index];
    const input = await transaction.inputs[index + 1].getCell(client);
    verifyParticipantLock(input);
    const output = transaction.outputs[index + 1];
    if (!output || !output.lock.eq(input.cellOutput.lock)) {
      throw new Error("Settlement winner output does not match its ticket input");
    }
    const { before } = matchingParticipant(input, transaction.outputsData[index + 1] ?? "0x", campaignId, ParticipantStatus.Rewarded);
    if (before.status !== ParticipantStatus.Verified) {
      throw new Error("Settlement ticket was not verified");
    }
    const address = await Address.fromString(recipient.address, client);
    if (bytesToHex(lockScriptToAddressBytes(address.script)) !== bytesToHex(before.participantAddress)) {
      throw new Error("Settlement recipient does not own the winning ticket");
    }
    const amount = BigInt(output.capacity) - BigInt(input.cellOutput.capacity);
    if (amount <= 0n || amount.toString() !== recipient.amountShannons) {
      throw new Error("Settlement reward amount does not match the chain");
    }
    distributed += amount;
    awards.push({ address: recipient.address.trim().toLowerCase(), amountShannons: amount, outputIndex: index + 1 });
  }

  if (original.currentDeposits - updated.currentDeposits !== distributed) {
    throw new Error("Settlement distribution does not match freight escrow");
  }
  for (let index = recipients.length + 1; index < transaction.outputs.length; index += 1) {
    const data = transaction.outputsData[index];
    if (data && data !== "0x") {
      try {
        const participant = decodeParticipantData(hexToBytes(data));
        if (participant.status === ParticipantStatus.Rewarded
          && buildStableCampaignId(bytesToHex(participant.campaignCreatedBy), participant.campaignCreatedAt, participant.campaignType) === campaignId) {
          throw new Error("Settlement omitted a rewarded participant");
        }
      } catch (error) {
        if (error instanceof Error && error.message === "Settlement omitted a rewarded participant") throw error;
      }
    }
  }
  return awards;
}

export async function verifyRecurringRaffleCashout(
  client: Client,
  transaction: Transaction,
  record: RecordIdentity,
  walletAddress: string,
) {
  if (transaction.inputs.length < 2 || transaction.outputs.length < 2) {
    throw new Error("Cash-out transaction has no winning ticket");
  }
  const campaignInput = await transaction.inputs[0].getCell(client);
  const { original, updated } = verifyCampaignCells(campaignInput, transaction, record, CampaignType.RecurringRaffle);
  const participantInput = await transaction.inputs[1].getCell(client);
  verifyParticipantLock(participantInput);
  const before = decodeParticipantData(hexToBytes(participantInput.outputData));
  const campaignId = expectedCampaignId(record, CampaignType.RecurringRaffle);
  const participantId = buildStableCampaignId(bytesToHex(before.campaignCreatedBy), before.campaignCreatedAt, before.campaignType);
  const address = await Address.fromString(walletAddress, client);
  const amount = before.claimableAmount ?? 0n;
  if (participantId !== campaignId || before.status !== ParticipantStatus.Winner || amount <= 0n
    || bytesToHex(lockScriptToAddressBytes(address.script)) !== bytesToHex(before.participantAddress)
    || !transaction.outputs[1].lock.eq(address.script)
    || transaction.outputsData[1] !== "0x"
    || BigInt(transaction.outputs[1].capacity) !== BigInt(participantInput.cellOutput.capacity) + amount
    || original.currentDeposits - updated.currentDeposits !== amount) {
    throw new Error("Transaction does not prove this wallet's recurring raffle cash-out");
  }
  return { address: walletAddress.trim().toLowerCase(), amountShannons: amount, outputIndex: 1 };
}
