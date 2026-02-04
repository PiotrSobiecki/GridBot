import { motion } from 'framer-motion';
import { Activity, Pause, Trash2 } from 'lucide-react';
import type { OrderSettings, GridState } from '../types';

interface OrderTabsProps {
  orders: OrderSettings[];
  activeIndex: number;
  onSelect: (index: number) => void;
  gridStates: Record<string, GridState>;
}

export default function OrderTabs({ orders, activeIndex, onSelect, gridStates }: OrderTabsProps) {
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
                <span className={`text-sm font-medium ${isActive ? 'text-white' : 'text-gray-400'}`}>
                  {order.name}
                </span>
              </div>
            </div>
            
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Trend:</span>
                <span className="text-emerald-400 font-mono">
                  {gridState?.buyTrendCounter ?? order.buyTrendCounter}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Focus:</span>
                <span className="text-amber-400 font-mono">
                  ${((gridState?.currentFocusPrice ?? order.focusPrice) / 1000).toFixed(1)}k
                </span>
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
