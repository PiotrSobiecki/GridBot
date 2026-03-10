import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  Save,
  Trash2,
  Copy,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Settings2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  Activity,
} from "lucide-react";
import toast from "react-hot-toast";
import { useStore } from "../store/useStore";
import { api } from "../api";
import type { OrderSettings as OrderSettingsType, GridState } from "../types";

interface OrderSettingsProps {
  order: OrderSettingsType;
  gridState: GridState | null;
  onDuplicate?: () => void;
}

type Section =
  | "general"
  | "buy"
  | "sell"
  | "conditions"
  | "trend"
  | "thresholds"
  | "advanced";

export default function OrderSettings({
  order,
  gridState,
  onDuplicate,
}: OrderSettingsProps) {
  const {
    walletAddress,
    setUserSettings,
    userSettings,
    setGridState,
    prices,
    gridStates,
  } = useStore((state) => ({
    walletAddress: state.walletAddress,
    setUserSettings: state.setUserSettings,
    userSettings: state.userSettings,
    setGridState: state.setGridState,
    prices: state.prices,
    gridStates: state.gridStates,
  }));
  const [localOrder, setLocalOrder] = useState(order);
  const [expandedSections, setExpandedSections] = useState<Set<Section>>(
    new Set(["general"]),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteFinalConfirm, setShowDeleteFinalConfirm] = useState(false);
  // Lista dostępnych krypto BASE / QUOTE – domyślnie kilka sensownych par,
  // ale docelowo ładowana z backendu (exchangeInfo).
  const [baseAssets, setBaseAssets] = useState<string[]>([
    "BTC",
    "ETH",
    "BNB",
    "ASTER",
  ]);
  // Na Aster spot jako stable obsługujemy głównie USDT
  const [quoteAssets, setQuoteAssets] = useState<string[]>(["USDT"]);

  // Synchronizuj localOrder z prop order (np. przy przełączeniu zakładki)
  useEffect(() => {
    setLocalOrder(order);
  }, [
    order?._id,
    order?.focusPrice,
    order?.refreshInterval,
    order?.name,
    order?.baseAsset,
    order?.quoteAsset,
  ]);

  // Utrzymuj spójność walut kupna/sprzedaży z wybraną parą BASE/QUOTE
  // Tylko jeśli baseAsset/quoteAsset są ustawione i różne od sell/buy.currency
  useEffect(() => {
    setLocalOrder((prev) => {
      if (!prev) return prev;
      let changed = false;
      const next: any = { ...prev };

      // Synchronizuj sell.currency z baseAsset tylko jeśli baseAsset jest ustawione
      if (prev.baseAsset && prev.sell?.currency !== prev.baseAsset) {
        next.sell = { ...prev.sell, currency: prev.baseAsset };
        changed = true;
      }
      // Jeśli baseAsset nie jest ustawione, ale sell.currency jest, użyj go jako baseAsset
      else if (
        !prev.baseAsset &&
        prev.sell?.currency &&
        baseAssets.includes(prev.sell.currency)
      ) {
        next.baseAsset = prev.sell.currency;
        changed = true;
      }

      // Synchronizuj buy.currency z quoteAsset tylko jeśli quoteAsset jest ustawione
      if (prev.quoteAsset && prev.buy?.currency !== prev.quoteAsset) {
        next.buy = { ...prev.buy, currency: prev.quoteAsset };
        changed = true;
      }
      // Jeśli quoteAsset nie jest ustawione, ale buy.currency jest, użyj go jako quoteAsset
      else if (
        !prev.quoteAsset &&
        prev.buy?.currency &&
        quoteAssets.includes(prev.buy.currency)
      ) {
        next.quoteAsset = prev.buy.currency;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [
    localOrder.baseAsset,
    localOrder.quoteAsset,
    localOrder.sell?.currency,
    localOrder.buy?.currency,
  ]);

  // Ładuj listę par z backendu (exchangeInfo) – fallback do domyślnej listy przy błędzie.
  // Odśwież także przy zmianie giełdy w ustawieniach użytkownika.
  useEffect(() => {
    api
      .getAsterSymbols()
      .then((data) => {
        if (Array.isArray(data.baseAssets) && data.baseAssets.length > 0) {
          setBaseAssets(data.baseAssets);
        }
        if (Array.isArray(data.quoteAssets) && data.quoteAssets.length > 0) {
          setQuoteAssets(data.quoteAssets);
        }
      })
      .catch((err: any) => {
        console.error("Failed to load symbols:", err);
        toast.error("Nie udało się pobrać listy par z giełdy");
      });
  }, [userSettings?.exchange]);

  // Jeśli po zmianie giełdy aktualny baseAsset nie jest już na liście dostępnych,
  // ustaw pierwszy dostępny (żeby nie zostawał symbol z poprzedniej giełdy).
  useEffect(() => {
    if (!localOrder || baseAssets.length === 0) return;
    if (!localOrder.baseAsset) return;

    if (!baseAssets.includes(localOrder.baseAsset)) {
      setLocalOrder((prev) =>
        prev
          ? {
              ...prev,
              baseAsset: baseAssets[0],
              sell: { ...(prev.sell || {}), currency: baseAssets[0] },
            }
          : prev,
      );
    }
  }, [userSettings?.exchange, baseAssets]);

  const toggleSection = (section: Section) => {
    const newSections = new Set(expandedSections);
    if (newSections.has(section)) {
      newSections.delete(section);
    } else {
      newSections.add(section);
    }
    setExpandedSections(newSections);
  };

  const updateField = (path: string, value: any) => {
    const keys = path.split(".");
    const newOrder = { ...localOrder } as any;
    let current = newOrder;

    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = { ...current[keys[i]] };
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;

    setLocalOrder(newOrder);
  };

  // Jednolity format cen jak w "Stan algorytmu w czasie rzeczywistym": $X,XXX.XX
  const formatPrice = (n: number | null | undefined): string => {
    if (n == null || Number.isNaN(n)) return "—";
    return `$${Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const handleSave = async () => {
    if (!order._id) return;

    setIsSaving(true);
    try {
      // Sanitizacja pól, które mogą mieć chwilowo pusty string z inputów
      const sanitizedOrder: any = {
        ...localOrder,
        buyConditions: {
          ...localOrder.buyConditions,
          minValuePer1Percent: Number(
            (localOrder.buyConditions as any).minValuePer1Percent || 0,
          ),
          priceThreshold: Number(
            (localOrder.buyConditions as any).priceThreshold || 0,
          ),
        },
        sellConditions: {
          ...localOrder.sellConditions,
          minValuePer1Percent: Number(
            (localOrder.sellConditions as any).minValuePer1Percent || 0,
          ),
          priceThreshold: Number(
            (localOrder.sellConditions as any).priceThreshold || 0,
          ),
        },
      };

      await api.updateOrder(order._id, sanitizedOrder);

      // Pobierz świeże dane z backendu po zapisaniu
      const freshSettings = await api.getSettings();
      if (freshSettings) {
        setUserSettings(freshSettings);
        // Zaktualizuj lokalny stan zlecenia - użyj sanitizedOrder (zapisanego) jako bazę
        const freshOrder = freshSettings.orders?.find(
          (o: any) => (o._id || o.id) === order._id,
        );
        // Aktualizuj localOrder z zapisanymi danymi (sanitizedOrder ma wszystkie pola z formularza)
        const updatedLocalOrder = freshOrder
          ? { ...sanitizedOrder, ...freshOrder, _id: order._id }
          : { ...sanitizedOrder, _id: order._id };
        setLocalOrder(updatedLocalOrder);

        // Odśwież też stan gridu (gridState) żeby "Cena Focus" na górze się zaktualizowała
        if (walletAddress && order._id) {
          try {
            const freshGridState = await api.getGridState(
              order._id,
            );
            if (freshGridState) {
              setGridState(order._id, freshGridState);
            }
          } catch (err) {
            // Cicho ignoruj jeśli grid jeszcze nie istnieje
          }
        }
      } else if (userSettings) {
        // Fallback: aktualizuj lokalnie jeśli pobranie z backendu nie powiodło się
        const updatedOrders = userSettings.orders.map((o) =>
          o._id === order._id ? { ...sanitizedOrder, _id: order._id } : o,
        );
        setUserSettings({ ...userSettings, orders: updatedOrders });
        setLocalOrder({ ...sanitizedOrder, _id: order._id });
      }

      toast.success("Zapisano ustawienia");
    } catch (error: any) {
      toast.error(error.message || "Błąd zapisywania");
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartStop = async () => {
    if (!order._id || !walletAddress) return;

    setIsStarting(true);
    try {
      if (gridState?.isActive) {
        await api.stopGrid(order._id);
        setGridState(order._id, { ...gridState, isActive: false });
        toast.success("Zatrzymano algorytm");
      } else {
        let stateToUpdate: typeof gridState = gridState;
        if (!gridState) {
          const state = await api.initGrid({
            ...localOrder,
            id: order._id,
          });
          setGridState(order._id, state);
          stateToUpdate = state;
        }

        await api.startGrid(order._id);
        setGridState(order._id, { ...stateToUpdate!, isActive: true });
        toast.success("Uruchomiono algorytm");
      }
    } catch (error: any) {
      toast.error(error.message || "Błąd operacji");
    } finally {
      setIsStarting(false);
    }
  };

  const handleDelete = async () => {
    if (!order._id) return;

    try {
      await api.deleteOrder(order._id);

      if (userSettings) {
        const updatedOrders = userSettings.orders.filter(
          (o) => o._id !== order._id,
        );
        setUserSettings({ ...userSettings, orders: updatedOrders });
        useStore
          .getState()
          .setActiveOrderIndex(Math.max(0, updatedOrders.length - 1));
      }

      toast.success("Usunięto zlecenie");
    } catch (error: any) {
      toast.error(error.message || "Błąd usuwania");
    }
  };

  const isRunning = gridState?.isActive ?? false;

  return (
    <div className="bg-grid-card rounded-xl border border-grid-border overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 p-3 sm:p-4 border-b border-grid-border">
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 w-full sm:w-auto">
          <input
            type="text"
            value={localOrder.name}
            onChange={(e) => updateField("name", e.target.value)}
            className="bg-transparent text-base sm:text-lg font-semibold focus:outline-none focus:border-b focus:border-emerald-500 flex-1 min-w-0"
          />
          <span
            className={`px-2 py-1 rounded text-[10px] sm:text-xs font-medium whitespace-nowrap mr-3 ${
              isRunning ? "status-active" : "status-inactive"
            }`}
          >
            {isRunning ? "Aktywny" : "Wstrzymany"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto">
          <button
            onClick={handleStartStop}
            disabled={isStarting}
            className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              isRunning
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
            }`}
          >
            {isRunning ? (
              <>
                <Pause className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Stop</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Start</span>
              </>
            )}
          </button>

          <button
            onClick={() => setShowSaveConfirm(true)}
            disabled={isSaving}
            className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 text-xs sm:text-sm font-medium transition-colors"
          >
            <Save className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Zapisz</span>
          </button>

          {onDuplicate && (
            <button
              onClick={onDuplicate}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-gray-500/20 text-gray-300 hover:bg-gray-500/30 text-xs sm:text-sm font-medium transition-colors"
              title="Duplikuj zlecenie"
            >
              <Copy className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Duplikuj</span>
            </button>
          )}

          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-1.5 sm:p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
          </button>
        </div>
      </div>

      {/* Settings Sections */}
      <div className="divide-y divide-grid-border">
        {/* 1# Ogólne ustawienia */}
        <SettingsSection
          title="Ogólne ustawienia"
          icon={Settings2}
          isExpanded={expandedSections.has("general")}
          onToggle={() => toggleSection("general")}
        >
          <div className="space-y-3 sm:space-y-4">
            {/* Główne ustawienia */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              <InputField
                label="1. Odświeżanie"
                value={localOrder.refreshInterval}
                onChange={(v) => updateField("refreshInterval", Number(v))}
                type="number"
                suffix="sek"
                hint="Co jaki czas zapytania (min. 1 s)"
              />
              <InputField
                label="2. Min zarobek %"
                value={localOrder.minProfitPercent}
                onChange={(v) => updateField("minProfitPercent", Number(v))}
                type="number"
                step="0.1"
                suffix="%"
                hint="Min % zysku do realizacji"
              />
              <div>
                <InputField
                  label="3. Cena Focus"
                  value={localOrder.focusPrice}
                  onChange={(v) => updateField("focusPrice", Number(v))}
                  type="number"
                  suffix="$"
                  hint="Cena bazowa do obliczeń"
                  infoTitle="Focus to cena bazowa, od której liczone są wszystkie kolejne poziomy zakupów i sprzedaży dla tego zlecenia. Po pierwszym zapisaniu Focus jest blokowany, żeby zachować spójność historii pozycji."
                  disabled={!!order._id && localOrder.focusLocked}
                />
                {(() => {
                  const base =
                    localOrder.baseAsset || localOrder.sell?.currency || "";
                  const quote =
                    localOrder.quoteAsset || localOrder.buy?.currency || "USDT";
                  const symbol = `${base}${quote}`;
                  const priceData = prices[symbol];
                  const currentPrice =
                    typeof priceData?.price === "number"
                      ? priceData.price
                      : Number(priceData?.price || 0);
                  const hasPrice = !!base && currentPrice > 0;
                  const isFocusLocked = !!order._id && localOrder.focusLocked;
                  return hasPrice ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (isFocusLocked) {
                          return;
                        }
                        updateField(
                          "focusPrice",
                          Math.round(currentPrice * 100) / 100,
                        );
                        toast.success(
                          `Cena Focus ustawiona na aktualną: $${currentPrice.toLocaleString(
                            undefined,
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )}`,
                        );
                      }}
                      className={`mt-1 text-xs text-emerald-400 hover:text-emerald-300 hover:underline ${
                        isFocusLocked ? "opacity-40 cursor-not-allowed" : ""
                      }`}
                    >
                      Użyj aktualnej ceny
                    </button>
                  ) : null;
                })()}
                <div className="mt-2 flex items-center gap-2">
                  <span className="block text-[10px] sm:text-xs text-gray-500">
                    Blokada Focus
                  </span>
                  <input
                    type="checkbox"
                    checked={localOrder.focusLocked ?? true}
                    onChange={(e) =>
                      updateField("focusLocked", e.target.checked)
                    }
                    className="custom-checkbox"
                  />
                  <button
                    type="button"
                    className="w-4 h-4 rounded-full border border-gray-600 text-[10px] flex items-center justify-center text-gray-400 hover:text-emerald-300 hover:border-emerald-400"
                    title="Po zaznaczeniu cena Focus dla tego zlecenia jest zablokowana i nie może być później zmieniona."
                  >
                    i
                  </button>
                </div>
              </div>
              <InputField
                label="4. Czas do nowego focus"
                value={localOrder.timeToNewFocus}
                onChange={(v) => updateField("timeToNewFocus", Number(v))}
                type="number"
                suffix="sek"
                hint="0 = wyłączone"
              />
            </div>

            {/* Kierunek zleceń: kupno / sprzedaż / oba */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
              <SelectField
                label="5. Kierunek zleceń"
                value={localOrder.tradeMode || "both"}
                options={[
                  { value: "both", label: "Kupno i sprzedaż" },
                  { value: "buyOnly", label: "Tylko kupno (long)" },
                  { value: "sellOnly", label: "Tylko sprzedaż (short)" },
                ]}
                onChange={(v) => updateField("tradeMode", v)}
              />
              <div className="sm:col-span-2 text-[11px] text-gray-500 flex items-center">
                <span>
                  Określa, w których kierunkach algorytm może otwierać nowe
                  pozycje dla tego zlecenia (long, short lub oba).
                </span>
              </div>
            </div>

            {/* Para handlowa */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
              <SelectField
                label="6. Krypto (BASE)"
                value={
                  localOrder.baseAsset || localOrder.sell?.currency || "BTC"
                }
                options={baseAssets}
                onChange={async (v) => {
                  // Ustaw baseAsset i sell.currency jednocześnie
                  // Pobierz aktualną cenę dla nowego krypto
                  const quoteAsset =
                    localOrder.quoteAsset || localOrder.buy?.currency || "USDT";
                  const symbol = `${v}${quoteAsset}`;

                  // Spróbuj pobrać cenę ze store
                  let currentPrice = prices[symbol]?.price || 0;

                  // Jeśli cena nie jest w store, spróbuj pobrać z API
                  if (!currentPrice && walletAddress) {
                    try {
                      const priceData = await api.getPrices();
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

                  setLocalOrder((prev) => {
                    const updated = { ...prev } as any;
                    updated.baseAsset = v;
                    if (currentPrice > 0) {
                      updated.focusPrice = currentPrice;
                    }
                    if (updated.sell) {
                      updated.sell = { ...updated.sell, currency: v };
                    } else {
                      updated.sell = {
                        currency: v,
                        walletProtection: 0,
                        mode: "walletLimit",
                        maxValue: 0,
                        addProfit: false,
                      };
                    }
                    return updated;
                  });
                }}
              />
              <SelectField
                label="7. Stable (QUOTE)"
                value={localOrder.quoteAsset || localOrder.buy.currency}
                options={quoteAssets}
                onChange={async (v) => {
                  const baseAsset =
                    localOrder.baseAsset || localOrder.sell?.currency || "BTC";
                  const symbol = `${baseAsset}${v}`;

                  let currentPrice = prices[symbol]?.price || 0;

                  if (!currentPrice && walletAddress) {
                    try {
                      const priceData = await api.getPrices();
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

                  setLocalOrder((prev) => {
                    const updated = { ...prev } as any;
                    updated.quoteAsset = v;
                    // Aktualizuj focusPrice do aktualnej ceny wybranej pary
                    if (currentPrice > 0) {
                      updated.focusPrice = currentPrice;
                    }
                    if (updated.buy) {
                      updated.buy = { ...updated.buy, currency: v };
                    } else {
                      updated.buy = {
                        currency: v,
                        walletProtection: 0,
                        mode: "walletLimit",
                        maxValue: 0,
                        addProfit: false,
                      };
                    }
                    return updated;
                  });
                }}
              />
              {/* Aktualna cena - nieedytowalne */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  8. Aktualna cena
                </label>
                <div className="w-full px-3 py-2 bg-grid-bg border border-grid-border rounded-lg text-sm font-mono text-gray-200 flex items-center justify-between">
                  <span>
                    {(() => {
                      const baseAsset =
                        localOrder.baseAsset || localOrder.sell.currency || "";
                      const quoteAsset =
                        localOrder.quoteAsset ||
                        localOrder.buy.currency ||
                        "USDT";
                      const symbol = `${baseAsset}${quoteAsset}`;
                      const priceData = prices[symbol];
                      const raw =
                        (priceData as any)?.rawPrice ?? priceData?.price ?? null;

                      if (!baseAsset || raw == null) {
                        return "—";
                      }
                      // W zleceniu pokazujemy dokładnie taką cenę, jaką zwróciło API (łącznie z zerami)
                      return `$${String(raw)}`;
                    })()}
                  </span>
                  <Activity className="w-4 h-4 text-gray-500" />
                </div>
                <div className="text-[11px] text-gray-500 mt-1">
                  Cena dla pary{" "}
                  <strong>
                    {localOrder.baseAsset || localOrder.sell.currency || "—"}/
                    {localOrder.quoteAsset || localOrder.buy.currency || "USDT"}
                  </strong>
                </div>
              </div>
            </div>

            {/* Wyjaśnienie ceny focus */}
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm">
              <p className="text-amber-300 mb-1">
                <strong>Cena Focus</strong> - punkt odniesienia dla obliczeń
              </p>
              <p className="text-gray-400 text-xs">
                Jeżeli aktualna cena osiągnie ten próg, algorytm uruchamia się i
                zaczyna wyliczanie ceny potrzebnej do pierwszej transakcji.
                Focus aktualizuje się przy każdej transakcji.
              </p>
            </div>

            {/* Liczniki trendów - tylko do odczytu */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-500">
                      5. Licznik trendu ZAKUP
                    </div>
                    <div className="text-2xl font-mono font-bold text-emerald-400">
                      {gridState?.buyTrendCounter ?? localOrder.buyTrendCounter}
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <div>0 = brak pozycji</div>
                    <div>N = N otwartych zakupów</div>
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-500">
                      6. Licznik trendu SPRZEDAŻ
                    </div>
                    <div className="text-2xl font-mono font-bold text-red-400">
                      {gridState?.sellTrendCounter ??
                        localOrder.sellTrendCounter}
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <div>0 = brak pozycji</div>
                    <div>N = N otwartych sprzedaży</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Stan aktualny z algorytmu */}
            {gridState && (
              <div className="p-3 rounded-lg bg-grid-bg/50 border border-grid-border">
                <div className="text-xs text-gray-500 mb-2">
                  📊 Stan algorytmu w czasie rzeczywistym:
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 text-xs sm:text-sm">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-gray-500">Następny zakup:</span>
                    <span className="font-mono text-emerald-400">
                      {formatPrice(gridState.nextBuyTarget)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-gray-500">Następna sprzedaż:</span>
                    <span className="font-mono text-red-400">
                      {formatPrice(gridState.nextSellTarget)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-gray-500">Ostatnia cena:</span>
                    <span className="font-mono text-white">
                      {formatPrice(gridState.lastKnownPrice)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-gray-500">Profit:</span>
                    <span
                      className={`font-mono ${
                        gridState.totalProfit > 0
                          ? "text-emerald-400"
                          : "text-gray-400"
                      }`}
                    >
                      {formatPrice(gridState.totalProfit)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </SettingsSection>

        {/* 2# Wymagania KUPNO */}
        <SettingsSection
          title="Wymagania KUPNO"
          icon={TrendingDown}
          iconColor="text-emerald-400"
          isExpanded={expandedSections.has("buy")}
          onToggle={() => toggleSection("buy")}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {/* Waluta kupna zawsze = stable z wybranej pary (QUOTE) */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Waluta</label>
              <div className="w-full px-3 py-2 bg-grid-bg border border-grid-border rounded-lg text-sm text-gray-200">
                {localOrder.quoteAsset || localOrder.buy.currency}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                Ustalana automatycznie z pola <strong>Stable (QUOTE)</strong>{" "}
                powyżej.
              </div>
            </div>
            <InputField
              label={`Zabezpieczenie portfela (${localOrder.quoteAsset || localOrder.buy.currency || "USDT"})`}
              value={localOrder.buy.walletProtection}
              onChange={(v) => updateField("buy.walletProtection", Number(v))}
              type="number"
            />
            <SelectField
              label="Tryb zakupu"
              value={localOrder.buy.mode}
              options={[
                { value: "onlySold", label: "Tylko sprzedane" },
                { value: "maxDefined", label: "Określony max" },
                { value: "walletLimit", label: "Limit portfela" },
              ]}
              onChange={(v) => updateField("buy.mode", v)}
            />
            <InputField
              label="Max wartość (USDT)"
              value={localOrder.buy.maxValue}
              onChange={(v) => updateField("buy.maxValue", Number(v))}
              type="number"
              step="0.01"
              disabled={localOrder.buy.mode !== "maxDefined"}
            />
            <CheckboxField
              label="Dolicz profit"
              checked={localOrder.buy.addProfit}
              onChange={(v) => updateField("buy.addProfit", v)}
            />
          </div>
        </SettingsSection>

        {/* 2# Wymagania SPRZEDAŻ */}
        <SettingsSection
          title="Wymagania SPRZEDAŻ"
          icon={TrendingUp}
          iconColor="text-red-400"
          isExpanded={expandedSections.has("sell")}
          onToggle={() => toggleSection("sell")}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {/* Waluta sprzedaży zawsze = krypto z wybranej pary (BASE) */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Waluta</label>
              <div className="w-full px-3 py-2 bg-grid-bg border border-grid-border rounded-lg text-sm text-gray-200">
                {localOrder.baseAsset || localOrder.sell.currency}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                Ustalana automatycznie z pola <strong>Krypto (BASE)</strong>{" "}
                powyżej.
              </div>
            </div>
            <InputField
              label={`Zabezpieczenie portfela (${localOrder.baseAsset || localOrder.sell.currency || "BTC"})`}
              value={localOrder.sell.walletProtection}
              onChange={(v) => updateField("sell.walletProtection", Number(v))}
              type="number"
              step="0.00000001"
            />
            <SelectField
              label="Tryb sprzedaży"
              value={localOrder.sell.mode}
              options={[
                { value: "onlyBought", label: "Tylko kupione" },
                { value: "maxDefined", label: "Określony max" },
                { value: "walletLimit", label: "Limit portfela" },
              ]}
              onChange={(v) => updateField("sell.mode", v)}
            />
            <InputField
              label="Max wartość (USDT)"
              value={localOrder.sell.maxValue}
              onChange={(v) => updateField("sell.maxValue", Number(v))}
              type="number"
              step="0.01"
              disabled={localOrder.sell.mode !== "maxDefined"}
            />
            <CheckboxField
              label="Dolicz profit"
              checked={localOrder.sell.addProfit}
              onChange={(v) => updateField("sell.addProfit", v)}
            />
          </div>
        </SettingsSection>

        {/* 4# Warunek kolejnych transakcji */}
        <SettingsSection
          title="Warunki transakcji"
          icon={AlertTriangle}
          iconColor="text-amber-400"
          isExpanded={expandedSections.has("conditions")}
          onToggle={() => toggleSection("conditions")}
        >
          <div className="space-y-4">
            {/* Wyjaśnienie */}
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm">
              <p className="text-amber-300 mb-1">
                <strong>#4 Warunek kolejnych transakcji</strong>
              </p>
              <p className="text-gray-400 text-xs">
                Określa warunki przy których algorytm wykonuje transakcje. Próg
                cenowy blokuje nowe transakcje gdy cena go przekroczy.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              {/* KUPNO */}
              <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <h4 className="text-sm font-medium text-emerald-400 mb-4 flex items-center gap-2">
                  <TrendingDown className="w-4 h-4" />
                  KUPNO
                </h4>
                <div className="space-y-4">
                  <InputField
                    label="1. Min wartość przypadająca na 1%"
                    value={localOrder.buyConditions.minValuePer1Percent}
                    onChange={(v) =>
                      updateField(
                        "buyConditions.minValuePer1Percent",
                        v === "" ? "" : Number(v),
                      )
                    }
                    type="number"
                    suffix="$"
                    hint="Bazowa wartość transakcji"
                  />
                  <InputField
                    label="2. Próg cenowy zakupu"
                    value={localOrder.buyConditions.priceThreshold}
                    onChange={(v) =>
                      updateField(
                        "buyConditions.priceThreshold",
                        v === "" ? "" : Number(v),
                      )
                    }
                    type="number"
                    suffix="$"
                    hint="Powyżej tej ceny - stop zakupów"
                  />
                  <div className="pt-2">
                    <CheckboxField
                      label="3. Sprawdź próg jeśli zarabia"
                      checked={
                        localOrder.buyConditions.checkThresholdIfProfitable
                      }
                      onChange={(v) =>
                        updateField(
                          "buyConditions.checkThresholdIfProfitable",
                          v,
                        )
                      }
                    />
                    <p className="text-xs text-gray-600 mt-1 ml-6">
                      TAK = zatrzymaj zakupy nawet przy proficie
                    </p>
                  </div>
                </div>
              </div>

              {/* SPRZEDAŻ */}
              <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/20">
                <h4 className="text-sm font-medium text-red-400 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  SPRZEDAŻ
                </h4>
                <div className="space-y-4">
                  <InputField
                    label="1. Min wartość przypadająca na 1%"
                    value={localOrder.sellConditions.minValuePer1Percent}
                    onChange={(v) =>
                      updateField(
                        "sellConditions.minValuePer1Percent",
                        v === "" ? "" : Number(v),
                      )
                    }
                    type="number"
                    suffix="$"
                    hint="Bazowa wartość transakcji"
                  />
                  <InputField
                    label="2. Próg cenowy sprzedaży"
                    value={localOrder.sellConditions.priceThreshold}
                    onChange={(v) =>
                      updateField(
                        "sellConditions.priceThreshold",
                        v === "" ? "" : Number(v),
                      )
                    }
                    type="number"
                    suffix="$"
                    hint="Poniżej tej ceny - stop sprzedaży"
                  />
                  <div className="pt-2">
                    <CheckboxField
                      label="3. Sprawdź próg jeśli zarabia"
                      checked={
                        localOrder.sellConditions.checkThresholdIfProfitable
                      }
                      onChange={(v) =>
                        updateField(
                          "sellConditions.checkThresholdIfProfitable",
                          v,
                        )
                      }
                    />
                    <p className="text-xs text-gray-600 mt-1 ml-6">
                      TAK = zatrzymaj sprzedaż nawet przy proficie
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Przykład */}
            <div className="p-3 rounded-lg bg-grid-bg/50 border border-grid-border text-xs">
              <div className="text-gray-400 mb-2">
                💡 Przykład z dokumentacji:
              </div>
              <div className="text-gray-500">
                Próg cenowy zakupu ={" "}
                <span className="text-emerald-400 font-mono">
                  {formatPrice(localOrder.buyConditions.priceThreshold)}
                </span>
                <br />
                Jeśli cena{" "}
                <span className="font-mono">
                  {localOrder.baseAsset || "BTC"}
                </span>{" "}
                przekroczy ten próg, algorytm zatrzyma wyliczanie nowej ceny
                focus i nie wykona zakupu, dopóki cena nie spadnie poniżej
                progu.
              </div>
            </div>
          </div>
        </SettingsSection>

        {/* 5# Procent do nowej transakcji */}
        <SettingsSection
          title="Procenty dla trendów"
          icon={Percent}
          iconColor="text-purple-400"
          isExpanded={expandedSections.has("trend")}
          onToggle={() => toggleSection("trend")}
        >
          <div className="space-y-4">
            {/* Wyjaśnienie */}
            <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-sm">
              <p className="text-purple-300 mb-2">
                <strong>Format:</strong> Trend = Z(Zakup %) | S(Sprzedaż %)
              </p>
              <p className="text-gray-400 text-xs">
                Procent określa o ile % od ceny focus wyliczyć cel transakcji.
                Jeśli brak wpisu dla danego trendu, używany jest najbliższy
                mniejszy.
                <br />
                <em>
                  Np. dla trendów 2,3,4 używany będzie procent z trendu 2.
                </em>
              </p>
            </div>

            {/* Podgląd w formacie tekstowym */}
            <div className="p-3 rounded-lg bg-grid-bg border border-grid-border">
              <div className="text-xs text-gray-500 mb-2">Aktualny format:</div>
              <code className="text-sm font-mono text-amber-400">
                {localOrder.trendPercents
                  .sort((a, b) => a.trend - b.trend)
                  .map(
                    (tp) =>
                      `${tp.trend}=Z${tp.buyPercent}%|S${tp.sellPercent}%`,
                  )
                  .join("; ")}
              </code>
            </div>

            {/* Tabela edycji */}
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 font-medium px-1">
                <div className="col-span-2">Trend</div>
                <div className="col-span-4">Zakup (Z) %</div>
                <div className="col-span-4">Sprzedaż (S) %</div>
                <div className="col-span-2"></div>
              </div>

              {localOrder.trendPercents
                .sort((a, b) => a.trend - b.trend)
                .map((tp, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center"
                  >
                    <div className="col-span-2">
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500 text-sm">=</span>
                        <input
                          type="number"
                          min="0"
                          value={tp.trend}
                          onChange={(e) => {
                            const newPercents = [...localOrder.trendPercents];
                            const realIdx = localOrder.trendPercents.findIndex(
                              (t) => t.trend === tp.trend,
                            );
                            newPercents[realIdx] = {
                              ...tp,
                              trend: Number(e.target.value),
                            };
                            updateField("trendPercents", newPercents);
                          }}
                          className="w-full px-2 py-2 bg-grid-bg border border-grid-border rounded-lg text-sm font-mono text-center"
                        />
                      </div>
                    </div>
                    <div className="col-span-4">
                      <div className="flex items-center gap-1">
                        <span className="text-emerald-400 font-mono text-sm">
                          Z
                        </span>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={tp.buyPercent}
                          onChange={(e) => {
                            const newPercents = [...localOrder.trendPercents];
                            const realIdx = localOrder.trendPercents.findIndex(
                              (t) => t.trend === tp.trend,
                            );
                            newPercents[realIdx] = {
                              ...tp,
                              buyPercent: Number(e.target.value),
                            };
                            updateField("trendPercents", newPercents);
                          }}
                          className="w-full px-2 py-2 bg-grid-bg border border-emerald-500/30 rounded-lg text-sm font-mono"
                        />
                        <span className="text-gray-500 text-sm">%</span>
                      </div>
                    </div>
                    <div className="col-span-4">
                      <div className="flex items-center gap-1">
                        <span className="text-red-400 font-mono text-sm">
                          S
                        </span>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={tp.sellPercent}
                          onChange={(e) => {
                            const newPercents = [...localOrder.trendPercents];
                            const realIdx = localOrder.trendPercents.findIndex(
                              (t) => t.trend === tp.trend,
                            );
                            newPercents[realIdx] = {
                              ...tp,
                              sellPercent: Number(e.target.value),
                            };
                            updateField("trendPercents", newPercents);
                          }}
                          className="w-full px-2 py-2 bg-grid-bg border border-red-500/30 rounded-lg text-sm font-mono"
                        />
                        <span className="text-gray-500 text-sm">%</span>
                      </div>
                    </div>
                    <div className="col-span-2 flex justify-center">
                      <button
                        onClick={() => {
                          const newPercents = localOrder.trendPercents.filter(
                            (t) => t.trend !== tp.trend,
                          );
                          updateField("trendPercents", newPercents);
                        }}
                        className="p-2 text-gray-500 hover:text-red-400 transition-colors"
                        title="Usuń"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>

            <button
              onClick={() => {
                const maxTrend = Math.max(
                  ...localOrder.trendPercents.map((t) => t.trend),
                  -1,
                );
                updateField("trendPercents", [
                  ...localOrder.trendPercents,
                  { trend: maxTrend + 1, buyPercent: 0.5, sellPercent: 0.5 },
                ]);
              }}
              className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              <span className="text-lg">+</span> Dodaj próg trendu
            </button>

            {/* Przykład obliczenia */}
            <div className="mt-4 p-3 rounded-lg bg-grid-bg/50 border border-grid-border text-xs">
              <div className="text-gray-400 mb-2">
                📊 Przykład obliczenia (Focus ={" "}
                <span className="font-mono text-amber-400">
                  {formatPrice(localOrder.focusPrice)}
                </span>
                ):
              </div>
              {localOrder.trendPercents.slice(0, 3).map((tp) => {
                const buyTarget =
                  localOrder.focusPrice * (1 - tp.buyPercent / 100);
                const sellTarget =
                  localOrder.focusPrice * (1 + tp.sellPercent / 100);
                return (
                  <div key={tp.trend} className="flex gap-4 py-1">
                    <span className="text-gray-500 w-16">
                      Trend {tp.trend}:
                    </span>
                    <span className="text-emerald-400 font-mono">
                      Zakup @ {formatPrice(buyTarget)}
                    </span>
                    <span className="text-gray-600">|</span>
                    <span className="text-red-400 font-mono">
                      Sprzedaż @ {formatPrice(sellTarget)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </SettingsSection>

        {/* 6# & 7# Progi cenowe */}
        <SettingsSection
          title="Progi wartości transakcji"
          icon={DollarSign}
          iconColor="text-yellow-400"
          isExpanded={expandedSections.has("thresholds")}
          onToggle={() => toggleSection("thresholds")}
        >
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-emerald-400 mb-3">
                Dodatkowa wartość KUPNO
              </h4>
              <RangeThresholdEditor
                thresholds={localOrder.additionalBuyValues}
                onChange={(v) => updateField("additionalBuyValues", v)}
                valueLabel="Dodatkowa wartość (USDT)"
              />
            </div>
            <div>
              <h4 className="text-sm font-medium text-red-400 mb-3">
                Dodatkowa wartość SPRZEDAŻ
              </h4>
              <RangeThresholdEditor
                thresholds={localOrder.additionalSellValues}
                onChange={(v) => updateField("additionalSellValues", v)}
                valueLabel="Dodatkowa wartość (USDT)"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mt-6 pt-6 border-t border-grid-border">
            <div>
              <h4 className="text-sm font-medium text-emerald-400 mb-3">
                MAX wartość KUPNO
              </h4>
              <RangeThresholdEditor
                thresholds={localOrder.maxBuyPerTransaction}
                onChange={(v) => updateField("maxBuyPerTransaction", v)}
                valueLabel="MAX wartość (USDT)"
              />
            </div>
            <div>
              <h4 className="text-sm font-medium text-red-400 mb-3">
                MAX wartość SPRZEDAŻ
              </h4>
              <RangeThresholdEditor
                thresholds={localOrder.maxSellPerTransaction}
                onChange={(v) => updateField("maxSellPerTransaction", v)}
                valueLabel="MAX wartość (USDT)"
              />
            </div>
          </div>
        </SettingsSection>

        {/* 8# Procent wahania */}
        <SettingsSection
          title="Procent wahania (min swing)"
          icon={Activity}
          iconColor="text-cyan-400"
          isExpanded={expandedSections.has("advanced")}
          onToggle={() => toggleSection("advanced")}
        >
          <p className="text-xs text-gray-500 mb-4">
            Minimalne wahanie cenowe wymagane do wykonania transakcji. Zapobiega
            transakcjom przy zbyt małych ruchach ceny. Minimalne wahanie zależy
            od zakresu cen.
          </p>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-emerald-400 mb-3">
                Min wahanie KUPNO
              </h4>
              <RangeThresholdEditor
                thresholds={localOrder.buySwingPercent}
                onChange={(v) => updateField("buySwingPercent", v)}
                valueLabel="Min wahanie %"
              />
            </div>
            <div>
              <h4 className="text-sm font-medium text-red-400 mb-3">
                Min wahanie SPRZEDAŻ
              </h4>
              <RangeThresholdEditor
                thresholds={localOrder.sellSwingPercent}
                onChange={(v) => updateField("sellSwingPercent", v)}
                valueLabel="Min wahanie %"
              />
            </div>
          </div>
        </SettingsSection>
      </div>
      {/* Modale potwierdzeń zapisu/usunięcia */}
      <AnimatePresence>
        {showSaveConfirm && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-grid-card border border-grid-border rounded-xl p-6 w-full max-w-sm shadow-xl"
              initial={{ scale: 0.9, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 10 }}
            >
              <h3 className="text-lg font-semibold mb-2">Zapisać zmiany?</h3>
              <p className="text-sm text-gray-400 mb-5">
                Zmiany w ustawieniach zlecenia{" "}
                <span className="font-mono text-emerald-300">
                  {localOrder.name}
                </span>{" "}
                zostaną zapisane w bazie.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowSaveConfirm(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-grid-border text-gray-300 hover:bg-grid-bg/60"
                >
                  Anuluj
                </button>
                <button
                  onClick={async () => {
                    setShowSaveConfirm(false);
                    await handleSave();
                  }}
                  className="px-4 py-2 text-sm rounded-lg bg-emerald-500/80 hover:bg-emerald-500 text-white flex items-center gap-2"
                  disabled={isSaving}
                >
                  <Save className="w-4 h-4" />
                  Zapisz
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              className="bg-grid-card border border-red-500/40 rounded-xl p-6 w-full max-w-sm shadow-xl"
              initial={{ scale: 0.9, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-red-300 mb-2">
                Usunąć zlecenie?
              </h3>
              <p className="text-sm text-gray-400 mb-5">
                To działanie jest nieodwracalne. Zlecenie{" "}
                <span className="font-mono text-red-300">
                  {localOrder.name}
                </span>{" "}
                oraz jego ustawienia zostaną trwale usunięte.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-grid-border text-gray-300 hover:bg-grid-bg/60"
                >
                  Anuluj
                </button>
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setShowDeleteFinalConfirm(true);
                  }}
                  className="px-4 py-2 text-sm rounded-lg bg-red-500/80 hover:bg-red-500 text-white flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Usuń
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drugi popup - finalne potwierdzenie */}
      <AnimatePresence>
        {showDeleteFinalConfirm && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowDeleteFinalConfirm(false)}
          >
            <motion.div
              className="bg-grid-card border-2 border-red-500 rounded-xl p-6 w-full max-w-md shadow-2xl"
              initial={{ scale: 0.9, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-500/20 rounded-lg">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                </div>
                <h3 className="text-xl font-bold text-red-300">
                  Ostatnie ostrzeżenie!
                </h3>
              </div>
              <p className="text-sm text-gray-300 mb-2">
                Czy na pewno chcesz trwale usunąć zlecenie{" "}
                <span className="font-mono text-red-300 font-semibold">
                  {localOrder.name}
                </span>
                ?
              </p>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-5">
                <p className="text-xs text-red-300/90">
                  ⚠️ To działanie jest <strong>nieodwracalne</strong>. Zostaną
                  usunięte:
                </p>
                <ul className="text-xs text-gray-400 mt-2 ml-4 list-disc space-y-1">
                  <li>Wszystkie ustawienia zlecenia</li>
                  <li>Historia transakcji i pozycji</li>
                  <li>Stan algorytmu GRID</li>
                  <li>Wszystkie dane związane z tym zleceniem</li>
                </ul>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteFinalConfirm(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-grid-border text-gray-300 hover:bg-grid-bg/60"
                >
                  Anuluj
                </button>
                <button
                  onClick={async () => {
                    setShowDeleteFinalConfirm(false);
                    await handleDelete();
                  }}
                  className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white flex items-center gap-2 font-semibold"
                >
                  <Trash2 className="w-4 h-4" />
                  Tak, usuń na zawsze
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Helper Components
function SettingsSection({
  title,
  icon: Icon,
  iconColor = "text-gray-400",
  isExpanded,
  onToggle,
  children,
}: {
  title: string;
  icon: any;
  iconColor?: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 sm:p-4 hover:bg-grid-bg/30 transition-colors"
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${iconColor}`} />
          <span className="font-medium text-sm sm:text-base">{title}</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500" />
        ) : (
          <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500" />
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 sm:p-4 pt-0 bg-grid-bg/20">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  step,
  suffix,
  hint,
  disabled = false,
  infoTitle,
}: {
  label: string;
  value: any;
  onChange: (value: string) => void;
  type?: string;
  step?: string;
  suffix?: string;
  hint?: string;
  disabled?: boolean;
  infoTitle?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] sm:text-xs text-gray-500 mb-1 flex items-center gap-1">
        <span>{label}</span>
        {infoTitle && (
          <button
            type="button"
            className="w-3.5 h-3.5 rounded-full border border-gray-600 text-[9px] flex items-center justify-center text-gray-400 hover:text-emerald-300 hover:border-emerald-400"
            title={infoTitle}
          >
            i
          </button>
        )}
      </label>
      <div className="relative">
        <input
          type={type}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`w-full px-2 sm:px-3 py-1.5 sm:py-2 bg-grid-bg border border-grid-border rounded-lg text-xs sm:text-sm font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-50 ${
            suffix ? "pr-10 sm:pr-12" : ""
          }`}
        />
        {suffix && (
          <span className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs sm:text-sm">
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <div className="text-[10px] sm:text-xs text-gray-600 mt-1">{hint}</div>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: (string | { value: string; label: string })[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-grid-bg border border-grid-border rounded-lg text-sm focus:outline-none focus:border-emerald-500"
      >
        {options.map((opt) => {
          const optValue = typeof opt === "string" ? opt : opt.value;
          const optLabel =
            typeof opt === "string" ? opt : opt.label || opt.value;
          return (
            <option key={optValue} value={optValue}>
              {optLabel}
            </option>
          );
        })}
      </select>
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="custom-checkbox"
      />
      <span className="text-sm text-gray-300">{label}</span>
    </label>
  );
}

function ThresholdEditor({
  thresholds,
  onChange,
}: {
  thresholds: any[];
  onChange: (value: any[]) => void;
}) {
  const conditionLabels: Record<string, string> = {
    less: "< mniejsze",
    lessEqual: "<= mniejsze równe",
    greater: "> większe",
    greaterEqual: ">= większe równe",
  };

  return (
    <div className="space-y-2">
      {thresholds.map((th, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <select
            value={th.condition}
            onChange={(e) => {
              const newTh = [...thresholds];
              newTh[idx] = { ...th, condition: e.target.value };
              onChange(newTh);
            }}
            className="flex-1 px-2 py-1.5 bg-grid-bg border border-grid-border rounded text-xs"
          >
            {Object.entries(conditionLabels).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={th.price}
            onChange={(e) => {
              const newTh = [...thresholds];
              newTh[idx] = { ...th, price: Number(e.target.value) };
              onChange(newTh);
            }}
            placeholder="Cena"
            className="w-24 px-2 py-1.5 bg-grid-bg border border-grid-border rounded text-xs font-mono"
          />
          <input
            type="number"
            value={th.value}
            onChange={(e) => {
              const newTh = [...thresholds];
              newTh[idx] = { ...th, value: Number(e.target.value) };
              onChange(newTh);
            }}
            placeholder="Wartość"
            className="w-20 px-2 py-1.5 bg-grid-bg border border-grid-border rounded text-xs font-mono"
          />
          <button
            onClick={() => onChange(thresholds.filter((_, i) => i !== idx))}
            className="p-1 text-gray-500 hover:text-red-400"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange([
            ...thresholds,
            { condition: "less", price: 100000, value: 100 },
          ])
        }
        className="text-xs text-emerald-400 hover:text-emerald-300"
      >
        + Dodaj próg
      </button>
    </div>
  );
}

function RangeThresholdEditor({
  thresholds,
  onChange,
  valueLabel = "MAX wartość",
}: {
  thresholds: any[];
  onChange: (value: any[]) => void;
  valueLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1.3fr,1.3fr,1fr,auto] gap-3 text-xs text-gray-500 font-medium px-1">
        <div>Od ceny</div>
        <div className="flex items-center gap-1">
          <span>Do ceny</span>
          <span
            className="cursor-help text-[10px] px-1 py-0.5 rounded border border-gray-600 text-gray-400 hover:text-emerald-300 hover:border-emerald-400"
            title="Jeśli pole 'Do ceny' zostawisz puste, próg działa bez górnego limitu."
          >
            i
          </span>
        </div>
        <div className="whitespace-nowrap">{valueLabel}</div>
        <div />
      </div>

      {thresholds.map((th, idx) => (
        <div
          key={idx}
          className="grid grid-cols-[1.3fr,1.3fr,1fr,auto] gap-3 items-center"
        >
          <input
            type="number"
            value={th.minPrice ?? ""}
            onChange={(e) => {
              const newTh = [...thresholds];
              newTh[idx] = {
                ...th,
                minPrice: e.target.value === "" ? null : Number(e.target.value),
              };
              onChange(newTh);
            }}
            placeholder="od"
            className="w-full px-3 py-1.5 bg-grid-bg border border-grid-border rounded text-xs font-mono"
          />
          <input
            type="number"
            value={th.maxPrice ?? ""}
            onChange={(e) => {
              const newTh = [...thresholds];
              newTh[idx] = {
                ...th,
                maxPrice: e.target.value === "" ? null : Number(e.target.value),
              };
              onChange(newTh);
            }}
            placeholder="do"
            className="w-full px-3 py-1.5 bg-grid-bg border border-grid-border rounded text-xs font-mono"
          />
          <input
            type="number"
            value={th.value}
            onChange={(e) => {
              const newTh = [...thresholds];
              newTh[idx] = { ...th, value: Number(e.target.value) };
              onChange(newTh);
            }}
            placeholder="wartość"
            className="w-full px-3 py-1.5 bg-grid-bg border border-grid-border rounded text-xs font-mono"
          />
          <button
            onClick={() => onChange(thresholds.filter((_, i) => i !== idx))}
            className="p-1 text-gray-500 hover:text-red-400 justify-self-center"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}

      <button
        onClick={() =>
          onChange([
            ...thresholds,
            { minPrice: null, maxPrice: null, value: 0 },
          ])
        }
        className="text-xs text-emerald-400 hover:text-emerald-300"
      >
        + Dodaj próg
      </button>
    </div>
  );
}
