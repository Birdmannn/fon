import { Script, bytesFrom, hexFrom, type ScriptLike } from "@ckb-ccc/core";

// Must match supported_raffle_wallet in contracts/freight/src/validations.rs.
// Legacy tickets store 20 argument bytes; pin the actual wallet program too.
const walletPrograms = new Set([
  "type:0xd23761b364210735c19c60561d213fb3beae2fd6172743719eff6920e020baac",
  "type:0xd00c84f0ec8fd441c38bc3f87a371f547190f2fcff88e642bc5bf54b9e318323",
  "type:0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
  "type:0xf329effd1c475a2978453c8600e1eaf0bc2087ee093c3ee64cc96ec6847752cb",
  "type:0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26",
  "data2:0x2ba431b27a844a3664e24c548ecd175cea3ba005590f4f362bee5a94acac92e6",
  "data2:0x37d1ff519ae19f7b16cd7ee9b4f726300cdcc6fece923bf8bee40466a15cef28",
  "data2:0xdda8f7cfc319891c35aa68425674776f79c0e1c9c0f1c6adc253990fa4322695",
]);

export function isSupportedRafflePayoutLock(lock: ScriptLike) {
  const script = Script.from(lock);
  return walletPrograms.has(`${script.hashType}:${script.codeHash.toLowerCase()}`);
}

export function rafflePayoutMatchesIdentity(lock: ScriptLike, identity: string) {
  const script = Script.from(lock);
  // Pilot tickets identify the owner's lock hash; ordinary wallets identify
  // their lock arguments. Either route remains bound to a supported program.
  return isSupportedRafflePayoutLock(script) && (
    hexFrom(bytesFrom(script.args).slice(0, 20)) === identity.toLowerCase()
    || hexFrom(bytesFrom(script.hash()).slice(0, 20)) === identity.toLowerCase()
  );
}

export function isRaffleProfileOwner(owner: ScriptLike, wallet: ScriptLike) {
  const profile = Script.from(owner); const spending = Script.from(wallet);
  if (profile.eq(spending)) return true;
  return isSupportedRafflePayoutLock(profile) && spending.hashType === "data2"
    && ["0x37d1ff519ae19f7b16cd7ee9b4f726300cdcc6fece923bf8bee40466a15cef28",
      "0xdda8f7cfc319891c35aa68425674776f79c0e1c9c0f1c6adc253990fa4322695"].includes(spending.codeHash)
    && bytesFrom(spending.args).length === 104 && spending.args.slice(0, 66) === profile.hash();
}
