import { motion } from "framer-motion";
import { Activity, Pause } from "lucide-react";
import toast from "react-hot-toast";
import { useStore } from "../store/useStore";
import type { OrderSettings, GridState } from "../types";

interface OrderTabsProps {
  orders: OrderSettings[];
  activeIndex: number;
  onSelect: (index: number) => void;
  gridStates: Record<string, GridState>;
}

export default function OrderTabs({
  orders,
  activeIndex,
  onSelect,
  gridStates,
}: OrderTabsProps) {
  const { positions, prices } = useStore((state) => ({
    positions: state.positions,
    prices: state.prices,
  }));

  if (orders.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        Brak zleceń
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {orders.map((order, index) => {
        const isActive = index === activeIndex;
        const gridState = order._id ? gridStates[order._id] : null;
        const isRunning = gridState?.isActive ?? order.isActive;

        const orderId = order._id || (order as any).id;
        const orderPositions = orderId ? positions[orderId] || [] : [];
        const shortOrderId =
          orderId && typeof orderId === "string"
            ? `${orderId.slice(0, 5)}…`
            : "";

        const openBuyPositions = orderPositions.filter(
          (p) => (p.type === "BUY" || !p.type) && p.status === "OPEN",
        );
        const openSellPositions = orderPositions.filter(
          (p) => p.type === "SELL" && p.status === "OPEN",
        );

        const openBuyValue = openBuyPositions.reduce((sum, p) => {
          const value =
            typeof p.buyValue === "number" && p.buyValue > 0
              ? p.buyValue
              : p.buyPrice && p.amount
                ? Number(p.buyPrice) * Number(p.amount)
                : 0;
          return sum + value;
        }, 0);

        const openSellValue = openSellPositions.reduce((sum, p) => {
          const value =
            typeof p.sellValue === "number" && p.sellValue > 0
              ? p.sellValue
              : p.sellPrice && p.amount
                ? Number(p.sellPrice) * Number(p.amount)
                : 0;
          return sum + value;
        }, 0);

        const totalOpenValue = openBuyValue + openSellValue;
        const totalOpenCount =
          openBuyPositions.length + openSellPositions.length;

        // Aktualna cena aktywa dla tego zlecenia
        const baseAsset =
          order.baseAsset || (order as any).sell?.currency || "BTC";
        const quoteAsset =
          order.quoteAsset || (order as any).buy?.currency || "USDT";
        const symbol = `${baseAsset}${quoteAsset}`;
        const priceData = prices[symbol];
        const raw =
          (priceData as any)?.rawPrice ?? priceData?.price ?? null;
        const priceLabel =
          raw != null && !Number.isNaN(Number(raw)) && Number(raw) > 0
            ? `$${String(raw)}`
            : "—";

        return (
          <motion.button
            key={order._id || index}
            onClick={() => onSelect(index)}
            className={`w-full text-left p-3 rounded-lg transition-all ${
              isActive 
                ? 'bg-emerald-500/10 border border-emerald-500/30' 
                : 'bg-grid-bg/50 border border-transparent hover:border-grid-border'
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isRunning ? (
                    <div className="relative">
                      <Activity className="w-4 h-4 text-emerald-400" />
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full pulse-dot" />
                    </div>
                  ) : (
                    <Pause className="w-4 h-4 text-gray-500" />
                  )}
                  <span
                    className={`text-sm font-medium ${
                      isActive ? "text-white" : "text-gray-400"
                    }`}
                  >
                    {order.name}
                  </span>
                </div>
              </div>

              {orderId && (
                <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
                  <div className="flex items-center gap-1">
                    <span>ID:</span>
                    <span className="font-mono text-gray-300">
                      {shortOrderId}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (navigator?.clipboard?.writeText && orderId) {
                        navigator.clipboard
                          .writeText(orderId)
                          .then(() => {
                            toast.success("Skopiowano ID zlecenia");
                          })
                          .catch(() => {});
                      }
                    }}
                    className="px-1.5 py-0.5 border border-grid-border rounded text-[10px] text-gray-400 hover:text-emerald-300 hover:border-emerald-400 transition-colors"
                  >
                    Kopiuj
                  </button>
                </div>
              )}
            </div>

            <div className="mt-2 flex flex-col gap-0.5 text-xs">
              <div className="flex items-center justify-between gap-1">
                <span className="text-gray-500">Cena:</span>
                <span className="text-amber-400 font-mono">{priceLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-gray-500">Otwarte pozycje:</span>
                <span className="text-emerald-400 font-mono">
                  ${totalOpenValue.toFixed(2)}
                </span>
              </div>
              <div className="text-[10px] text-gray-500 text-right">
                {totalOpenCount} pozycji
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
