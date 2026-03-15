import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Wallet, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { useStore } from "../store/useStore";
import { api } from "../api";
import type { WalletBalance } from "../types";

const useWalletStore = () =>
  useStore((state) => ({
    walletAddress: state.walletAddress,
    userSettings: state.userSettings,
    prices: state.prices,
    setUserSettings: state.setUserSettings,
  }));

interface WalletPanelProps {
  onClose: () => void;
}

const getCurrencyIconUrl = (symbol: string): string => {
  const s = symbol.toUpperCase();
  switch (s) {
    case "BTC":
      return "https://cryptologos.cc/logos/bitcoin-btc-logo.svg?v=032";
    case "ETH":
      return "https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=032";
    case "USDT":
      return "https://cryptologos.cc/logos/tether-usdt-logo.svg?v=032";
    case "XRP":
      return "https://cryptologos.cc/logos/xrp-xrp-logo.svg?v=032";
    case "SOL":
      return "https://cryptologos.cc/logos/solana-sol-logo.svg?v=032";
    case "USDC":
      return "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=032";
    case "ASTER":
      return "https://assets.coingecko.com/coins/images/69040/standard/_ASTER.png?1757326782";
    default:
      // Dla wszystkich pozostałych krypto (BingX i inne) pobierz ikonę z bb-os.com
      // CurrencyIconWithFallback obsłuży błąd (pokaże litery) jeśli ikona nie istnieje
      return `https://static-app.bb-os.com/icon/${s}.png`;
  }
};

