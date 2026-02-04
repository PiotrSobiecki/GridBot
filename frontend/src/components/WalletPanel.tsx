import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Wallet, Edit2, Save, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../store/useStore';
import { api } from '../api';
import type { WalletBalance } from '../types';

interface WalletPanelProps {
  onClose: () => void;
}

export default function WalletPanel({ onClose }: WalletPanelProps) {
  const { userSettings, setUserSettings } = useStore();
  const [isEditing, setIsEditing] = useState(false);
  const [localWallet, setLocalWallet] = useState<WalletBalance[]>(userSettings?.wallet || []);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.updateWallet(localWallet);
      
      if (userSettings) {
        setUserSettings({ ...userSettings, wallet: localWallet });
      }
      
      setIsEditing(false);
      toast.success('Zapisano portfel');
    } catch (error: any) {
      toast.error(error.message || 'Błąd zapisywania');
    } finally {
      setIsSaving(false);
    }
  };

  const updateBalance = (index: number, field: keyof WalletBalance, value: string | number) => {
    const newWallet = [...localWallet];
    newWallet[index] = { ...newWallet[index], [field]: value };
    setLocalWallet(newWallet);
  };

  const addCurrency = () => {
    setLocalWallet([...localWallet, { currency: 'NEW', balance: 0, reserved: 0 }]);
  };

  const removeCurrency = (index: number) => {
    setLocalWallet(localWallet.filter((_, i) => i !== index));
  };

  const getTotalValue = () => {
    // Simplified - in production, multiply by actual prices
    const btc = localWallet.find(w => w.currency === 'BTC');
    const eth = localWallet.find(w => w.currency === 'ETH');
    const usdc = localWallet.find(w => w.currency === 'USDC');
    
    let total = usdc?.balance || 0;
    if (btc) total += btc.balance * 94000; // Approximate
    if (eth) total += (eth.balance || 0) * 3200;
    
    return total;
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="bg-grid-card rounded-xl border border-grid-border sticky top-24"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-grid-border">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-emerald-400" />
          <h3 className="font-semibold">Portfel</h3>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
            >
              <Save className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="p-2 rounded-lg hover:bg-grid-bg text-gray-400 hover:text-white"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-grid-bg text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Total Value */}
      <div className="p-4 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border-b border-grid-border">
        <div className="text-xs text-gray-500 mb-1">Szacowana wartość</div>
        <div className="text-2xl font-bold font-mono">
          ${getTotalValue().toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
      </div>

      {/* Balances */}
      <div className="p-4 space-y-3">
        {localWallet.map((item, index) => (
          <div 
            key={index} 
            className={`flex items-center justify-between p-3 rounded-lg ${
              isEditing ? 'bg-grid-bg/50' : ''
            }`}
          >
            {isEditing ? (
              <>
                <input
                  type="text"
                  value={item.currency}
                  onChange={(e) => updateBalance(index, 'currency', e.target.value.toUpperCase())}
                  className="w-20 px-2 py-1 bg-grid-bg border border-grid-border rounded text-sm font-medium"
                />
                <input
                  type="number"
                  step="any"
                  value={item.balance}
                  onChange={(e) => updateBalance(index, 'balance', Number(e.target.value))}
                  className="w-32 px-2 py-1 bg-grid-bg border border-grid-border rounded text-sm font-mono text-right"
                />
                <button
                  onClick={() => removeCurrency(index)}
                  className="p-1 text-gray-500 hover:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    item.currency === 'BTC' ? 'bg-orange-500/20 text-orange-400' :
                    item.currency === 'ETH' ? 'bg-blue-500/20 text-blue-400' :
                    item.currency === 'USDC' ? 'bg-green-500/20 text-green-400' :
                    item.currency === 'DOGE' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {item.currency.slice(0, 2)}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{item.currency}</div>
                    {item.reserved > 0 && (
                      <div className="text-xs text-gray-500">
                        Zarezerwowano: {item.reserved}
                      </div>
                    )}
                  </div>
                </div>
                <div className="font-mono text-right">
                  <div className="text-sm">{item.balance.toLocaleString()}</div>
                  <div className="text-xs text-gray-500">
                    Dostępne: {(item.balance - item.reserved).toLocaleString()}
                  </div>
                </div>
              </>
            )}
          </div>
        ))}

        {isEditing && (
          <button
            onClick={addCurrency}
            className="w-full py-2 border border-dashed border-grid-border rounded-lg text-sm text-gray-500 hover:text-emerald-400 hover:border-emerald-500/50 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Dodaj walutę
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-4 border-t border-grid-border text-xs text-gray-500">
        <p>💡 Wartości portfela są symulowane. W produkcji połącz z prawdziwym portfelem lub giełdą.</p>
      </div>
    </motion.div>
  );
}
