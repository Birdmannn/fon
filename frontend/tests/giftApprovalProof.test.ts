import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { Script, type Client } from "@ckb-ccc/core";
const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { getLiveGiftCampaign } = jiti("../lib/giftApprovalProof.ts");
const { encodeCampaignData, bytesToHex } = jiti("../lib/encoding.ts");
const { CampaignType, FREIGHT_CONTRACT } = jiti("../lib/contract.ts");
function fixture({ identity = 1000n, committed = true, initialIdentity = 1000n } = {}) {
  const data = { createdAt:1000n,startDurationSecs:0n,taskDurationSecs:60n,createdBy:new Uint8Array(20).fill(1),campaignType:CampaignType.FundedTask,
    maximumAmount:1000n,currentDeposits:0n,status:0,rewardCount:1n,randomnessHash:new Uint8Array(32),summary:new Uint8Array(64),auxAmount:0n,
    ticketSalesTotal:0n,creatorSupportTotal:0n,supportPoolBps:0n,dataLayout:"split-support",
    approval:{ stage:"gift-commence",required:1,confirmed:false,approvers:[{ lockHash:new Uint8Array(32).fill(2),approved:false }] } };
  const type = Script.from({ codeHash:FREIGHT_CONTRACT.codeHash,hashType:FREIGHT_CONTRACT.hashType,args:"0x00" });
  const creation = { status:"committed",transaction:{ outputs:[{ type }],outputsData:[bytesToHex(encodeCampaignData({ ...data,createdAt:initialIdentity }))] } };
  const client = {
    getTransaction:async (hash: string) => hash === "creation" ? creation : { status:committed ? "committed" : "pending" },
    findCellsByType:async function* () { yield { outPoint:{ txHash:"approval",index:0 },outputData:bytesToHex(encodeCampaignData({ ...data,createdAt:identity })) }; },
  } as unknown as Client;
  const record = { txHash:"creation",campaignType:CampaignType.FundedTask,createdByHash:bytesToHex(data.createdBy),chainCreatedAt:"1000",giftDeliverable:{ approvals:[{ approved:true }] } };
  return { client,record };
}
test("server reads approval flags from the live gift cell", async () => {
  const { client,record } = fixture();
  const data = await getLiveGiftCampaign(client,record);
  assert.equal(data.approval.approvers[0].approved,false);
});
test("server rejects a different gift identity and unconfirmed approval cells", async () => {
  for (const options of [{ identity:2000n },{ initialIdentity:2000n },{ committed:false }]) {
    const { client,record } = fixture(options);
    await assert.rejects(() => getLiveGiftCampaign(client,record));
  }
});
