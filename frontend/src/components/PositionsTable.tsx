import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ArrowUpCircle,
  ArrowDownCircle,
} from "lucide-react";
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
            <span className="ml-1">({buyPositions.filter((p) => p.status === "OPEN").length})</span>
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
            <span className="ml-1">({sellPositions.length})</span>
          </button>
        </div>
        <button
          onClick={fetchPositions}
          disabled={isLoading}
          className="p-1.5 sm:p-2 rounded-lg hover:bg-grid-bg transition-colors flex-shrink-0"
        >
          <RefreshCw className={`w-3 h-3 sm:w-4 sm:h-4 ${isLoading ? "animate-spin" : ""}`} />
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
                <th className="text-right p-2 sm:p-3 font-medium">
                  {activeTab === "buy" ? "Cena zakupu" : "Cena sprzedaży"}
                </th>
                <th className="text-right p-2 sm:p-3 font-medium hidden md:table-cell">Ilość</th>
                <th className="text-right p-2 sm:p-3 font-medium hidden lg:table-cell">Wartość</th>
                <th className="text-right p-2 sm:p-3 font-medium hidden lg:table-cell">
                  {activeTab === "buy" ? "Cel sprzedaży" : "Cel odkupu"}
                </th>
                <th className="text-right p-2 sm:p-3 font-medium hidden md:table-cell">Trend</th>
                <th className="text-right p-2 sm:p-3 font-medium">P&L</th>
                <th className="text-center p-2 sm:p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {displayPositions.map((position, idx) => {
                const unrealized = calculateUnrealizedPnL(position);
                const entryPrice =
                  activeTab === "buy" ? position.buyPrice : position.sellPrice;
                const entryValue =
                  activeTab === "buy" ? position.buyValue : position.sellValue;
                const targetPrice =
                  activeTab === "buy"
                    ? position.targetSellPrice
                    : position.targetBuybackPrice;

                return (
                  <motion.tr
                    key={position.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="border-b border-grid-border/50 hover:bg-grid-bg/30"
                  >
                    <td className="p-2 sm:p-3 text-xs sm:text-sm text-gray-400">
                      <span className="hidden sm:inline">{formatDate(position.createdAt)}</span>
                      <span className="sm:hidden">
                        {new Date(position.createdAt).toLocaleDateString("pl-PL", {
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 text-right font-mono text-xs sm:text-sm">
                      {formatPrice(entryPrice)}
                    </td>
                    <td className="p-2 sm:p-3 text-right font-mono text-xs sm:text-sm text-gray-400 hidden md:table-cell">
                      {position.amount != null && position.amount > 0
                        ? position.amount.toFixed(6)
                        : "—"}
                    </td>
                    <td className="p-2 sm:p-3 text-right font-mono text-xs sm:text-sm hidden lg:table-cell">
                      {formatPrice(entryValue)}
                    </td>
                    <td
                      className={`p-2 sm:p-3 text-right font-mono text-xs sm:text-sm hidden lg:table-cell ${
                        activeTab === "buy"
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                      title={
                        activeTab === "buy" &&
                        targetPrice != null &&
                        targetPrice > 0
                          ? "Cena docelowa sprzedaży (z min. % zysku)"
                          : undefined
                      }
                    >
                      {formatPrice(targetPrice)}
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
                            <span className="hidden sm:inline">${Math.abs(unrealized.pnl).toFixed(2)}</span>
                            <span className="sm:hidden">${Math.abs(unrealized.pnl).toFixed(0)}</span>
                          </div>
                          <div className="text-[10px] sm:text-xs opacity-70">
                            {unrealized.pnlPercent >= 0 ? "+" : ""}
                            {unrealized.pnlPercent.toFixed(1)}%
                          </div>
                        </div>
                      )}
                      {position.status === "CLOSED" && position.profit && (
                        <div
                          className={`font-mono text-xs sm:text-sm ${
                            position.profit >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          <span className="hidden sm:inline">${position.profit.toFixed(2)}</span>
                          <span className="sm:hidden">${position.profit.toFixed(0)}</span>
                        </div>
                      )}
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
              <span className="hidden sm:inline">Suma otwartych {activeTab === "buy" ? "zakupów" : "sprzedaży"}:</span>
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
    </div>
  );
}
