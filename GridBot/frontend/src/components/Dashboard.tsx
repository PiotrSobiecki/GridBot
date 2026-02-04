import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, LogOut, Settings, TrendingUp, Wallet, 
  Activity, DollarSign, BarChart3, Zap
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../store/useStore';
import { api } from '../api';
import OrderTabs from './OrderTabs';
import OrderSettings from './OrderSettings';
import PriceDisplay from './PriceDisplay';
import PositionsTable from './PositionsTable';
import WalletPanel from './WalletPanel';
import type { OrderSettings as OrderSettingsType } from '../types';

const defaultOrder: Omit<OrderSettingsType, '_id'> = {
  name: 'Nowe Zlecenie',
  isActive: false,
  refreshInterval: 60,
  minProfitPercent: 0.5,
  focusPrice: 94000,
  timeToNewFocus: 0,
  buyTrendCounter: 0,
  sellTrendCounter: 0,
  buy: {
    currency: 'USDC',
    walletProtection: 0,
    mode: 'walletLimit',
    maxValue: 0,
    addProfit: false
  },
  sell: {
    currency: 'BTC',
    walletProtection: 0,
    mode: 'walletLimit',
    maxValue: 0,
    addProfit: false
  },
  platform: {
    minTransactionValue: 10,
    checkFeeProfit: true
  },
  buyConditions: {
    minValuePer1Percent: 200,
    priceThreshold: 100000,
    checkThresholdIfProfitable: true
  },
  sellConditions: {
    minValuePer1Percent: 200,
    priceThreshold: 89000,
    checkThresholdIfProfitable: true
  },
  trendPercents: [
    { trend: 0, buyPercent: 0.5, sellPercent: 0.5 },
    { trend: 1, buyPercent: 1, sellPercent: 1 },
    { trend: 2, buyPercent: 0.6, sellPercent: 0.3 },
    { trend: 5, buyPercent: 0.5, sellPercent: 0.5 },
    { trend: 10, buyPercent: 0.1, sellPercent: 1 }
  ],
  additionalBuyValues: [
    { condition: 'less', price: 104000, value: 50 },
    { condition: 'greaterEqual', price: 100000, value: 70 },
    { condition: 'greater', price: 89000, value: 250 }
  ],
  additionalSellValues: [
    { condition: 'less', price: 104000, value: 150 },
    { condition: 'greaterEqual', price: 100000, value: 100 },
    { condition: 'greater', price: 89000, value: 50 }
  ],
  maxBuyPerTransaction: [
    { condition: 'less', price: 104000, value: 500 },
    { condition: 'greaterEqual', price: 100000, value: 700 },
    { condition: 'greater', price: 89000, value: 2000 }
  ],
  maxSellPerTransaction: [
    { condition: 'less', price: 104000, value: 1500 },
    { condition: 'greaterEqual', price: 100000, value: 1000 },
    { condition: 'greater', price: 89000, value: 500 }
  ],
  buySwingPercent: [
    { minTrend: 0, maxTrend: 1, value: 0.1 },
    { minTrend: 1, maxTrend: 2, value: 0.2 },
    { minTrend: 2, maxTrend: 3, value: 0.5 },
    { minTrend: 3, maxTrend: 999, value: 1 }
  ],
  sellSwingPercent: [
    { minTrend: 0, maxTrend: 1, value: 0.1 },
    { minTrend: 1, maxTrend: 2, value: 0.2 },
    { minTrend: 2, maxTrend: 3, value: 0.5 },
    { minTrend: 3, maxTrend: 999, value: 1 }
  ]
};

