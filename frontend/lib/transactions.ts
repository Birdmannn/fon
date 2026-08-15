import { ccc } from "@ckb-ccc/connector-react";
import { blake2b } from "@nervosnetwork/ckb-sdk-utils";
import { FREIGHT_CONTRACT, CampaignStatus, CampaignType, ParticipantStatus } from "./contract";
import {
  encodeBatchDeliverArgs,
  encodeCreateCampaignArgs,
  encodeDepositArgs,
  encodeCampaignData,
  encodeParticipantData,
  encodeSummary,
  decodeCampaignData,
  decodeParticipantData,
  bytesToHex,
  hexToBytes,
  lockScriptToAddressBytes,
  CampaignData,
  ParticipantData,
} from "./encoding";
import { buildStableCampaignId } from "./campaignIdentity";

// ─── Cell dep for the freight contract ───────────────────────────────────────

export const FREIGHT_CELL_DEP: ccc.CellDepLike = {
  outPoint: FREIGHT_CONTRACT.outPoint,
  depType: "code",
};

// ─── Build the type Script for a given selector + args ───────────────────────

export function freightScript(argsBytes: Uint8Array): ccc.ScriptLike {
  return {
    codeHash: FREIGHT_CONTRACT.codeHash,
    hashType: FREIGHT_CONTRACT.hashType,
    args: bytesToHex(argsBytes),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientNullOutputError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /null is not an object.*output|Cannot read properties of null.*output/i.test(message);
}

export async function withTransientNullOutputRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientNullOutputError(error) || attempt === attempts) {
        break;
      }

      await sleep(350 * attempt);
    }
  }

  if (isTransientNullOutputError(lastError)) {
    throw new Error("Transient CKB cell lookup failed while preparing the transaction. Please try again in a moment.");
  }

  throw lastError;
}

// ─── create_campaign ─────────────────────────────────────────────────────────

export async function sendCreateCampaign(
  signer: ccc.Signer,
  opts: {
    startDurationSecs: bigint;
    taskDurationSecs: bigint;
    campaignType: CampaignType;
    maximumAmountCkb: bigint;
    auxAmountCkb: bigint; // ticket_price for Raffle (in CKB), 0 otherwise
    rewardCount: bigint;
    summary: string;
    randomnessHash: Uint8Array;
  }
): Promise<{ txHash: string; campaignId: string; createdByHash: string; chainCreatedAt: string }> {
  const { startDurationSecs, taskDurationSecs, campaignType, maximumAmountCkb, auxAmountCkb, rewardCount, summary, randomnessHash } = opts;
  const maximumAmount = maximumAmountCkb * 100_000_000n;
  const auxAmount = auxAmountCkb * 100_000_000n;

  const tx = ccc.Transaction.default();
  tx.addCellDeps(FREIGHT_CELL_DEP);

  // Include the tip header as a header dep so the script can read the timestamp.
  const tipHeader = await signer.client.getTipHeader();
  tx.headerDeps.push(tipHeader.hash);

  // Creator lock = signer's recommended address lock.
  const addrObj = await signer.getRecommendedAddressObj();
  const lockArgBytes = hexToBytes(addrObj.script.args);
  const createdBy = new Uint8Array(20);
  createdBy.set(lockArgBytes.slice(0, 20));

  // Type script args: [0x00][startDuration(8)][taskDuration(8)][campaignType(1)][maxAmount(8)][auxAmount(8)]
  const typeArgs = encodeCreateCampaignArgs(
    startDurationSecs,
    taskDurationSecs,
    campaignType,
    maximumAmount,
    auxAmount,
    randomnessHash,
    rewardCount
  );

  // Campaign cell data (174 bytes).
  const campaignData = encodeCampaignData({
    createdAt: tipHeader.timestamp,
    startDurationSecs: startDurationSecs,
    taskDurationSecs: taskDurationSecs,
    createdBy,
    campaignType,
    maximumAmount,
    currentDeposits: 0n,
    status: CampaignStatus.Created,
    rewardCount,
    randomnessHash,
    summary: encodeSummary(summary),
    auxAmount,
  });

  // Output: campaign cell.
  // lock  = creator's own lock (they can spend it later)
  // type  = freight contract with create_campaign args
  // data  = 102-byte campaign blob
  tx.addOutput(
    {
      lock: addrObj.script,
      type: freightScript(typeArgs),
    },
    bytesToHex(campaignData)
  );

  // Auto-select inputs + change output to cover outputs + fees.
  await tx.completeFeeBy(signer, 1000n);

  const txHash = await signer.sendTransaction(tx);
  const createdByHash = bytesToHex(createdBy);
  const chainCreatedAt = tipHeader.timestamp.toString();

  return {
    txHash,
    campaignId: buildStableCampaignId(createdByHash, chainCreatedAt, campaignType),
    createdByHash,
    chainCreatedAt,
  };
}

