import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ArrowUpCircle,
  ArrowDownCircle,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import toast from "react-hot-toast";
import { useStore } from "../store/useStore";
import { api } from "../api";
import type { Position } from "../types";

interface PositionsTableProps {
  orderId: string;
}

export default function PositionsTable({ orderId }: PositionsTableProps) {
  const { walletAddress, positions, setPositions, prices, userSettings } =
    useStore();
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");
  const [deletingPositionId, setDeletingPositionId] = useState<string | null>(
    null,
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(
    null,
  );
  const [showDeleteFinalConfirm, setShowDeleteFinalConfirm] = useState<
    string | null
  >(null);

  const orderPositions = positions[orderId] || [];

  // Ustal symbol pary dla tego zlecenia (np. BTCUSDT, ETHUSDT),
  // żeby poprawnie liczyć P&L dla różnych krypto.
  const orders = userSettings?.orders || [];
  const currentOrder = orders.find(
    (o) => (o._id || (o as any).id) === orderId,
  ) as any | undefined;

  const baseAsset =
    currentOrder?.baseAsset || currentOrder?.sell?.currency || "BTC";
  const quoteAsset =
    currentOrder?.quoteAsset || currentOrder?.buy?.currency || "USDT";
  const symbol = `${baseAsset}${quoteAsset}`;
  const currentPrice = prices[symbol]?.price || 0;
  const minProfitPercent =
    typeof currentOrder?.minProfitPercent === "number"
      ? currentOrder.minProfitPercent
      : 0;

  // Filtruj pozycje według typu i sortuj po dacie (najnowsze na górze)
  const buyPositions = orderPositions
    .filter((p) => p.type === "BUY" || !p.type)
    .sort((a, b) => {
      const dateA = new Date(a.createdAt || a.closedAt || 0).getTime();
      const dateB = new Date(b.createdAt || b.closedAt || 0).getTime();
      return dateB - dateA; // Najnowsze na górze
    });
  const sellPositions = orderPositions
    .filter((p) => p.type === "SELL")
    .sort((a, b) => {
      const dateA = new Date(a.createdAt || a.closedAt || 0).getTime();
      const dateB = new Date(b.createdAt || b.closedAt || 0).getTime();
      return dateB - dateA; // Najnowsze na górze
    });

  // Liczniki otwartych pozycji - liczymy bezpośrednio z orderPositions dla pewności
  const openBuyCount = orderPositions.filter(
    (p) => (p.type === "BUY" || !p.type) && p.status === "OPEN"
  ).length;
  const openSellCount = orderPositions.filter(
    (p) => p.type === "SELL" && p.status === "OPEN"
  ).length;

  const fetchPositions = async () => {
    if (!walletAddress || !orderId) return;

    setIsLoading(true);
    try {
      const data = await api.getPositions(walletAddress, orderId);
      setPositions(orderId, data);
    } catch (error) {
      console.error("Failed to fetch positions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePosition = async (positionId: string) => {
    if (!walletAddress) return;

    setDeletingPositionId(positionId);
    setShowDeleteFinalConfirm(null);
    try {
      await api.deletePosition(walletAddress, positionId);
      // Odśwież listę pozycji
      await fetchPositions();
    } catch (error) {
      console.error("Failed to delete position:", error);
      alert("Nie udało się usunąć pozycji");
    } finally {
      setDeletingPositionId(null);
    }
  };

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 30000);
    return () => clearInterval(interval);
  }, [orderId, walletAddress]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatPrice = (v: number | undefined | null) =>
    v != null && !Number.isNaN(v) && v > 0
      ? "$" +
        Number(v).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "—";

  const calculateUnrealizedPnL = (position: Position) => {
    if (position.status !== "OPEN") return null;

    const entryPrice =
      position.type === "SELL" ? position.sellPrice : position.buyPrice;
    const amount = position.amount ?? 0;
    if (entryPrice == null || entryPrice <= 0 || amount <= 0) return null;

    if (position.type === "SELL") {
      const pnl = (position.sellPrice - currentPrice) * amount;
      const pnlPercent =
        ((position.sellPrice - currentPrice) / position.sellPrice) * 100;
      return { pnl, pnlPercent };
    } else {
      const pnl = (currentPrice - position.buyPrice) * amount;
      const pnlPercent =
        ((currentPrice - position.buyPrice) / position.buyPrice) * 100;
      return { pnl, pnlPercent };
    }
  };

  const displayPositions = activeTab === "buy" ? buyPositions : sellPositions;

  return (
    <div className="bg-grid-card rounded-xl border border-grid-border overflow-hidden">
      {/* Header z zakładkami */}
      <div className="flex items-center justify-between p-3 sm:p-4 border-b border-grid-border">
        <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
          <button
            onClick={() => setActiveTab("buy")}
            className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm transition-colors ${
              activeTab === "buy"
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <ArrowDownCircle className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Pozycje Zakup</span>
            <span className="sm:hidden">Zakup</span>
            <span className="ml-1">({openBuyCount})</span>
          </button>
          <button
            onClick={() => setActiveTab("sell")}
            className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm transition-colors ${
              activeTab === "sell"
                ? "bg-red-500/20 text-red-400"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <ArrowUpCircle className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Pozycje Sprzedaż</span>
            <span className="sm:hidden">Sprzedaż</span>
            <span className="ml-1">({openSellCount})</span>
          </button>
        </div>
        <button
          onClick={fetchPositions}
          disabled={isLoading}
          className="p-1.5 sm:p-2 rounded-lg hover:bg-grid-bg transition-colors flex-shrink-0"
        >
          <RefreshCw
            className={`w-3 h-3 sm:w-4 sm:h-4 ${isLoading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {displayPositions.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          {activeTab === "buy" ? (
            <>
              <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Brak pozycji zakupowych</p>
              <p className="text-sm mt-1">
                Pozycje pojawią się gdy cena spadnie do celu zakupu
              </p>
            </>
          ) : (
            <>
              <TrendingDown className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Brak pozycji sprzedażowych w historii</p>
              <p className="text-sm mt-1">
                Pozycje sprzedaży pojawią się po zamknięciu pozycji zakupowych
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-grid-border">
                <th className="text-left p-2 sm:p-3 font-medium">Data</th>
                <th className="text-left p-2 sm:p-3 font-medium hidden lg:table-cell">
                  ID pozycji
                </th>
                <th className="text-right p-2 sm:p-3 font-medium">
                  {activeTab === "buy" ? "Cena zakupu" : "Cena sprzedaży"}
                </th>
                <th className="text-right p-2 sm:p-3 font-medium hidden md:table-cell">
                  Ilość
                </th>
                <th className="text-right p-2 sm:p-3 font-medium hidden lg:table-cell">
                  Wartość
                </th>
                <th className="text-right p-2 sm:p-3 font-medium hidden md:table-cell">
                  {activeTab === "buy"
                    ? "Cel / Cena sprzedaży"
                    : "Cel / Cena zakupu"}
                </th>
                <th className="text-right p-2 sm:p-3 font-medium hidden md:table-cell">
                  Trend
                </th>
                <th className="text-right p-2 sm:p-3 font-medium">P&L</th>
                <th className="text-center p-2 sm:p-3 font-medium">Status</th>
                <th className="text-center p-2 sm:p-3 font-medium w-10 sm:w-12">
                  Akcje
                </th>
              </tr>
            </thead>
            <tbody>
              {displayPositions.map((position, idx) => {
                const unrealized = calculateUnrealizedPnL(position);
                const entryPrice =
                  activeTab === "buy" ? position.buyPrice : position.sellPrice;
                const entryValue =
                  activeTab === "buy" ? position.buyValue : position.sellValue;
                const isClosed = position.status === "CLOSED";
                // Kolumna cel/wyjście:
                // BUY: dla zamkniętych = cena sprzedaży, dla otwartych = cel sprzedaży.
                // SELL: dla zamkniętych = cena zakupu (baza), dla otwartych = cel odkupu.
                const targetOrExitPrice =
                  activeTab === "buy"
                    ? isClosed && position.sellPrice != null
                      ? position.sellPrice
                      : position.targetSellPrice
                    : isClosed && position.buyPrice != null
                      ? position.buyPrice
                      : position.targetBuybackPrice;
                // Dla SELL zamkniętej: cena zakupu (po której kupiliśmy przed tą sprzedażą)
                const sellBuyPrice =
                  activeTab === "sell" ? position.buyPrice : null;
                const sellNextTarget =
                  activeTab === "sell" ? position.targetBuybackPrice : null;

                return (
                  <motion.tr
                    key={position.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="border-b border-grid-border/50 hover:bg-grid-bg/30"
                  >
                    <td className="p-2 sm:p-3 text-xs sm:text-sm text-gray-400">
                      <span className="hidden sm:inline">
                        {formatDate(position.createdAt)}
                      </span>
                      <span className="sm:hidden">
                        {new Date(position.createdAt).toLocaleDateString(
                          "pl-PL",
                          {
                            day: "2-digit",
                            month: "2-digit",
                          },
                        )}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 text-xs sm:text-sm text-gray-500 hidden lg:table-cell">
                      <div className="flex items-center gap-2">
                        <span className="font-mono">
                          {position.id.slice(0, 8)}…
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (navigator?.clipboard?.writeText) {
                              navigator.clipboard
                                .writeText(position.id)
                                .then(() => {
                                  toast.success("Skopiowano ID pozycji");
                                })
                                .catch(() => {});
                            }
                          }}
                          className="px-1.5 py-0.5 text-[10px] border border-grid-border rounded hover:border-emerald-500 hover:text-emerald-400 transition-colors"
                          title="Kopiuj pełne ID pozycji"
                        >
                          Kopiuj
                        </button>
                      </div>
                    </td>
                    <td className="p-2 sm:p-3 text-right font-mono text-xs sm:text-sm">
                      {formatPrice(entryPrice)}
                    </td>
                    <td className="p-2 sm:p-3 text-right font-mono text-xs sm:text-sm text-gray-400 hidden md:table-cell">
                      {position.amount != null && position.amount > 0
                        ? position.amount.toFixed(6)
                        : "—"}
                    </td>
                    <td
                      className="p-2 sm:p-3 text-right font-mono text-xs sm:text-sm hidden lg:table-cell"
                      title={
                        targetOrExitPrice != null &&
                        targetOrExitPrice > 0 &&
                        position.status === "OPEN" &&
                        minProfitPercent > 0
                          ? activeTab === "buy"
                            ? `Minimalna cena sprzedaży (min. zysk ${minProfitPercent.toFixed(
                                2,
                              )}%): $${targetOrExitPrice.toFixed(2)}`
                            : `Minimalna cena zakupu przy odkupie (min. zysk ${minProfitPercent.toFixed(
                                2,
                              )}%): $${targetOrExitPrice.toFixed(2)}`
                          : undefined
                      }
                    >
                      {formatPrice(entryValue)}
                    </td>
                    <td className="p-2 sm:p-3 text-right font-mono text-xs sm:text-sm hidden md:table-cell">
                      {activeTab === "sell" && isClosed
                        ? // Dla zamkniętej pozycji sprzedaży: pokaż normalną cenę zakupu (cena odkupu dla shorta)
                          sellBuyPrice != null && sellBuyPrice > 0
                          ? formatPrice(sellBuyPrice)
                          : "—"
                        : targetOrExitPrice != null && targetOrExitPrice > 0
                          ? formatPrice(targetOrExitPrice)
                          : "—"}
                    </td>
                    <td className="p-2 sm:p-3 text-right font-mono text-xs sm:text-sm hidden md:table-cell">
                      <span
                        className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs ${
                          activeTab === "buy"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {position.trendAtBuy}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 text-right">
                      {unrealized && (
                        <div
                          className={`font-mono text-xs sm:text-sm ${
                            unrealized.pnl >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          <div className="flex items-center justify-end gap-0.5 sm:gap-1">
                            {unrealized.pnl >= 0 ? (
                              <TrendingUp className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                            ) : (
                              <TrendingDown className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                            )}
                            <span className="hidden sm:inline">
                              ${Math.abs(unrealized.pnl).toFixed(2)}
                            </span>
                            <span className="sm:hidden">
                              ${Math.abs(unrealized.pnl).toFixed(0)}
                            </span>
                          </div>
                          <div className="text-[10px] sm:text-xs opacity-70">
                            {unrealized.pnlPercent >= 0 ? "+" : ""}
                            {unrealized.pnlPercent.toFixed(1)}%
                          </div>
                        </div>
                      )}
                      {position.status === "CLOSED" &&
                        (() => {
                          // Zysk = wartość sprzedaży − wartość zakupu (w USDT)
                          // Dla pozycji SELL (short): sellValue (sprzedaż) - buyValue (odkup) = profit
                          // Dla pozycji BUY (long): sellValue (sprzedaż) - buyValue (zakup) = profit
                          let closedProfit = null;

                          if (
                            position.profit != null &&
                            position.profit !== 0
                          ) {
                            // Jeśli profit jest już obliczony i zapisany, użyj go
                            closedProfit = position.profit;
                          } else if (
                            position.sellValue != null &&
                            position.buyValue != null
                          ) {
                            // Oblicz profit: wartość sprzedaży - wartość zakupu
                            const sellVal = Number(position.sellValue);
                            const buyVal = Number(position.buyValue);
                            if (sellVal > 0 && buyVal > 0) {
                              closedProfit = sellVal - buyVal;
                            }
                          }

                          if (closedProfit == null || closedProfit === 0)
                            return (
                              <span className="text-gray-500 text-xs">—</span>
                            );

                          return (
                            <div
                              className={`font-mono text-xs sm:text-sm ${
                                closedProfit >= 0
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }`}
                            >
                              <span className="hidden sm:inline">
                                ${closedProfit.toFixed(2)}
                              </span>
                              <span className="sm:hidden">
                                ${closedProfit.toFixed(0)}
                              </span>
                            </div>
                          );
                        })()}
                    </td>
                    <td className="p-2 sm:p-3 text-center">
                      <span
                        className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[10px] sm:text-xs font-medium ${
                          position.status === "OPEN"
                            ? "status-active"
                            : position.status === "CLOSED"
                              ? "status-closed"
                              : "status-inactive"
                        }`}
                      >
                        {position.status === "OPEN"
                          ? "Otwarta"
                          : position.status === "CLOSED"
                            ? "Zamknięta"
                            : "Anulowana"}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 text-center">
                      <button
                        onClick={() => setShowDeleteConfirm(position.id)}
                        disabled={deletingPositionId === position.id}
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center mx-auto"
                        title="Usuń z historii"
                      >
                        {deletingPositionId === position.id ? (
                          <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        )}
                      </button>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      {displayPositions.length > 0 && (
        <div className="p-3 sm:p-4 bg-grid-bg/30 border-t border-grid-border">
          <div className="flex justify-between text-xs sm:text-sm">
            <span className="text-gray-500">
              <span className="hidden sm:inline">
                Suma otwartych {activeTab === "buy" ? "zakupów" : "sprzedaży"}:
              </span>
              <span className="sm:hidden">Suma:</span>
            </span>
            <span className="font-mono">
              $
              {displayPositions
                .filter((p) => p.status === "OPEN")
                .reduce(
                  (sum, p) =>
                    sum +
                    (activeTab === "buy" ? p.buyValue || 0 : p.sellValue || 0),
                  0,
                )
                .toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Pierwszy modal potwierdzenia usunięcia */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowDeleteConfirm(null)}
          >
            <motion.div
              className="bg-grid-card border border-red-500/40 rounded-xl p-6 w-full max-w-sm shadow-xl"
              initial={{ scale: 0.9, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-red-300 mb-2">
                Usunąć pozycję z historii?
              </h3>
              <p className="text-sm text-gray-400 mb-5">
                To działanie jest nieodwracalne. Pozycja zostanie trwale
                usunięta z bazy danych.
                {(() => {
                  const pos = displayPositions.find(
                    (p) => p.id === showDeleteConfirm,
                  );
                  if (pos && pos.status === "CLOSED" && pos.profit) {
                    return (
                      <span className="block mt-2 text-red-300">
                        Uwaga: Ta pozycja ma zrealizowany zysk $
                        {pos.profit.toFixed(2)}. Usunięcie wpłynie na całkowity
                        profit zlecenia.
                      </span>
                    );
                  }
                  return null;
                })()}
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-grid-border text-gray-300 hover:bg-grid-bg/60"
                >
                  Anuluj
                </button>
                <button
                  onClick={() => {
                    if (showDeleteConfirm) {
                      setShowDeleteConfirm(null);
                      setShowDeleteFinalConfirm(showDeleteConfirm);
                    }
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

      {/* Drugi modal - finalne potwierdzenie */}
      <AnimatePresence>
        {showDeleteFinalConfirm && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowDeleteFinalConfirm(null)}
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
              {(() => {
                const pos = displayPositions.find(
                  (p) => p.id === showDeleteFinalConfirm,
                );
                const isOpen = pos && pos.status === "OPEN";
                const isClosed = pos && pos.status === "CLOSED";

                return (
                  <>
                    <p className="text-sm text-gray-300 mb-2">
                      Czy na pewno chcesz trwale usunąć tę pozycję z historii?
                    </p>

                    {isOpen && (
                      <div className="bg-red-500/20 border-2 border-red-500/50 rounded-lg p-4 mb-5">
                        <p className="text-sm text-red-300 font-semibold mb-2">
                          ⚠️ UWAGA: To jest OTWARTA pozycja!
                        </p>
                        <p className="text-xs text-red-200/90 mb-2">
                          Usunięcie otwartej pozycji może spowodować:
                        </p>
                        <ul className="text-xs text-red-200/80 ml-4 list-disc space-y-1">
                          <li>Niespójność w algorytmie GRID</li>
                          <li>Problemy z kalkulacją trendu i celów</li>
                          <li>
                            Brak możliwości zamknięcia tej pozycji w przyszłości
                          </li>
                        </ul>
                      </div>
                    )}

                    {isClosed && pos.profit && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-5">
                        <p className="text-xs text-red-300/90 mb-2">
                          ⚠️ Ta pozycja ma zrealizowany zysk{" "}
                          <span className="font-mono font-semibold">
                            ${pos.profit.toFixed(2)}
                          </span>
                        </p>
                        <p className="text-xs text-gray-400">
                          Usunięcie wpłynie na całkowity profit zlecenia i nie
                          będzie można tego cofnąć.
                        </p>
                      </div>
                    )}

                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-5">
                      <p className="text-xs text-red-300/90">
                        ⚠️ To działanie jest <strong>nieodwracalne</strong>. Po
                        usunięciu:
                      </p>
                      <ul className="text-xs text-gray-400 mt-2 ml-4 list-disc space-y-1">
                        <li>Pozycja zostanie trwale usunięta z bazy danych</li>
                        <li>Nie będzie widoczna w historii transakcji</li>
                        {isOpen && (
                          <li>
                            Pozycja zostanie usunięta z listy otwartych pozycji
                            w algorytmie
                          </li>
                        )}
                        {isClosed && (
                          <li>
                            Całkowity profit zlecenia zostanie przeliczony
                          </li>
                        )}
                      </ul>
                    </div>
                  </>
                );
              })()}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteFinalConfirm(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-grid-border text-gray-300 hover:bg-grid-bg/60"
                >
                  Anuluj
                </button>
                <button
                  onClick={async () => {
                    if (showDeleteFinalConfirm) {
                      await handleDeletePosition(showDeleteFinalConfirm);
                    }
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
