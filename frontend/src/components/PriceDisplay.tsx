import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { useStore } from "../store/useStore";
import { api } from "../api";

export default function PriceDisplay() {
  const { prices, userSettings, activeOrderIndex, updatePrice } = useStore();

  const orders = userSettings?.orders || [];
  const activeOrder = orders[activeOrderIndex] ?? orders[0];
  // Pasek odświeża się co min(refreshInterval) ze wszystkich zleceń – przy 30s i 60s będzie co 30s
  const intervals = orders
    .map((o) => Number(o?.refreshInterval) || 5)
    .filter((s) => s > 0);
  const refreshIntervalSec =
    intervals.length > 0 ? Math.min(...intervals) : 5;
  const refreshIntervalMs = refreshIntervalSec * 1000;

  // Sztywna lista krypto do wyświetlenia na pasku (zawsze pokazujemy te, nawet jeśli brak cen)
  const DISPLAYED_CRYPTOS = ["ASTER", "BTC", "ETH", "SOL", "BNB", "XRP"];
  const [baseAssets] = useState<string[]>(DISPLAYED_CRYPTOS);

  // Pobieraj ceny z backendu w tym samym interwale co odświeżanie / sprawdzanie na stronie
  useEffect(() => {
    const loadPrices = () => {
      api
        .getPrices()
        .then((allPrices: Record<string, any>) => {
          // Backend zwraca teraz obiekty: { price: "...", priceChangePercent: ... }
          Object.entries(allPrices).forEach(([symbol, data]) => {
            let numPrice: number;
            let changePercent: number | null = null;

            if (typeof data === "object" && data !== null && "price" in data) {
              // Nowy format: { price: "...", priceChangePercent: ... }
              numPrice =
                typeof data.price === "string"
                  ? parseFloat(data.price)
                  : Number(data.price);
              changePercent =
                data.priceChangePercent != null
                  ? Number(data.priceChangePercent)
                  : null;
            } else {
              // Stary format (fallback): sam string/number
              numPrice =
                typeof data === "string" ? parseFloat(data) : Number(data);
            }

            if (!isNaN(numPrice) && numPrice > 0) {
              updatePrice(symbol, numPrice, changePercent);
            }
          });
        })
        .catch((err) => {
          console.error("❌ Failed to load prices:", err);
        });
    };

    loadPrices();
    const intervalId = setInterval(loadPrices, refreshIntervalMs);

    return () => clearInterval(intervalId);
  }, [updatePrice, refreshIntervalMs]);

  const formatPrice = (symbol: string, price: number | string) => {
    const numPrice = typeof price === "string" ? parseFloat(price) : price;
    if (isNaN(numPrice)) return "0.00";

    // Formatowanie w zależności od symbolu
    if (symbol.includes("DOGE") || symbol.includes("SHIB")) {
      return numPrice.toFixed(5);
    }
    if (numPrice < 1) {
      return numPrice.toFixed(4);
    }
    return numPrice.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Znajdź aktywną parę z aktywnego zlecenia
  const activeBaseAsset = activeOrder?.baseAsset || null;

  // Wyświetl tylko BASE assets (krypto) z ich cenami
  // Renderuj listę dwa razy dla płynnego przewijania bez "skoku"
  const renderPriceItem = (baseAsset: string, index: number) => {
    // Symbol pary = BASE + USDT (np. BTCUSDT)
    const symbol = `${baseAsset}USDT`;
    const priceData = prices[symbol];
    const price = priceData?.price ?? 0;
    const isActive = baseAsset === activeBaseAsset;
    const change24h = priceData?.priceChangePercent ?? null;
    const isPositive = change24h != null && change24h > 0;

    return (
      <div
        key={`${baseAsset}-${index}`}
        className={`flex items-center gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3 py-0.5 sm:py-1 rounded transition-colors ${
          isActive
            ? "bg-emerald-500/20 border border-emerald-500/40"
            : "hover:bg-grid-bg/50"
        }`}
      >
        <span
          className={`text-xs sm:text-sm ${
            isActive ? "text-emerald-300 font-semibold" : "text-gray-500"
          }`}
        >
          {baseAsset}
        </span>
        <span
          className={`font-mono text-xs sm:text-sm ${
            isActive ? "text-emerald-400" : "text-gray-300"
          }`}
        >
          ${formatPrice(symbol, price)}
        </span>
        {change24h != null && (
          <span
            className={`flex items-center ${
              isPositive ? "text-emerald-400" : "text-red-400"
            }`}
            title={`24h change: ${change24h.toFixed(2)}%`}
          >
            {isPositive ? (
              <ArrowUp className="w-3 h-3" />
            ) : (
              <ArrowDown className="w-3 h-3" />
            )}
          </span>
        )}
      </div>
    );
  };

  // Płynny, nieskończony scroll oparty o requestAnimationFrame
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let frameId: number;
    let lastTs: number | null = null;
    let offset = 0;
    const speed = 30; // px/s

    const loop = (ts: number) => {
      if (lastTs == null) {
        lastTs = ts;
      }
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      const el = trackRef.current;
      if (el) {
        // scrollWidth zawiera obie kopie listy (2x szerokość jednej kopii)
        const totalWidth = el.scrollWidth;
        const singleCopyWidth = totalWidth / 2; // szerokość jednej kopii

        if (singleCopyWidth > 0) {
          offset -= speed * dt;

          // Zawijanie: gdy przesunęliśmy się o szerokość jednej kopii,
          // resetujemy offset, żeby scroll był ciągły (druga kopia jest identyczna)
          // Używamy lepszej logiki dla ujemnych offsetów
          while (Math.abs(offset) >= singleCopyWidth) {
            if (offset < 0) {
              offset += singleCopyWidth;
            } else {
              offset -= singleCopyWidth;
            }
          }

          el.style.transform = `translateX(${offset}px)`;
        }
      }

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [baseAssets]); // Dodajemy baseAssets do zależności, żeby restartować po zmianie listy

  return (
    <div className="flex-1 overflow-hidden relative">
      <div
        ref={trackRef}
        className="flex items-center gap-3 sm:gap-6 will-change-transform"
        style={{ whiteSpace: "nowrap" }}
      >
        {/* Dwie kopie listy – dzięki temu scroll jest w pełni ciągły */}
        {baseAssets.map((baseAsset, idx) => renderPriceItem(baseAsset, idx))}
        {baseAssets.map((baseAsset, idx) =>
          renderPriceItem(baseAsset, idx + baseAssets.length),
        )}
      </div>
    </div>
  );
}