// ─── deposit ─────────────────────────────────────────────────────────────────

export async function sendDepositShannons(
  signer: ccc.Signer,
  campaignCell: CampaignCell,
  amountShannons: bigint
): Promise<string> {
  const tx = ccc.Transaction.default();
  tx.addCellDeps(FREIGHT_CELL_DEP);

  // Include the tip header so the contract can read the current timestamp.
  const tipHeader = await signer.client.getTipHeader();
  tx.headerDeps.push(tipHeader.hash);

  const actionArgsHex = bytesToHex(encodeDepositArgs(amountShannons)) as `0x${string}`;

  // Update campaign data with new deposits
  const updatedCampaignData = {
    ...campaignCell.data,
    currentDeposits: campaignCell.data.currentDeposits + amountShannons,
  };

  // Add the campaign cell as input (GroupInput[0])
  // Provide full cell data so ccc can resolve capacity without an extra RPC call.
  tx.addInput({
    previousOutput: campaignCell.outPoint,
    since: "0x0",
    cellOutput: {
      capacity: campaignCell.capacityShannons,
      lock: campaignCell.lock,
      type: campaignCell.type,
    },
    outputData: bytesToHex(encodeCampaignData(campaignCell.data)),
  });

  // Output[0]: updated campaign cell with new deposit amount and new type script
  tx.addOutput(
    {
      capacity: campaignCell.capacityShannons + amountShannons,
      lock: campaignCell.lock,
      type: campaignCell.type,
    },
    bytesToHex(encodeCampaignData(updatedCampaignData))
  );

  // Auto-select inputs + change output to cover outputs + fees
  await tx.completeFeeBy(signer, 1000n);

  const witness = tx.getWitnessArgsAt(0) ?? ccc.WitnessArgs.from({});
  witness.outputType = actionArgsHex;
  tx.setWitnessArgsAt(0, witness);

  return signer.sendTransaction(tx);
}

export const SIMPLE_TASK_DIRECT_TIP_MIN_SHANNONS = 61n * 100_000_000n;

export async function sendDeposit(
  signer: ccc.Signer,
  campaignCell: CampaignCell,
  amountCkb: bigint // in CKB (not shannons)
): Promise<string> {
  return sendDepositShannons(signer, campaignCell, amountCkb * 100_000_000n);
}

export async function sendCreatorTipShannons(
  signer: ccc.Signer,
  campaignCell: CampaignCell,
  amountShannons: bigint
): Promise<string> {
  if (amountShannons < SIMPLE_TASK_DIRECT_TIP_MIN_SHANNONS) {
    throw new Error(`SimpleTask tips must be at least ${Number(SIMPLE_TASK_DIRECT_TIP_MIN_SHANNONS / 100_000_000n)} CKB so the creator can receive a standalone CKB cell.`);
  }

  const tx = ccc.Transaction.default();
  tx.addCellDeps(FREIGHT_CELL_DEP);

  const tipHeader = await signer.client.getTipHeader();
  tx.headerDeps.push(tipHeader.hash);

  const actionArgsHex = bytesToHex(encodeDepositArgs(amountShannons)) as `0x${string}`;
  const updatedCampaignData = {
    ...campaignCell.data,
    currentDeposits: campaignCell.data.currentDeposits + amountShannons,
  };

  tx.addInput({
    previousOutput: campaignCell.outPoint,
    since: "0x0",
    cellOutput: {
      capacity: campaignCell.capacityShannons,
      lock: campaignCell.lock,
      type: campaignCell.type,
    },
    outputData: bytesToHex(encodeCampaignData(campaignCell.data)),
  });

  tx.addOutput(
    {
      capacity: campaignCell.capacityShannons,
      lock: campaignCell.lock,
      type: campaignCell.type,
    },
    bytesToHex(encodeCampaignData(updatedCampaignData))
  );

  tx.addOutput({
    capacity: amountShannons,
    lock: campaignCell.lock,
  }, "0x");

  await withTransientNullOutputRetry(() => tx.completeFeeBy(signer, 1000n));

  const witness = tx.getWitnessArgsAt(0) ?? ccc.WitnessArgs.from({});
  witness.outputType = actionArgsHex;
  tx.setWitnessArgsAt(0, witness);

  return withTransientNullOutputRetry(() => signer.sendTransaction(tx));
}

