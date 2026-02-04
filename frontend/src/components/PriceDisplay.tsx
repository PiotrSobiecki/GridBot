import { useStore } from '../store/useStore';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT', 'SOLUSDT'];

export default function PriceDisplay() {
  const { prices } = useStore();

  const formatPrice = (symbol: string, price: number | string) => {
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    if (isNaN(numPrice)) return '0.00';
    
    if (symbol === 'DOGEUSDT') {
      return numPrice.toFixed(4);
    }
    return numPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getSymbolName = (symbol: string) => {
    return symbol.replace('USDT', '');
  };

  return (
    <div className="flex items-center gap-6">
      {SYMBOLS.map((symbol) => {
        const priceData = prices[symbol];
        const price = priceData?.price ?? 0;
        
        return (
          <div key={symbol} className="flex items-center gap-2">
            <span className="text-gray-500 text-sm">{getSymbolName(symbol)}</span>
            <span className="font-mono text-sm">
              ${formatPrice(symbol, price)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
