import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  LogOut,
  Settings,
  TrendingUp,
  Wallet,
  Activity,
  DollarSign,
  BarChart3,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { useStore } from "../store/useStore";
import { api } from "../api";
import OrderTabs from "./OrderTabs";
import OrderSettings from "./OrderSettings";
import PriceDisplay from "./PriceDisplay";
import PositionsTable from "./PositionsTable";
import WalletPanel from "./WalletPanel";
import SettingsApiPanel from "./SettingsApiPanel";
import type { OrderSettings as OrderSettingsType } from "../types";

const defaultOrder: Omit<OrderSettingsType, "_id"> = {
  name: "Nowe Zlecenie",
  isActive: false,
  refreshInterval: 30, // 30 sekund
  minProfitPercent: 0.5,
  focusPrice: 0, // Będzie ustawione na aktualną cenę przy tworzeniu
  exchange: "asterdex", // Domyślnie AsterDex, będzie nadpisane przy tworzeniu
  timeToNewFocus: 0,
  buyTrendCounter: 0,
  sellTrendCounter: 0,
  baseAsset: "BTC",
  // Na spocie jako stable używamy USDT
  quoteAsset: "USDT",
  buy: {
    // Stable do kupna: USDT
    currency: "USDT",
    walletProtection: 0,
    mode: "walletLimit",
    maxValue: 0,
    addProfit: false,
  },
  sell: {
    currency: "BTC",
    walletProtection: 0,
    mode: "walletLimit",
    maxValue: 0,
    addProfit: false,
  },
  platform: {
    // Minimalna wartość transakcji dla UI.
    // Backend i tak pilnuje twardego minimum giełdy (5 USDT),
    // więc tutaj ustawiamy sensowny domyślny próg = 5.
    minTransactionValue: 0,
    checkFeeProfit: true,
  },
  buyConditions: {
    minValuePer1Percent: 20, // 20 USD
    priceThreshold: 0, // Progi na 0
    checkThresholdIfProfitable: true,
  },
  sellConditions: {
    minValuePer1Percent: 20, // 20 USD
    priceThreshold: 0, // Progi na 0
    checkThresholdIfProfitable: true,
  },
  trendPercents: [
    { trend: 0, buyPercent: 0.5, sellPercent: 0.5 },
    { trend: 1, buyPercent: 1, sellPercent: 1 },
    { trend: 2, buyPercent: 0.6, sellPercent: 0.3 },
    { trend: 5, buyPercent: 0.5, sellPercent: 0.5 },
    { trend: 10, buyPercent: 0.1, sellPercent: 1 },
  ],
  additionalBuyValues: [], // Puste
  additionalSellValues: [], // Puste
  maxBuyPerTransaction: [], // Puste
  maxSellPerTransaction: [], // Puste
  buySwingPercent: [], // Puste
  sellSwingPercent: [], // Puste
};

