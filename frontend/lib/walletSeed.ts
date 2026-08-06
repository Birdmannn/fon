const WALLET_SEED_INTENT_KEY = "freight:wallet-seed-intent";
const walletSeedInFlight = new Set<string>();

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function markWalletSeedIntent() {
  if (!canUseSessionStorage()) {
    return;
  }

  window.sessionStorage.setItem(WALLET_SEED_INTENT_KEY, "1");
}

export function clearWalletSeedIntent() {
  if (!canUseSessionStorage()) {
    return;
  }

  window.sessionStorage.removeItem(WALLET_SEED_INTENT_KEY);
}

export function hasWalletSeedIntent() {
  if (!canUseSessionStorage()) {
    return false;
  }

  return window.sessionStorage.getItem(WALLET_SEED_INTENT_KEY) === "1";
}

export function startWalletSeedAttempt(address: string) {
  const normalizedAddress = address.trim().toLowerCase();
  if (!normalizedAddress || walletSeedInFlight.has(normalizedAddress)) {
    return false;
  }

  walletSeedInFlight.add(normalizedAddress);
  return true;
}

export function finishWalletSeedAttempt(address: string) {
  const normalizedAddress = address.trim().toLowerCase();
  if (!normalizedAddress) {
    return;
  }

  walletSeedInFlight.delete(normalizedAddress);
}