export async function sendCreatorTip(
  signer: ccc.Signer,
  campaignCell: CampaignCell,
  amountCkb: bigint
): Promise<string> {
  return sendCreatorTipShannons(signer, campaignCell, amountCkb * 100_000_000n);
}

export async function sendVerifyParticipantRaffle(
  signer: ccc.Signer,
  campaignCell: CampaignCell
): Promise<string> {
  const tx = ccc.Transaction.default();
  tx.addCellDeps(FREIGHT_CELL_DEP);

  const tipHeader = await signer.client.getTipHeader();
  tx.headerDeps.push(tipHeader.hash);

  const depositorAddressObj = await signer.getRecommendedAddressObj();
  const depositorAddressBytes = lockScriptToAddressBytes(depositorAddressObj.script);
  const joinedAt = tipHeader.timestamp;
  const ticketPrice = campaignCell.data.auxAmount;

  if (ticketPrice <= 0n) {
    throw new Error("Ticket price is unavailable for this raffle");
  }

  // Input[0]: campaign cell — must be GroupInput[0] so the contract finds it
  // Provide full cell data so ccc can resolve capacity without an extra RPC call.
  tx.addInput({
    previousOutput: campaignCell.outPoint,
    since: "0x0",
    cellOutput: {
      capacity: campaignCell.capacityShannons,
      lock: campaignCell.lock,
      type: campaignCell.type,
    },
    outputData: bytesToHex(encodeCampaignData(campaignCell.data)),
  });

  // Output[0]: updated campaign cell with ticket price added to capacity + deposits
  const updatedCampaignData = {
    ...campaignCell.data,
    currentDeposits: campaignCell.data.currentDeposits + ticketPrice,
  };
  tx.addOutput(
    {
      capacity: campaignCell.capacityShannons + ticketPrice,
      lock: campaignCell.lock,
      type: campaignCell.type,
    },
    bytesToHex(encodeCampaignData(updatedCampaignData))
  );

  // Output[1]: participant cell
  // Minimum: cell overhead (61) + secp256k1 lock (~53) + data (73) = 187 bytes → 18_700_000_000 shannons
  const PARTICIPANT_CELL_CAPACITY = 18_700_000_000n;
  tx.addOutput(
    {
      capacity: PARTICIPANT_CELL_CAPACITY,
      lock: depositorAddressObj.script,
    },
    bytesToHex(encodeParticipantData({
      campaignCreatedBy: campaignCell.data.createdBy,
      campaignCreatedAt: campaignCell.data.createdAt,
      campaignType: campaignCell.data.campaignType,
      participantAddress: depositorAddressBytes,
      joinedAt,
      status: ParticipantStatus.Verified,
      depositedAmount: ticketPrice,
    }))
  );

  // Let completeFeeBy pull in whatever inputs are needed to cover:
  // ticket price (transferred to campaign cell) + participant cell + any required change + fee
  await tx.completeFeeBy(signer, 1000n);

  // Set witness at index 0 (campaign cell position) with selector byte 0x03
  const witness = tx.getWitnessArgsAt(0) ?? ccc.WitnessArgs.from({});
  witness.outputType = bytesToHex(new Uint8Array([3])) as `0x${string}`;
  tx.setWitnessArgsAt(0, witness);

  return signer.sendTransaction(tx);
}