export default function Dashboard() {
  const { 
    walletAddress, 
    userSettings, 
    activeOrderIndex, 
    setActiveOrderIndex,
    setUserSettings,
    prices,
    gridStates,
    logout 
  } = useStore();

  const [showWallet, setShowWallet] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const orders = userSettings?.orders || [];
  const activeOrder = orders[activeOrderIndex];
  const activeGridState = activeOrder?._id ? gridStates[activeOrder._id] : null;

  useEffect(() => {
    // Fetch prices periodically
    const fetchPrices = async () => {
      try {
        const priceData = await api.getPrices();
        Object.entries(priceData).forEach(([symbol, price]) => {
          useStore.getState().updatePrice(symbol, price as number);
        });
      } catch (error) {
        console.error('Failed to fetch prices:', error);
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAddOrder = async () => {
    try {
      setIsLoading(true);
      const newOrder = await api.createOrder({
        ...defaultOrder,
        name: `Zlecenie ${orders.length + 1}`
      });
      
      if (userSettings) {
        setUserSettings({
          ...userSettings,
          orders: [...userSettings.orders, newOrder]
        });
        setActiveOrderIndex(orders.length);
      }
      toast.success('Dodano nowe zlecenie');
    } catch (error: any) {
      toast.error(error.message || 'Błąd dodawania zlecenia');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      logout();
      toast.success('Wylogowano');
    } catch (error) {
      logout();
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-grid-border bg-grid-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <span className="font-display font-bold text-xl">GridBot</span>
            </div>

            {/* Price Ticker */}
            <PriceDisplay />

            {/* User Actions */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowWallet(!showWallet)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-grid-card border border-grid-border hover:border-emerald-500/50 transition-colors"
              >
                <Wallet className="w-4 h-4 text-emerald-400" />
                <span className="font-mono text-sm">{formatAddress(walletAddress || '')}</span>
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
      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left Sidebar - Order Tabs */}
          <div className="col-span-2">
            <div className="bg-grid-card rounded-xl border border-grid-border p-4 sticky top-24">
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
          <div className="col-span-7 space-y-6">
            {/* Stats Overview */}
            {activeOrder && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                {/* Główne statystyki */}
                <div className="grid grid-cols-4 gap-4">
                  <StatCard
                    icon={TrendingUp}
                    label="Trend Zakup"
                    value={activeGridState?.buyTrendCounter ?? activeOrder.buyTrendCounter}
                    color="emerald"
                    subtitle="Pozycje czekające na sprzedaż"
                  />
                  <StatCard
                    icon={BarChart3}
                    label="Trend Sprzedaż"
                    value={activeGridState?.sellTrendCounter ?? activeOrder.sellTrendCounter}
                    color="red"
                    subtitle="Pozycje czekające na odkup"
                  />
                  <StatCard
                    icon={DollarSign}
                    label="Cena Focus"
                    value={`$${(activeGridState?.currentFocusPrice ?? activeOrder.focusPrice).toLocaleString()}`}
                    color="amber"
                    subtitle={activeGridState?.lastKnownPrice ? `Aktualna: $${activeGridState.lastKnownPrice.toLocaleString()}` : ''}
                  />
                  <StatCard
                    icon={Activity}
                    label="Całkowity Profit"
                    value={`$${(activeGridState?.totalProfit ?? 0).toFixed(2)}`}
                    color={activeGridState?.totalProfit && activeGridState.totalProfit > 0 ? 'emerald' : 'gray'}
                    subtitle={`${(activeGridState?.totalBuyTransactions ?? 0) + (activeGridState?.totalSellTransactions ?? 0)} transakcji`}
                  />
                </div>
                
                {/* Cele cenowe */}
                {activeGridState && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-grid-card rounded-xl border border-emerald-500/30 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs text-gray-500">Następny cel ZAKUPU</div>
                          <div className="text-xl font-mono font-bold text-emerald-400">
                            ${activeGridState.nextBuyTarget?.toLocaleString() ?? '-'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-500">Próg cenowy</div>
                          <div className="text-sm font-mono text-gray-400">
                            ${activeOrder.buyConditions.priceThreshold.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="bg-grid-card rounded-xl border border-red-500/30 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs text-gray-500">Następny cel SPRZEDAŻY</div>
                          <div className="text-xl font-mono font-bold text-red-400">
                            ${activeGridState.nextSellTarget?.toLocaleString() ?? '-'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-500">Próg cenowy</div>
                          <div className="text-sm font-mono text-gray-400">
                            ${activeOrder.sellConditions.priceThreshold.toLocaleString()}
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
              />
            ) : (
              <div className="bg-grid-card rounded-xl border border-grid-border p-12 text-center">
                <Settings className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                <h3 className="text-xl font-semibold mb-2">Brak zleceń</h3>
                <p className="text-gray-500 mb-6">Dodaj pierwsze zlecenie, aby rozpocząć trading</p>
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
            {activeOrder && (
              <PositionsTable orderId={activeOrder._id || ''} />
            )}
          </div>

          {/* Right Sidebar - Wallet */}
          <div className="col-span-3">
            <AnimatePresence>
              {showWallet && (
                <WalletPanel onClose={() => setShowWallet(false)} />
              )}
            </AnimatePresence>
            
            {!showWallet && (
              <div className="bg-grid-card rounded-xl border border-grid-border p-4 sticky top-24">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-400" />
                  Portfel
                </h3>
                <div className="space-y-3">
                  {userSettings?.wallet.slice(0, 4).map((item) => (
                    <div key={item.currency} className="flex justify-between items-center">
                      <span className="text-gray-400">{item.currency}</span>
                      <span className="font-mono">{item.balance.toLocaleString()}</span>
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
    </div>
  );
}

function StatCard({ 
  icon: Icon, 
  label, 
  value, 
  color,
  subtitle
}: { 
  icon: any; 
  label: string; 
  value: string | number; 
  color: string;
  subtitle?: string;
}) {
  const colorClasses: Record<string, string> = {
    emerald: 'text-emerald-400 bg-emerald-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    red: 'text-red-400 bg-red-500/10',
    gray: 'text-gray-400 bg-gray-500/10'
  };

  return (
    <div className="bg-grid-card rounded-xl border border-grid-border p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="text-xs text-gray-500">{label}</div>
          <div className="font-mono font-semibold">{value}</div>
          {subtitle && <div className="text-xs text-gray-600 mt-0.5">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}
