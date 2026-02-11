import Decimal from 'decimal.js';

/**
 * Serwis do zarządzania portfelem użytkownika
 * W trybie symulacji przechowuje salda lokalnie
 * W produkcji połączyć z prawdziwym API giełdy (np. Aster DEX)
 */

// Symulowane salda portfeli: walletAddress -> currency -> balance
const walletBalances = new Map();

// Domyślne salda dla nowych portfeli
const DEFAULT_BALANCES = {
  USDC: '10000',
  USDT: '10000',
  BTC: '1',
  ETH: '10',
  DOGE: '10000',
  SOL: '50'
};

/**
 * Pobiera saldo dla danej waluty
 */
export function getBalance(walletAddress, currency) {
  const wallet = walletAddress.toLowerCase();
  const curr = currency.toUpperCase();
  
  if (!walletBalances.has(wallet)) {
    walletBalances.set(wallet, new Map(Object.entries(DEFAULT_BALANCES)));
  }
  
  const balances = walletBalances.get(wallet);
  return new Decimal(balances.get(curr) || '0');
}

/**
 * Ustawia saldo dla danej waluty
 */
export function setBalance(walletAddress, currency, balance) {
  const wallet = walletAddress.toLowerCase();
  const curr = currency.toUpperCase();
  
  if (!walletBalances.has(wallet)) {
    walletBalances.set(wallet, new Map(Object.entries(DEFAULT_BALANCES)));
  }
  
  walletBalances.get(wallet).set(curr, balance.toString());
}

/**
 * Pobiera wszystkie salda dla portfela
 */
export function getAllBalances(walletAddress) {
  const wallet = walletAddress.toLowerCase();
  
  if (!walletBalances.has(wallet)) {
    walletBalances.set(wallet, new Map(Object.entries(DEFAULT_BALANCES)));
  }
  
  const balances = walletBalances.get(wallet);
  const result = {};
  balances.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Wykonuje transakcję zakupu (wydaje quoteCurrency, otrzymuje baseCurrency)
 * 
 * @param {string} walletAddress - adres portfela
 * @param {string} quoteCurrency - waluta płatności (np. USDC)
 * @param {string} baseCurrency - waluta kupowana (np. BTC)
 * @param {Decimal} quoteAmount - ilość wydawana (np. 1000 USDC)
 * @param {Decimal} baseAmount - ilość otrzymywana (np. 0.01 BTC)
 * @returns {boolean} true jeśli transakcja udana
 */
export function executeBuy(walletAddress, quoteCurrency, baseCurrency, quoteAmount, baseAmount) {
  const wallet = walletAddress.toLowerCase();
  const quote = quoteCurrency.toUpperCase();
  const base = baseCurrency.toUpperCase();
  
  const currentQuote = getBalance(wallet, quote);
  const quoteAmountDec = new Decimal(quoteAmount);
  
  // Sprawdź czy wystarczy środków
  if (currentQuote.lt(quoteAmountDec)) {
    console.error(`❌ Insufficient ${quote} balance: have=${currentQuote}, need=${quoteAmountDec}`);
    return false;
  }
  
  // Wykonaj transakcję
  const newQuoteBalance = currentQuote.minus(quoteAmountDec);
  const currentBase = getBalance(wallet, base);
  const baseAmountDec = new Decimal(baseAmount);
  const newBaseBalance = currentBase.plus(baseAmountDec);
  
  setBalance(wallet, quote, newQuoteBalance);
  setBalance(wallet, base, newBaseBalance);
  
  console.log(`✅ BUY executed: -${quoteAmountDec} ${quote} -> +${baseAmountDec} ${base}`);
  
  return true;
}

/**
 * Wykonuje transakcję sprzedaży (wydaje baseCurrency, otrzymuje quoteCurrency)
 * 
 * @param {string} walletAddress - adres portfela
 * @param {string} baseCurrency - waluta sprzedawana (np. BTC)
 * @param {string} quoteCurrency - waluta otrzymywana (np. USDC)
 * @param {Decimal} baseAmount - ilość sprzedawana (np. 0.01 BTC)
 * @param {Decimal} quoteAmount - ilość otrzymywana (np. 1000 USDC)
 * @returns {boolean} true jeśli transakcja udana
 */
export function executeSell(walletAddress, baseCurrency, quoteCurrency, baseAmount, quoteAmount) {
  const wallet = walletAddress.toLowerCase();
  const base = baseCurrency.toUpperCase();
  const quote = quoteCurrency.toUpperCase();
  
  const currentBase = getBalance(wallet, base);
  const baseAmountDec = new Decimal(baseAmount);
  
  // Sprawdź czy wystarczy środków
  if (currentBase.lt(baseAmountDec)) {
    console.error(`❌ Insufficient ${base} balance: have=${currentBase}, need=${baseAmountDec}`);
    return false;
  }
  
  // Wykonaj transakcję
  const newBaseBalance = currentBase.minus(baseAmountDec);
  const currentQuote = getBalance(wallet, quote);
  const quoteAmountDec = new Decimal(quoteAmount);
  const newQuoteBalance = currentQuote.plus(quoteAmountDec);
  
  setBalance(wallet, base, newBaseBalance);
  setBalance(wallet, quote, newQuoteBalance);
  
  console.log(`✅ SELL executed: -${baseAmountDec} ${base} -> +${quoteAmountDec} ${quote}`);
  
  return true;
}

/**
 * Rezerwuje środki dla transakcji
 */
export function reserveFunds(walletAddress, currency, amount) {
  const balance = getBalance(walletAddress, currency);
  return balance.gte(new Decimal(amount));
}

/**
 * Synchronizuje salda z zewnętrznego źródła (np. API giełdy) i zapisuje do bazy
 */
export async function syncBalances(walletAddress, externalBalances) {
  const wallet = walletAddress.toLowerCase();
  const balances = new Map();
  
  Object.entries(externalBalances).forEach(([currency, balance]) => {
    balances.set(currency.toUpperCase(), balance.toString());
  });
  
  walletBalances.set(wallet, balances);
  console.log(`✅ Synced balances for ${walletAddress}:`, externalBalances);

  // Zapisz do bazy danych (UserSettings) - dynamiczny import żeby uniknąć circular dependency
  try {
    const { default: UserSettings } = await import("../models/UserSettings.js");
    let settings = await UserSettings.findOne({ walletAddress: wallet });
    
    if (!settings) {
      settings = new UserSettings({ walletAddress: wallet });
    }

    // Konwertuj z formatu {CURRENCY: "balance"} na [{currency, balance, reserved}]
    const walletArray = Object.entries(externalBalances).map(([currency, balance]) => ({
      currency: currency.toUpperCase(),
      balance: parseFloat(balance) || 0,
      reserved: 0,
    }));

    settings.wallet = walletArray;
    await settings.save();
    console.log(`💾 Saved wallet to database for ${walletAddress}`);
  } catch (error) {
    console.error(`❌ Failed to save wallet to database:`, error.message);
  }
}

export default {
  getBalance,
  setBalance,
  getAllBalances,
  executeBuy,
  executeSell,
  reserveFunds,
  syncBalances
};