export default function Dashboard() {
  const {
    walletAddress,
    userSettings,
    activeOrderIndex,
    setActiveOrderIndex,
    setUserSettings,
    setGridState,
    gridStates,
    logout,
    positions,
  } = useStore();

  const [showWallet, setShowWallet] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [apiProfile, setApiProfile] = useState<{
    name?: string;
    avatar?: string;
    hasKeys?: boolean;
    exchange?: "asterdex" | "bingx";
  } | null>(null);

  const orders = userSettings?.orders || [];
  // Użyj useMemo żeby activeOrder reagował na zmiany w orders (np. po zapisaniu)
  // Tworzymy nowy obiekt żeby React wykrył zmianę referencji
  const activeOrder = useMemo(() => {
    const order = orders[activeOrderIndex];
    if (!order) return undefined;
    // Zwróć nowy obiekt - React wykryje zmianę referencji gdy orders się zmieni
    return { ...order };
  }, [orders, activeOrderIndex]);
  const activeGridState = activeOrder?._id ? gridStates[activeOrder._id] : null;

  // Trend i liczba otwartych pozycji long/short dla aktywnego zlecenia
  const activeOrderId = activeOrder?._id || (activeOrder as any)?.id;
  const activeOrderPositions = activeOrderId
    ? positions[activeOrderId] || []
    : [];
  const openBuyPositions = activeOrderPositions.filter(
    (p) => (p.type === "BUY" || !p.type) && p.status === "OPEN",
  );
  const openSellPositions = activeOrderPositions.filter(
    (p) => p.type === "SELL" && p.status === "OPEN",
  );

  // Aktualny trend = trendAtBuy ostatniej otwartej pozycji (jeśli są),
  // w przeciwnym razie fallback do licznika z GridState.
  const latestBuyTrend =
    openBuyPositions.length > 0
      ? (openBuyPositions.reduce((last, p) => {
          return p.createdAt &&
            (!last.createdAt || p.createdAt > last.createdAt)
            ? p
            : last;
        }).trendAtBuy ?? 0)
      : (activeGridState?.buyTrendCounter ?? activeOrder?.buyTrendCounter ?? 0);

  const latestSellTrend =
    openSellPositions.length > 0
      ? (openSellPositions.reduce((last, p) => {
          return p.createdAt &&
            (!last.createdAt || p.createdAt > last.createdAt)
            ? p
            : last;
        }).trendAtBuy ?? 0)
      : (activeGridState?.sellTrendCounter ??
        activeOrder?.sellTrendCounter ??
        0);

  // Reset activeOrderIndex jeśli aktualne zlecenie nie istnieje (np. po zmianie giełdy)
  useEffect(() => {
    if (orders.length > 0 && activeOrderIndex >= orders.length) {
      setActiveOrderIndex(0);
    } else if (orders.length === 0 && activeOrderIndex !== 0) {
      setActiveOrderIndex(0);
    }
  }, [orders.length, activeOrderIndex, setActiveOrderIndex]);

  useEffect(() => {
    const loadApiProfile = async () => {
      try {
        // Pobierz aktualną giełdę i dane API
        const [apiData, settings] = await Promise.all([
          api.getApiSettings(),
          api.getSettings(),
        ]);

        const currentExchange = settings?.exchange || "asterdex";
        const exchangeData =
          currentExchange === "bingx" ? apiData?.bingx : apiData?.aster;

        if (exchangeData) {
          const next = {
            name: exchangeData.name,
            avatar: exchangeData.avatar,
            hasKeys: !!exchangeData.hasKeys,
            exchange: currentExchange as "asterdex" | "bingx",
          };
          setApiProfile(next);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(
              "gridbot_api_profile",
              JSON.stringify(next),
            );
          }
        }
      } catch (e) {
        // cicho ignoruj
      }
    };
    loadApiProfile();
  }, [userSettings?.exchange]); // Odśwież gdy zmieni się giełda

  // Odśwież zlecenia gdy zmieni się giełda
  useEffect(() => {
    if (!walletAddress) return;

    const refreshOrders = async () => {
      try {
        const updatedSettings = await api.getSettings();
        setUserSettings(updatedSettings);
        console.log(
          `🔄 Refreshed orders after exchange change: ${updatedSettings.orders?.length || 0} orders for ${updatedSettings.exchange}`,
        );
      } catch (e) {
        console.error("Failed to refresh orders after exchange change:", e);
      }
    };

    refreshOrders();
  }, [walletAddress, userSettings?.exchange, setUserSettings]);

  // Po starcie pobierz wszystkie stany GRID z backendu,
  // żeby zakładki znały realny isActive nawet po odświeżeniu strony.
  useEffect(() => {
    if (!walletAddress) return;

    const loadAllGridStates = async () => {
      try {
        const states = await api.getGridStates(walletAddress);
        if (Array.isArray(states)) {
          states.forEach((s: any) => {
            if (s && s.orderId) {
              setGridState(s.orderId, s);
            }
          });
        }
      } catch (e) {
        // cicho ignoruj, jeśli endpoint niedostępny
      }
    };

    loadAllGridStates();
  }, [walletAddress, setGridState]);
  // Pobieranie cen: co min(refreshInterval) ze wszystkich zleceń (przy 30s i 60s → co 30s)
  const allIntervals = orders
    .map((o) => Number(o?.refreshInterval) || 5)
    .filter((s) => s > 0);
  const priceRefreshIntervalMs =
    (allIntervals.length > 0 ? Math.min(...allIntervals) : 5) * 1000;
  // Stan gridu aktywnego zlecenia: co refreshInterval tego zlecenia
  const gridRefreshIntervalMs =
    (activeOrder?.refreshInterval ?? orders[0]?.refreshInterval ?? 5) * 1000;

  useEffect(() => {
    // Fetch prices – co refreshInterval sekund (zgodnie z ustawieniem na froncie)
    // Użyj walletAddress żeby backend wiedział z której giełdy pobrać ceny
    const fetchPrices = async () => {
      try {
        const priceData = await api.getPrices(walletAddress);
        Object.entries(priceData as Record<string, any>).forEach(
          ([symbol, data]) => {
            let numPrice: number;
            let changePercent: number | null = null;

            if (typeof data === "object" && data !== null && "price" in data) {
              numPrice =
                typeof data.price === "string"
                  ? parseFloat(data.price)
                  : Number(data.price);
              changePercent =
                data.priceChangePercent != null
                  ? Number(data.priceChangePercent)
                  : null;
            } else {
              numPrice =
                typeof data === "string" ? parseFloat(data) : Number(data);
            }

            if (!isNaN(numPrice) && numPrice > 0) {
              useStore.getState().updatePrice(symbol, numPrice, changePercent);
            }
          },
        );
      } catch (error) {
        console.error("Failed to fetch prices:", error);
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, priceRefreshIntervalMs);
    return () => clearInterval(interval);
  }, [priceRefreshIntervalMs, walletAddress]);

  // Odśwież stan gridu aktywnego zlecenia – co refreshInterval tego zlecenia
  useEffect(() => {
    if (!walletAddress || !activeOrder?._id) return;

    const refreshGridState = async () => {
      try {
        const state = await api.getGridState(
          walletAddress,
          activeOrder._id || "",
        );
        if (state) setGridState(activeOrder._id || "", state);
      } catch (err) {
        // cicho ignoruj (np. grid jeszcze nie istnieje)
      }
    };

    refreshGridState();
    const interval = setInterval(refreshGridState, gridRefreshIntervalMs);
    return () => clearInterval(interval);
  }, [walletAddress, activeOrder?._id, setGridState, gridRefreshIntervalMs]);

  const handleAddOrder = async () => {
    try {
      setIsLoading(true);
      // Przypisz aktualną giełdę do nowego zlecenia
      const currentExchange = userSettings?.exchange || "asterdex";

      // Pobierz aktualną cenę dla baseAsset (np. BTCUSDT)
      const baseAsset = defaultOrder.baseAsset || "BTC";
      const quoteAsset = defaultOrder.quoteAsset || "USDT";
      const symbol = `${baseAsset}${quoteAsset}`;
      let currentPrice = useStore.getState().prices[symbol]?.price || 0;

      // Jeśli cena nie jest w store, spróbuj pobrać z API
      if (!currentPrice && walletAddress) {
        try {
          const priceData = await api.getPrices(walletAddress);
          const priceInfo = priceData[symbol];
          if (priceInfo) {
            currentPrice =
              typeof priceInfo === "object" &&
              priceInfo !== null &&
              "price" in priceInfo
                ? typeof priceInfo.price === "string"
                  ? parseFloat(priceInfo.price)
                  : Number(priceInfo.price)
                : typeof priceInfo === "string"
                  ? parseFloat(priceInfo)
                  : Number(priceInfo);
          }
        } catch (e) {
          console.warn(`Failed to fetch price for ${symbol}:`, e);
        }
      }

      const newOrder = await api.createOrder({
        ...defaultOrder,
        name: `Zlecenie ${orders.length + 1}`,
        exchange: currentExchange, // Przypisz aktualną giełdę
        focusPrice: currentPrice || 0, // Ustaw aktualną cenę jako focusPrice
      });

      if (userSettings) {
        setUserSettings({
          ...userSettings,
          orders: [...userSettings.orders, newOrder],
        });
        setActiveOrderIndex(orders.length);
      }
      toast.success("Dodano nowe zlecenie");
    } catch (error: any) {
      toast.error(error.message || "Błąd dodawania zlecenia");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuplicateOrder = async () => {
    if (!activeOrder || !userSettings) return;
    try {
      setIsLoading(true);
      const { _id, id, ...rest } = activeOrder as any;
      // Zachowaj giełdę z oryginalnego zlecenia lub użyj aktualnej
      const currentExchange = userSettings?.exchange || "asterdex";
      const copy = {
        ...rest,
        name: `Kopia: ${activeOrder.name}`,
        isActive: false,
        buyTrendCounter: 0,
        sellTrendCounter: 0,
        exchange: rest.exchange || currentExchange, // Zachowaj giełdę z oryginału lub użyj aktualnej
      };
      const newOrder = await api.createOrder(copy);

      if (userSettings) {
        setUserSettings({
          ...userSettings,
          orders: [...userSettings.orders, newOrder],
        });
        setActiveOrderIndex(orders.length);
      }
      toast.success("Zduplikowano zlecenie");
    } catch (error: any) {
      toast.error(error.message || "Błąd duplikowania zlecenia");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      logout();
      toast.success("Wylogowano");
    } catch (error) {
      logout();
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatPrice = (v: number | undefined | null) =>
    v != null && !Number.isNaN(v)
      ? "$" +
        Number(v).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "—";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-grid-border bg-grid-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 md:gap-0">
            {/* Lewa: tylko logo */}
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Zap className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
              </div>
              <span className="font-display font-bold text-lg sm:text-xl">
                GridBot
              </span>
            </div>

            {/* Środek: pasek cen (marginesy od logo i od prawego bloku) */}
            <div className="hidden md:block flex-1 min-w-0 ml-40 mr-2">
              <PriceDisplay />
            </div>

            {/* Prawa: awatar, ustawienia, adres portfela, wylogowanie */}
            <div className="flex items-center gap-2 sm:gap-4 w-full md:w-auto justify-end">
              {apiProfile && (
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-grid-border bg-black/20">
                  <div className="w-7 h-7 rounded-full bg-black/40 border border-grid-border flex items-center justify-center overflow-hidden">
                    {apiProfile.avatar &&
                    (apiProfile.avatar.startsWith("http") ||
                      apiProfile.avatar.startsWith("data:")) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={apiProfile.avatar}
                        alt="avatar"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-gray-400 font-semibold">
                        {(apiProfile.name || "Aster")[0]?.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-300">
                      {apiProfile.name ||
                        (apiProfile.exchange === "bingx"
                          ? "Konto BingX"
                          : "Konto Aster")}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {apiProfile.hasKeys ? "Klucze zapisane" : "Brak kluczy"}
                      {apiProfile.exchange && (
                        <span className="ml-1 text-gray-600">
                          (
                          {apiProfile.exchange === "bingx"
                            ? "BingX"
                            : "AsterDex"}
                          )
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )}
              <button
                onClick={() => setShowApiSettings(true)}
                className="p-2 rounded-lg hover:bg-grid-card transition-colors text-gray-400 hover:text-white"
                title={`Ustawienia API (${apiProfile?.exchange === "bingx" ? "BingX" : "AsterDex"})`}
              >
                <Settings className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowWallet(!showWallet)}
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-grid-card border border-grid-border hover:border-emerald-500/50 transition-colors"
              >
                <Wallet className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-400" />
                <span className="font-mono text-xs sm:text-sm hidden sm:inline">
                  {formatAddress(walletAddress || "")}
                </span>
                <span className="font-mono text-xs sm:hidden">
                  {walletAddress
                    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
                    : ""}
                </span>
              </button>
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg hover:bg-grid-card transition-colors text-gray-400 hover:text-white"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-2 sm:px-4 py-4 sm:py-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-6">
          {/* Left Sidebar - Order Tabs */}
          <div className="col-span-1 md:col-span-2 order-1 md:order-1">
            <div className="bg-grid-card rounded-xl border border-grid-border p-3 sm:p-4 sticky top-16 md:top-24">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-300">Zlecenia</h2>
                <button
                  onClick={handleAddOrder}
                  disabled={isLoading}
                  className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <OrderTabs
                orders={orders}
                activeIndex={activeOrderIndex}
                onSelect={setActiveOrderIndex}
                gridStates={gridStates}
              />
            </div>
          </div>

          {/* Main Content Area */}
          <div className="col-span-1 md:col-span-7 space-y-4 sm:space-y-6 order-2 md:order-2">
            {/* Stats Overview */}
            {activeOrder && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3 sm:space-y-4"
              >
                {/* Główne statystyki */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
                  <StatCard
                    icon={TrendingUp}
                    label="Trend Zakup"
                    value={latestBuyTrend}
                    color="emerald"
                    subtitle={`Otwarte: ${openBuyPositions.length}`}
                  />
                  <StatCard
                    icon={BarChart3}
                    label="Trend Sprzedaż"
                    value={latestSellTrend}
                    color="red"
                    subtitle={`Otwarte: ${openSellPositions.length}`}
                  />
                  <StatCard
                    icon={DollarSign}
                    label="Cena Focus"
                    value={formatPrice(
                      activeGridState?.currentFocusPrice ??
                        activeOrder.focusPrice,
                    )}
                    color="amber"
                    subtitle={
                      activeGridState != null
                        ? "Aktualna w gridzie (z algorytmu)"
                        : ""
                    }
                  />
                  <StatCard
                    icon={Activity}
                    label="Całkowity Profit"
                    value={formatPrice(activeGridState?.totalProfit ?? 0)}
                    color={
                      activeGridState?.totalProfit &&
                      activeGridState.totalProfit > 0
                        ? "emerald"
                        : "gray"
                    }
                    subtitle={`${
                      (activeGridState?.totalBuyTransactions ?? 0) +
                      (activeGridState?.totalSellTransactions ?? 0)
                    } transakcji`}
                  />
                </div>

                {/* Cele cenowe */}
                {activeGridState && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-grid-card rounded-xl border border-emerald-500/30 p-3 sm:p-4">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] sm:text-xs text-gray-500">
                            Następny cel ZAKUPU
                          </div>
                          <div className="text-lg sm:text-xl font-mono font-bold text-emerald-400 truncate">
                            {formatPrice(activeGridState.nextBuyTarget)}
                          </div>
                        </div>
                        <div className="text-left sm:text-right w-full sm:w-auto">
                          <div className="text-[10px] sm:text-xs text-gray-500">
                            Próg cenowy
                          </div>
                          <div className="text-xs sm:text-sm font-mono text-gray-400 truncate">
                            {formatPrice(
                              activeOrder.buyConditions.priceThreshold,
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="bg-grid-card rounded-xl border border-red-500/30 p-3 sm:p-4">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] sm:text-xs text-gray-500">
                            Następny cel SPRZEDAŻY
                          </div>
                          <div className="text-lg sm:text-xl font-mono font-bold text-red-400 truncate">
                            {formatPrice(activeGridState.nextSellTarget)}
                          </div>
                        </div>
                        <div className="text-left sm:text-right w-full sm:w-auto">
                          <div className="text-[10px] sm:text-xs text-gray-500">
                            Próg cenowy
                          </div>
                          <div className="text-xs sm:text-sm font-mono text-gray-400 truncate">
                            {formatPrice(
                              activeOrder.sellConditions.priceThreshold,
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* Order Settings */}
            {activeOrder ? (
              <OrderSettings
                order={activeOrder}
                gridState={activeGridState}
                onDuplicate={handleDuplicateOrder}
              />
            ) : (
              <div className="bg-grid-card rounded-xl border border-grid-border p-12 text-center">
                <Settings className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                <h3 className="text-xl font-semibold mb-2">Brak zleceń</h3>
                <p className="text-gray-500 mb-6">
                  Dodaj pierwsze zlecenie, aby rozpocząć trading
                </p>
                <button
                  onClick={handleAddOrder}
                  className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold transition-colors"
                >
                  <Plus className="w-5 h-5 inline mr-2" />
                  Dodaj Zlecenie
                </button>
              </div>
            )}

            {/* Positions Table */}
            {activeOrder && <PositionsTable orderId={activeOrder._id || ""} />}
          </div>

          {/* Right Sidebar - Wallet */}
          <div className="col-span-1 md:col-span-3 order-3 md:order-3">
            <AnimatePresence>
              {showWallet && (
                <WalletPanel onClose={() => setShowWallet(false)} />
              )}
            </AnimatePresence>

            {!showWallet && (
              <div className="bg-grid-card rounded-xl border border-grid-border p-3 sm:p-4 sticky top-16 md:top-24">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-400" />
                  Portfel
                </h3>
                <div className="space-y-3">
                  {userSettings?.wallet.slice(0, 4).map((item) => (
                    <div
                      key={item.currency}
                      className="flex justify-between items-center"
                    >
                      <span className="text-gray-400">{item.currency}</span>
                      <span className="font-mono">
                        {item.balance.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setShowWallet(true)}
                  className="w-full mt-4 py-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Zobacz wszystko →
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
      {showApiSettings && (
        <SettingsApiPanel
          onClose={() => setShowApiSettings(false)}
          onChanged={(data) => {
            setApiProfile(data);
            if (typeof window !== "undefined") {
              window.localStorage.setItem(
                "gridbot_api_profile",
                JSON.stringify(data),
              );
            }
          }}
        />
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  subtitle,
}: {
  icon: any;
  label: string;
  value: string | number;
  color: string;
  subtitle?: string;
}) {
  const colorClasses: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/10",
    blue: "text-blue-400 bg-blue-500/10",
    amber: "text-amber-400 bg-amber-500/10",
    red: "text-red-400 bg-red-500/10",
    gray: "text-gray-400 bg-gray-500/10",
  };

  return (
    <div className="bg-grid-card rounded-xl border border-grid-border p-3 sm:p-4">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className={`p-1.5 sm:p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] sm:text-xs text-gray-500 truncate">
            {label}
          </div>
          <div className="font-mono font-semibold text-sm sm:text-base truncate">
            {value}
          </div>
          {subtitle && (
            <div className="text-[10px] sm:text-xs text-gray-600 mt-0.5 truncate">
              {subtitle}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