/** Ikonka waluty z fallbackiem na literki gdy obrazek się nie załaduje */
function CurrencyIconWithFallback({
  iconUrl,
  currency,
  fallbackClass,
}: {
  iconUrl: string;
  currency: string;
  fallbackClass: string;
}) {
  const [failed, setFailed] = useState(false);
  const baseClass =
    "w-full h-full flex items-center justify-center text-xs font-bold";
  if (failed) {
    return (
      <div className={`${baseClass} ${fallbackClass}`}>
        {currency.slice(0, 3)}
      </div>
    );
  }
  return (
    <img
      src={iconUrl}
      alt=""
      className="w-full h-full object-contain"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export default function WalletPanel({ onClose }: WalletPanelProps) {
  const { userSettings, setUserSettings, walletAddress, prices } =
    useWalletStore();
  const [localWallet, setLocalWallet] = useState<WalletBalance[]>(
    userSettings?.wallet || [],
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!walletAddress) return;
    setIsRefreshing(true);
    try {
      const rawBalances = await api.refreshWallet();
      const wallet: WalletBalance[] = Object.entries(rawBalances).map(
        ([currency, balance]) => ({
          currency,
          balance: parseFloat(balance as string) || 0,
          reserved: 0,
        }),
      );
      setLocalWallet(wallet);
      if (userSettings) {
        setUserSettings({ ...userSettings, wallet });
      }
      toast.success("Odświeżono portfel z giełdy");
    } catch (error: any) {
      console.error("Failed to refresh wallet:", error);
      toast.error(error.message || "Nie udało się odświeżyć portfela");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Przy otwarciu panelu pobierz aktualne salda z AsterDex SPOT
  useEffect(() => {
    const loadBalances = async () => {
      try {
        if (!walletAddress) return;

        const rawBalances = await api.getWalletBalances();

        const wallet: WalletBalance[] = Object.entries(rawBalances).map(
          ([currency, balance]) => ({
            currency,
            balance: parseFloat(balance as string) || 0,
            reserved: 0,
          }),
        );

        setLocalWallet(wallet);

        if (userSettings) {
          setUserSettings({ ...userSettings, wallet });
        }
      } catch (error) {
        console.error("Failed to load Aster wallet balances:", error);
      }
    };

    loadBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);


  // Precyzja wyświetlania sald: BTC/ETH mają małe ilości (wiele zer po przecinku)
  const formatBalance = (currency: string, balance: number): string => {
    const cur = currency.toUpperCase();
    if (balance === 0) return "0";
    if (cur === "USDT" || cur === "USDC" || cur === "BUSD") {
      return balance.toLocaleString("pl-PL", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    if (cur === "BTC") {
      return balance.toLocaleString("pl-PL", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 8,
      });
    }
    if (cur === "ETH" || cur === "BNB") {
      return balance.toLocaleString("pl-PL", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 8,
      });
    }
    if (balance < 1) {
      return balance.toLocaleString("pl-PL", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6,
      });
    }
    return balance.toLocaleString("pl-PL", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    });
  };

  // Wartość w USD dla danej waluty i ilości (do wyświetlania „grubszej” ceny)
  const getUsdValue = (currency: string, balance: number): number | null => {
    const cur = currency.toUpperCase();
    if (balance === 0) return 0;
    if (cur === "USDT" || cur === "USDC" || cur === "BUSD") return balance;
    const symbol = `${cur}USDT`;
    const priceEntry = prices[symbol];
    const price =
      typeof priceEntry?.price === "number"
        ? priceEntry.price
        : Number(priceEntry?.price ?? 0);
    if (price <= 0) return null;
    return balance * price;
  };

  const getTotalValue = () => {
    let total = 0;
    for (const item of localWallet) {
      const usd = getUsdValue(item.currency, item.balance ?? 0);
      if (usd != null) total += usd;
    }
    return total;
  };

  const formatUsd = (v: number) =>
    "$" +
    v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // Sortuj waluty malejąco po wartości w USD
  const MIN_USD_DISPLAY = 0.1;

  const displayWallet = [...localWallet]
    .filter((item) => {
      const usd = getUsdValue(item.currency, item.balance ?? 0) ?? 0;
      return usd >= MIN_USD_DISPLAY;
    })
    .sort((a, b) => {
      const va = getUsdValue(a.currency, a.balance ?? 0) ?? 0;
      const vb = getUsdValue(b.currency, b.balance ?? 0) ?? 0;
      return vb - va;
    });

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="bg-grid-card rounded-xl border border-grid-border sticky top-24"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-grid-border">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-emerald-400" />
          <h3 className="font-semibold">Portfel</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 rounded-lg hover:bg-grid-bg text-gray-400 hover:text-emerald-400 transition-colors"
            title="Odśwież z giełdy"
          >
            <RefreshCw
              className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-grid-bg text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Total Value */}
      <div className="p-4 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border-b border-grid-border">
        <div className="text-xs text-gray-500 mb-1">Szacowana wartość</div>
        <div className="text-2xl font-bold font-mono">
          $
          {getTotalValue().toLocaleString(undefined, {
            minimumFractionDigits: 2,
          })}
        </div>
      </div>

      {/* Balances */}
      <div className="p-4 space-y-3">
        {displayWallet.map((item, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-3 rounded-lg"
          >
            <>
              <>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-grid-bg border border-grid-border flex items-center justify-center">
                    {(() => {
                      const cur = item.currency.toUpperCase();
                      const cls =
                        cur === "BTC"
                          ? "bg-orange-500/20 text-orange-400"
                          : cur === "ETH"
                            ? "bg-indigo-500/20 text-indigo-300"
                            : cur === "USDT"
                              ? "bg-green-500/20 text-green-400"
                              : cur === "BNB"
                                ? "bg-yellow-500/20 text-yellow-300"
                                : cur === "XRP"
                                  ? "bg-slate-500/20 text-slate-200"
                                  : cur === "SOL"
                                    ? "bg-fuchsia-500/20 text-fuchsia-300"
                                    : cur === "ASTER"
                                      ? "bg-emerald-500/20 text-emerald-300"
                                      : "bg-gray-500/20 text-gray-400";
                      return (
                        <CurrencyIconWithFallback
                          iconUrl={getCurrencyIconUrl(cur)}
                          currency={cur}
                          fallbackClass={cls}
                        />
                      );
                    })()}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{item.currency}</div>
                    {item.reserved > 0 && (
                      <div className="text-xs text-gray-500">
                        Zarezerwowano: {item.reserved}
                      </div>
                    )}
                  </div>
                </div>
                <div className="font-mono text-right">
                  <div className="text-base font-semibold">
                    {getUsdValue(item.currency, item.balance) != null
                      ? formatUsd(getUsdValue(item.currency, item.balance)!)
                      : formatBalance(item.currency, item.balance)}
                  </div>
                  <div className="text-xs text-gray-500">
                    Dostępne:{" "}
                    {formatBalance(item.currency, item.balance - item.reserved)}
                  </div>
                </div>
              </>
            </>
          </div>
        ))}
      </div>

      {/* Info */}
      <div className="p-4 border-t border-grid-border text-xs text-gray-500">
        <p>💡 Wartości portfela pobierane są z giełdy.</p>
      </div>
    </motion.div>
  );
}