export async function sendUpdateCampaignStatus(
  signer: ccc.Signer,
  campaignCell: CampaignCell
): Promise<string> {
  const tx = ccc.Transaction.default();
  tx.addCellDeps(FREIGHT_CELL_DEP);

  const tipHeader = await signer.client.getTipHeader();
  tx.headerDeps.push(tipHeader.hash);

  const nowMs = Number(tipHeader.timestamp);
  const createdAtMs = Number(campaignCell.data.createdAt);
  const startDelayMs = Number(campaignCell.data.startDurationSecs) * 1000;
  const durationMs = Number(campaignCell.data.taskDurationSecs) * 1000;
  const startsAtMs = createdAtMs + startDelayMs;
  const endsAtMs = startsAtMs + durationMs;

  // Derive the new status the contract will compute and write it in the output cell.
  // The contract's update_campaign_status does exactly this same derivation.
  let newStatus: CampaignStatus;
  if (nowMs >= endsAtMs) {
    newStatus = CampaignStatus.Completed;
  } else if (nowMs >= startsAtMs) {
    newStatus = CampaignStatus.Active;
  } else {
    throw new Error("Campaign has not started yet — cannot update status");
  }

  tx.addInput({
    previousOutput: campaignCell.outPoint,
    since: "0x0",
    cellOutput: {
      capacity: campaignCell.capacityShannons,
      lock: campaignCell.lock,
      type: campaignCell.type,
    },
    outputData: bytesToHex(encodeCampaignData(campaignCell.data)),
  });

  // Output must have the new status — the contract verifies this
  const updatedData = { ...campaignCell.data, status: newStatus };
  tx.addOutput(
    {
      capacity: campaignCell.capacityShannons,
      lock: campaignCell.lock,
      type: campaignCell.type,
    },
    bytesToHex(encodeCampaignData(updatedData))
  );

  await tx.completeFeeBy(signer, 1000n);

  const witness = tx.getWitnessArgsAt(0) ?? ccc.WitnessArgs.from({});
  witness.outputType = bytesToHex(new Uint8Array([4])) as `0x${string}`;
  tx.setWitnessArgsAt(0, witness);

  return signer.sendTransaction(tx);
}

export async function sendBatchDeliver(
  signer: ccc.Signer,
  campaignCell: CampaignCell,
  winners: ParticipantCell[],
  revealedPreimage?: Uint8Array
): Promise<string> {
  const tx = ccc.Transaction.default();
  tx.addCellDeps(FREIGHT_CELL_DEP);

  const tipHeader = await signer.client.getTipHeader();
  tx.headerDeps.push(tipHeader.hash);

  tx.addInput({
    previousOutput: campaignCell.outPoint,
    since: "0x0",
    cellOutput: {
      capacity: campaignCell.capacityShannons,
      lock: campaignCell.lock,
      type: campaignCell.type,
    },
    outputData: bytesToHex(encodeCampaignData(campaignCell.data)),
  });

  for (const winner of winners) {
    tx.addInput({
      previousOutput: winner.outPoint,
      since: "0x0",
      cellOutput: {
        capacity: winner.capacityShannons,
        lock: winner.lock,
        type: winner.type ?? undefined,
      },
      outputData: bytesToHex(encodeParticipantData(winner.data)),
    });
  }

  const rewardCount = campaignCell.data.rewardCount === 0n
    ? BigInt(winners.length)
    : BigInt(Math.min(Number(campaignCell.data.rewardCount), winners.length));
  if (rewardCount <= 0n) {
    throw new Error("No eligible winners are available for settlement.");
  }
  const rewardPerWinner = campaignCell.data.currentDeposits / rewardCount;
  const updatedCampaignData = {
    ...campaignCell.data,
    currentDeposits: campaignCell.data.currentDeposits - rewardPerWinner * BigInt(winners.length),
  };

  tx.addOutput(
    {
      capacity: campaignCell.capacityShannons - rewardPerWinner * BigInt(winners.length),
      lock: campaignCell.lock,
      type: campaignCell.type,
    },
    bytesToHex(encodeCampaignData(updatedCampaignData))
  );

  for (const winner of winners) {
    tx.addOutput(
      {
        capacity: winner.capacityShannons + rewardPerWinner,
        lock: winner.lock,
        type: winner.type ?? undefined,
      },
      bytesToHex(encodeParticipantData({
        ...winner.data,
        status: ParticipantStatus.Rewarded,
      }))
    );
  }

  await withTransientNullOutputRetry(() => tx.completeFeeBy(signer, 1000n));

  const witness = tx.getWitnessArgsAt(0) ?? ccc.WitnessArgs.from({});
  witness.outputType = bytesToHex(encodeBatchDeliverArgs(revealedPreimage)) as `0x${string}`;
  tx.setWitnessArgsAt(0, witness);

  return withTransientNullOutputRetry(() => signer.sendTransaction(tx));
}

