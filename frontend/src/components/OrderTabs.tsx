import { Reorder, motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import {
  Activity,
  Pause,
  GripVertical,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import toast from "react-hot-toast";
import { useStore } from "../store/useStore";
import { api } from "../api";
import type { OrderSettings, GridState } from "../types";

const BINGX_GLOBAL_BASES = ["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE"];

interface OrderTabsProps {
  orders: OrderSettings[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onReorder: (reorderedOrders: OrderSettings[]) => void;
  gridStates: Record<string, GridState>;
}

function OrderCard({
  order,
  index,
  isActive,
  onSelect,
  gridStates,
}: {
  order: OrderSettings;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  gridStates: Record<string, GridState>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const { positions, prices, updatePrice } = useStore((state) => ({
    positions: state.positions,
    prices: state.prices,
    updatePrice: state.updatePrice,
  }));

  const gridState = order._id ? gridStates[order._id] : null;
  const isRunning = gridState?.isActive ?? order.isActive;

  const orderId = order._id || (order as any).id;
  const shortOrderId =
    orderId && typeof orderId === "string" ? `${orderId.slice(0, 5)}…` : "";

  const orderPositions = orderId ? positions[orderId] || [] : [];
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
  const totalOpenCount = openBuyPositions.length + openSellPositions.length;

  const baseAsset = order.baseAsset || (order as any).sell?.currency || "BTC";
  const quoteAsset =
    order.quoteAsset || (order as any).buy?.currency || "USDT";
  const symbol = `${baseAsset}${quoteAsset}`;
  const priceData = prices[symbol];
  const raw = (priceData as any)?.rawPrice ?? priceData?.price ?? null;
  const priceLabel =
    raw != null && !Number.isNaN(Number(raw)) && Number(raw) > 0
      ? `$${String(raw)}`
      : "—";

  useEffect(() => {
    const exchange = (order as any).exchange;
    if (exchange !== "bingx") return;
    if (BINGX_GLOBAL_BASES.includes(baseAsset.toUpperCase())) return;
    if (prices[symbol]?.price) return;
    api
      .getBingxPrice(symbol)
      .then((info) => {
        if (info?.price != null) {
          const num =
            typeof info.price === "string"
              ? parseFloat(info.price)
              : Number(info.price);
          (updatePrice as any)(
            symbol,
            num,
            info.priceChangePercent ?? null,
            info.price,
          );
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  return (
    <Reorder.Item
      value={order}
      layout
      layoutId={order._id || String(index)}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      className="relative cursor-grab active:cursor-grabbing"
      style={{ zIndex: isDragging ? 50 : "auto" }}
      whileDrag={{
        scale: 1.04,
        boxShadow:
          "0 16px 48px rgba(0,0,0,0.55), 0 0 0 2px rgba(52,211,153,0.35)",
        borderRadius: "0.5rem",
        zIndex: 50,
      }}
      transition={{
        layout: { type: "spring", stiffness: 400, damping: 30 },
        scale: { duration: 0.15 },
      }}
    >
      {/* Cały kafelek klikalny – wybiera zlecenie */}
      <div
        className={`rounded-lg border transition-colors cursor-pointer ${
          isDragging
            ? "bg-grid-card border-emerald-500/40"
            : isActive
              ? "bg-emerald-500/10 border-emerald-500/30"
              : "bg-grid-bg/50 border-transparent hover:border-grid-border"
        }`}
        onClick={onSelect}
      >
        {/* Nagłówek kafelka */}
        <div className="flex items-center gap-1 p-2">
          {/* Uchwyt drag – wyłącznie wizualny */}
          <span
            className="text-gray-600 p-0.5 flex-shrink-0"
            title="Przeciągnij aby zmienić kolejność"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </span>

          {/* Nazwa i status – wypełniają resztę */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {isRunning ? (
              <div className="relative flex-shrink-0">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-400 rounded-full pulse-dot" />
              </div>
            ) : (
              <Pause className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
            )}
            <span
              className={`text-sm font-medium truncate ${
                isActive ? "text-white" : "text-gray-400"
              }`}
            >
              {order.name}
            </span>
          </div>

          {/* Przycisk zwijania – stopPropagation żeby nie wywołać onSelect */}
          <button
            className="text-gray-600 hover:text-gray-300 p-0.5 flex-shrink-0 transition-colors"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((c) => !c);
            }}
            title={collapsed ? "Rozwiń" : "Zwiń"}
          >
            {collapsed ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Szczegóły – zwijalne */}
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="details"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="px-2 pb-2 space-y-1">
                {orderId && (
                  <div className="flex items-center justify-between gap-1 text-[10px] text-gray-500">
                    <span className="font-mono text-gray-400">
                      {shortOrderId}
                    </span>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation(); // nie wybiera zlecenia przy kopiowaniu
                        if (navigator?.clipboard?.writeText && orderId) {
                          navigator.clipboard
                            .writeText(orderId)
                            .then(() => toast.success("Skopiowano ID zlecenia"))
                            .catch(() => {});
                        }
                      }}
                      className="px-1.5 py-0.5 border border-grid-border rounded text-[10px] text-gray-400 hover:text-emerald-300 hover:border-emerald-400 transition-colors"
                    >
                      Kopiuj
                    </button>
                  </div>
                )}

                <div className="flex flex-col gap-0.5 text-xs">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-gray-500">Cena:</span>
                    <span className="text-amber-400 font-mono">
                      {priceLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-gray-500">Otwarte:</span>
                    <span className="text-emerald-400 font-mono">
                      ${totalOpenValue.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 text-right">
                    {totalOpenCount} pozycji
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Reorder.Item>
  );
}

export default function OrderTabs({
  orders,
  activeIndex,
  onSelect,
  onReorder,
  gridStates,
}: OrderTabsProps) {
  if (orders.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">Brak zleceń</div>
    );
  }

  return (
    <Reorder.Group
      axis="y"
      values={orders}
      onReorder={onReorder}
      className="flex flex-col gap-1.5"
    >
      {orders.map((order, index) => (
        <OrderCard
          key={order._id || index}
          order={order}
          index={index}
          isActive={index === activeIndex}
          onSelect={() => onSelect(index)}
          gridStates={gridStates}
        />
      ))}
    </Reorder.Group>
  );
}
