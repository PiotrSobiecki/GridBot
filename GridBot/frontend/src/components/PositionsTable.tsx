import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, TrendingUp, TrendingDown, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { api } from '../api';
import type { Position } from '../types';

interface PositionsTableProps {
  orderId: string;
}

export default function PositionsTable({ orderId }: PositionsTableProps) {
  const { walletAddress, positions, setPositions, prices } = useStore();
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');

  const orderPositions = positions[orderId] || [];
  const currentPrice = prices['BTCUSDT']?.price || 0;

  // Filtruj pozycje według typu
  const buyPositions = orderPositions.filter(p => p.type === 'BUY' || !p.type);
  const sellPositions = orderPositions.filter(p => p.type === 'SELL');

  const fetchPositions = async () => {
    if (!walletAddress || !orderId) return;
    
    setIsLoading(true);
    try {
      const data = await api.getPositions(walletAddress, orderId);
      setPositions(orderId, data);
    } catch (error) {
      console.error('Failed to fetch positions:', error);
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
    return new Date(dateStr).toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const calculateUnrealizedPnL = (position: Position) => {
    if (position.status !== 'OPEN') return null;
    
    if (position.type === 'SELL') {
      // Dla short: profit gdy cena spada
      const pnl = (position.sellPrice - currentPrice) * position.amount;
      const pnlPercent = ((position.sellPrice - currentPrice) / position.sellPrice) * 100;
      return { pnl, pnlPercent };
    } else {
      // Dla buy: profit gdy cena rośnie
      const pnl = (currentPrice - position.buyPrice) * position.amount;
      const pnlPercent = ((currentPrice - position.buyPrice) / position.buyPrice) * 100;
      return { pnl, pnlPercent };
    }
  };

  const displayPositions = activeTab === 'buy' ? buyPositions : sellPositions;

  return (
    <div className="bg-grid-card rounded-xl border border-grid-border overflow-hidden">
      {/* Header z zakładkami */}
      <div className="flex items-center justify-between p-4 border-b border-grid-border">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveTab('buy')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'buy' 
                ? 'bg-emerald-500/20 text-emerald-400' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ArrowDownCircle className="w-4 h-4" />
            Pozycje Zakup ({buyPositions.filter(p => p.status === 'OPEN').length})
          </button>
          <button
            onClick={() => setActiveTab('sell')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'sell' 
                ? 'bg-red-500/20 text-red-400' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ArrowUpCircle className="w-4 h-4" />
            Pozycje Sprzedaż ({sellPositions.filter(p => p.status === 'OPEN').length})
          </button>
        </div>
        <button
          onClick={fetchPositions}
          disabled={isLoading}
          className="p-2 rounded-lg hover:bg-grid-bg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {displayPositions.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          {activeTab === 'buy' ? (
            <>
              <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Brak otwartych pozycji zakupowych</p>
              <p className="text-sm mt-1">Pozycje pojawią się gdy cena spadnie do celu zakupu</p>
            </>
          ) : (
            <>
              <TrendingDown className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Brak otwartych pozycji sprzedażowych</p>
              <p className="text-sm mt-1">Pozycje pojawią się gdy cena wzrośnie do celu sprzedaży</p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-grid-border">
                <th className="text-left p-3 font-medium">Data</th>
                <th className="text-right p-3 font-medium">
                  {activeTab === 'buy' ? 'Cena zakupu' : 'Cena sprzedaży'}
                </th>
                <th className="text-right p-3 font-medium">Ilość</th>
                <th className="text-right p-3 font-medium">Wartość</th>
                <th className="text-right p-3 font-medium">
                  {activeTab === 'buy' ? 'Cel sprzedaży' : 'Cel odkupu'}
                </th>
                <th className="text-right p-3 font-medium">Trend</th>
                <th className="text-right p-3 font-medium">Niezreal. P&L</th>
                <th className="text-center p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {displayPositions.map((position, idx) => {
                const unrealized = calculateUnrealizedPnL(position);
                const entryPrice = activeTab === 'buy' ? position.buyPrice : position.sellPrice;
                const entryValue = activeTab === 'buy' ? position.buyValue : position.sellValue;
                const targetPrice = activeTab === 'buy' ? position.targetSellPrice : position.targetBuybackPrice;
                
                return (
                  <motion.tr
                    key={position.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="border-b border-grid-border/50 hover:bg-grid-bg/30"
                  >
                    <td className="p-3 text-sm text-gray-400">
                      {formatDate(position.createdAt)}
                    </td>
                    <td className="p-3 text-right font-mono text-sm">
                      ${entryPrice?.toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-mono text-sm text-gray-400">
                      {position.amount?.toFixed(6)}
                    </td>
                    <td className="p-3 text-right font-mono text-sm">
                      ${entryValue?.toFixed(2)}
                    </td>
                    <td className={`p-3 text-right font-mono text-sm ${
                      activeTab === 'buy' ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      ${targetPrice?.toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-mono text-sm">
                      <span className={`px-2 py-0.5 rounded ${
                        activeTab === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {position.trendAtBuy}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {unrealized && (
                        <div className={`font-mono text-sm ${unrealized.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          <div className="flex items-center justify-end gap-1">
                            {unrealized.pnl >= 0 ? (
                              <TrendingUp className="w-3 h-3" />
                            ) : (
                              <TrendingDown className="w-3 h-3" />
                            )}
                            ${Math.abs(unrealized.pnl).toFixed(2)}
                          </div>
                          <div className="text-xs opacity-70">
                            {unrealized.pnlPercent >= 0 ? '+' : ''}{unrealized.pnlPercent.toFixed(2)}%
                          </div>
                        </div>
                      )}
                      {position.status === 'CLOSED' && position.profit && (
                        <div className={`font-mono text-sm ${position.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          ${position.profit.toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        position.status === 'OPEN' 
                          ? 'status-active' 
                          : position.status === 'CLOSED' 
                            ? 'status-profit'
                            : 'status-inactive'
                      }`}>
                        {position.status === 'OPEN' ? 'Otwarta' : 
                         position.status === 'CLOSED' ? 'Zamknięta' : 'Anulowana'}
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
        <div className="p-4 bg-grid-bg/30 border-t border-grid-border">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">
              Suma otwartych {activeTab === 'buy' ? 'zakupów' : 'sprzedaży'}:
            </span>
            <span className="font-mono">
              ${displayPositions
                .filter(p => p.status === 'OPEN')
                .reduce((sum, p) => sum + (activeTab === 'buy' ? (p.buyValue || 0) : (p.sellValue || 0)), 0)
                .toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