// ─── Query all campaign cells from the CKB indexer ───────────────────────────

export interface CampaignCell {
  outPoint: { txHash: string; index: number };
  data: CampaignData;
  capacityShannons: bigint;
  lock: ccc.ScriptLike;
  type: ccc.ScriptLike;
}

export async function fetchCampaigns(
  client: ccc.Client,
  limit = 20
): Promise<CampaignCell[]> {
  const results: CampaignCell[] = [];

  // Use prefix mode so we match all cells with this type script regardless of args length.
  // findCellsByType hardcodes "exact" which would never match our 26-byte args.
  let count = 0;
  for await (const cell of client.findCells(
    {
      script: {
        codeHash: FREIGHT_CONTRACT.codeHash,
        hashType: FREIGHT_CONTRACT.hashType,
        args: "0x",
      },
      scriptType: "type",
      scriptSearchMode: "prefix",
      withData: true,
    },
    "desc",
    limit
  )) {
    if (count++ >= limit) break;
    try {
      const rawData = hexToBytes(cell.outputData);
      const typeScript = cell.cellOutput.type;
      // Campaign cells are exactly 174 bytes; participant cells are 73 bytes.
      if (rawData.length !== 174 || !typeScript) continue;
      results.push({
        outPoint: {
          txHash: cell.outPoint.txHash,
          index: Number(cell.outPoint.index),
        },
        data: decodeCampaignData(rawData),
        capacityShannons: cell.cellOutput.capacity,
        lock: cell.cellOutput.lock,
        type: typeScript,
      });
    } catch {
      // Skip malformed cells.
    }
  }

  return results;
}

export interface ParticipantCell {
  outPoint: { txHash: string; index: number };
  data: ParticipantData;
  capacityShannons: bigint;
  lock: ccc.ScriptLike;
  type: ccc.ScriptLike | null;
}

export async function fetchParticipants(
  client: ccc.Client,
  campaign: CampaignCell,
  limit = 500,
  participantAddresses?: string[]
): Promise<ParticipantCell[]> {
  const results: ParticipantCell[] = [];
  const campaignCreatedByHex = bytesToHex(campaign.data.createdBy);
  const campaignCreatedAt = campaign.data.createdAt;
  const campaignType = campaign.data.campaignType;
  const normalizedAddresses = participantAddresses?.map((value) => value.trim()).filter(Boolean) ?? [];

  type IndexedCell = {
    outPoint: { txHash: string; index: string | number | bigint };
    outputData: string;
    cellOutput: {
      capacity: bigint;
      lock: ccc.ScriptLike;
      type?: ccc.ScriptLike | null;
    };
  };

  const collectFromCells = (cells: AsyncIterable<IndexedCell>) => (async () => {
    let count = 0;
    for await (const cell of cells) {
      if (count++ >= limit) break;
      try {
        const rawData = hexToBytes(cell.outputData);
        if (rawData.length !== 66) continue;
        const data = decodeParticipantData(rawData);
        if (
          bytesToHex(data.campaignCreatedBy) !== campaignCreatedByHex ||
          data.campaignCreatedAt !== campaignCreatedAt ||
          data.campaignType !== campaignType
        ) {
          continue;
        }
        if (data.status !== ParticipantStatus.Verified) {
          continue;
        }
        results.push({
          outPoint: {
            txHash: cell.outPoint.txHash,
            index: Number(cell.outPoint.index),
          },
          data,
          capacityShannons: cell.cellOutput.capacity,
          lock: cell.cellOutput.lock,
          type: cell.cellOutput.type ?? null,
        });
      } catch {
        // Skip malformed cells.
      }
    }
  })();

  if (normalizedAddresses.length > 0) {
    for (const address of normalizedAddresses) {
      const addressObj = await ccc.Address.fromString(address, client);
      await collectFromCells(client.findCells(
        {
          script: addressObj.script,
          scriptType: "lock",
          scriptSearchMode: "exact",
          withData: true,
        },
        "asc",
        limit
      ));
    }
    return results;
  }

  await collectFromCells(client.findCells(
    {
      script: {
        codeHash: FREIGHT_CONTRACT.codeHash,
        hashType: FREIGHT_CONTRACT.hashType,
        args: "0x",
      },
      scriptType: "type",
      scriptSearchMode: "prefix",
      withData: true,
    },
    "asc",
    limit
  ));

  return results;
}

