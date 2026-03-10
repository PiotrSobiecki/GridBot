import UserSettings from "../models/UserSettings.js";

/**
 * Zwraca wybraną giełdę dla portfela (domyślnie "asterdex").
 * Normalizuje wartości tak, żeby aplikacja widziała tylko "asterdex" lub "bingx".
 */
export async function getExchangeForWallet(walletAddress) {
  if (!walletAddress) {
    return "asterdex";
  }

  try {
    const settings = await UserSettings.findOne({
      walletAddress: walletAddress.toLowerCase(),
    });

    const exchange = settings?.exchange || "asterdex";
    return exchange === "bingx" ? "bingx" : "asterdex";
  } catch (e) {
    console.warn(
      `⚠️ ExchangeConfigService: failed to get exchange for wallet=${walletAddress}:`,
      e.message,
    );
    return "asterdex";
  }
}

export default {
  getExchangeForWallet,
};
