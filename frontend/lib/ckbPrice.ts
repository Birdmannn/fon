const CKB_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=nervos-network&vs_currencies=usd";
const CKB_PRICE_CACHE_MS = 60_000;

let cachedCkbUsdPrice: number | null = null;
let cachedCkbUsdPriceFetchedAt = 0;

type FetchCkbUsdPriceOptions = {
  allowStaleOnFailure?: boolean;
};

export async function fetchCkbUsdPrice({ allowStaleOnFailure = false }: FetchCkbUsdPriceOptions = {}) {
  const now = Date.now();
  if (cachedCkbUsdPrice !== null && (now - cachedCkbUsdPriceFetchedAt) < CKB_PRICE_CACHE_MS) {
    return cachedCkbUsdPrice;
  }

  try {
    const response = await fetch(CKB_PRICE_URL, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(typeof payload?.error === "string" ? payload.error : "Failed to fetch CKB price");
    }

    const usd = payload?.["nervos-network"]?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
      throw new Error("Invalid CKB USD price returned from CoinGecko");
    }

    cachedCkbUsdPrice = usd;
    cachedCkbUsdPriceFetchedAt = now;
    return usd;
  } catch (error) {
    if (allowStaleOnFailure && cachedCkbUsdPrice !== null) {
      return cachedCkbUsdPrice;
    }

    throw error;
  }
}