function compareParticipants(left: ParticipantCell, right: ParticipantCell) {
  const joinedDiff = Number(left.data.joinedAt - right.data.joinedAt);
  if (joinedDiff !== 0) {
    return joinedDiff;
  }

  const leftAddress = bytesToHex(left.data.participantAddress);
  const rightAddress = bytesToHex(right.data.participantAddress);
  if (leftAddress !== rightAddress) {
    return leftAddress < rightAddress ? -1 : 1;
  }

  if (left.outPoint.txHash !== right.outPoint.txHash) {
    return left.outPoint.txHash < right.outPoint.txHash ? -1 : 1;
  }

  return left.outPoint.index - right.outPoint.index;
}

function deriveRoundHash(seed: Uint8Array, round: bigint) {
  const roundBytes = new Uint8Array(8);
  let value = round;
  for (let i = 0; i < 8; i += 1) {
    roundBytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }

  const input = new Uint8Array(seed.length + roundBytes.length);
  input.set(seed, 0);
  input.set(roundBytes, seed.length);
  const hasher = blake2b(32, null, null, null);
  hasher.update(input);
  return hasher.digest("binary") as Uint8Array;
}

function drawUniformIndex(seed: Uint8Array, roundRef: { current: bigint }, upperBound: number) {
  const range = BigInt(upperBound);
  const maxUint64 = (1n << 64n) - 1n;
  const threshold = maxUint64 - (maxUint64 % range);

  while (true) {
    const roundHash = deriveRoundHash(seed, roundRef.current);
    roundRef.current += 1n;
    const view = new DataView(roundHash.buffer, roundHash.byteOffset, 8);
    const candidate = view.getBigUint64(0, true);
    if (candidate < threshold) {
      return Number(candidate % range);
    }
  }
}

export function previewDeterministicWinners(
  participants: ParticipantCell[],
  rewardCount: bigint,
  revealedPreimage: Uint8Array,
  campaign: CampaignCell
): ParticipantCell[] {
  const ordered = [...participants].sort(compareParticipants);
  const winnerCount = rewardCount === 0n ? ordered.length : Math.min(Number(rewardCount), ordered.length);
  if (winnerCount >= ordered.length) {
    return ordered;
  }

  const seedInput = new Uint8Array(32 + 32 + 4 + 8);
  seedInput.set(revealedPreimage, 0);
  seedInput.set(hexToBytes(campaign.outPoint.txHash), 32);
  const view = new DataView(seedInput.buffer);
  view.setUint32(64, campaign.outPoint.index, true);
  view.setBigUint64(68, BigInt(ordered.length), true);
  const hasher = blake2b(32, null, null, null);
  hasher.update(seedInput);
  const seed = hasher.digest("binary") as Uint8Array;

  const roundRef = { current: 0n };
  for (let i = ordered.length - 1; i > 0; i -= 1) {
    const j = drawUniformIndex(seed, roundRef, i + 1);
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }

  return ordered.slice(0, winnerCount);
}
