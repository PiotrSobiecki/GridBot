import { useState } from 'react';
import { BrowserProvider } from 'ethers';
import { SiweMessage } from 'siwe';
import { motion } from 'framer-motion';
import { Wallet, Zap, Shield, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../store/useStore';
import { api } from '../api';

declare global {
  interface Window {
    ethereum?: any;
  }
}

export default function ConnectWallet() {
  const [isConnecting, setIsConnecting] = useState(false);
  const { setAuth, setUserSettings } = useStore();

  const connectWallet = async () => {
    if (!window.ethereum) {
      toast.error('Zainstaluj MetaMask lub inny portfel Web3!');
      return;
    }

    setIsConnecting(true);

    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const chainId = (await provider.getNetwork()).chainId;

      // Pobierz nonce z serwera
      const { nonce } = await api.getNonce();

      // Utwórz wiadomość SIWE (bez polskich znaków - encoding issue)
      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to GridBot Trading',
        uri: window.location.origin,
        version: '1',
        chainId: Number(chainId),
        nonce
      });

      const messageToSign = message.prepareMessage();
      const signature = await signer.signMessage(messageToSign);

      // Weryfikuj podpis na serwerze
      const { token, walletAddress } = await api.verify(messageToSign, signature);

      // Ustaw token i pobierz ustawienia
      api.setToken(token);
      const settings = await api.getSettings();

      setAuth(walletAddress, token);
      setUserSettings(settings);

      toast.success('Połączono pomyślnie!');
    } catch (error: any) {
      console.error('Connection error:', error);
      toast.error(error.message || 'Błąd połączenia z portfelem');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-lg w-full"
      >
        {/* Logo i tytuł */}
        <div className="text-center mb-12">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 mb-6 shadow-2xl"
          >
            <Zap className="w-12 h-12 text-white" />
          </motion.div>
          
          <h1 className="text-5xl font-display font-bold mb-4">
            <span className="gradient-text">GridBot</span>
          </h1>
          <p className="text-gray-400 text-lg">
            Automatyczny Trading Bot z algorytmem GRID
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          {[
            { icon: Shield, label: 'Bezpieczny', desc: 'Web3 Auth' },
            { icon: TrendingUp, label: 'Algorytm GRID', desc: 'Smart Trading' },
            { icon: Wallet, label: 'Multi-Wallet', desc: 'Twój portfel' }
          ].map((feature, i) => (
            <motion.div
              key={feature.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              className="text-center p-4 rounded-xl bg-grid-card/50 border border-grid-border"
            >
              <feature.icon className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
              <div className="font-semibold text-sm">{feature.label}</div>
              <div className="text-xs text-gray-500">{feature.desc}</div>
            </motion.div>
          ))}
        </div>

        {/* Connect Button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          onClick={connectWallet}
          disabled={isConnecting}
          className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 
                     hover:from-emerald-400 hover:to-teal-400 
                     text-white font-semibold text-lg
                     flex items-center justify-center gap-3
                     transition-all duration-300 transform hover:scale-[1.02]
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                     shadow-lg shadow-emerald-500/25"
        >
          {isConnecting ? (
            <>
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Łączenie...
            </>
          ) : (
            <>
              <Wallet className="w-6 h-6" />
              Połącz Portfel Web3
            </>
          )}
        </motion.button>

        <p className="text-center text-gray-500 text-sm mt-6">
          Wymagany MetaMask lub kompatybilny portfel Web3
        </p>
      </motion.div>
    </div>
  );
}
