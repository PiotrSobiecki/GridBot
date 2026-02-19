import Decimal from 'decimal.js';

/**
 * Serwis do zarządzania portfelem użytkownika
 * W trybie symulacji przechowuje salda lokalnie
 * W produkcji połączyć z prawdziwym API giełdy (np. Aster DEX)
 */

// Symulowane salda portfeli: walletAddress -> exchange -> currency -> balance
// Przechowujemy salda osobno dla każdej giełdy
const walletBalances = new Map(); // walletAddress -> exchange -> currency -> balance

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
 * Pobiera wybraną giełdę dla portfela (domyślnie "asterdex")
 */
async function getExchange(walletAddress) {
  if (!walletAddress) {
    return "asterdex";
  }
  
  try {
    const { default: UserSettings } = await import("../models/UserSettings.js");
    const settings = await UserSettings.findOne({
      walletAddress: walletAddress.toLowerCase(),
    });
    
    const exchange = settings?.exchange || "asterdex";
    return exchange === "bingx" ? "bingx" : "asterdex";
  } catch (e) {
    console.warn(`⚠️ Failed to get exchange for wallet=${walletAddress}:`, e.message);
    return "asterdex";
  }
}

/**
 * Pobiera saldo dla danej waluty z wybranej giełdy
 */
export async function getBalance(walletAddress, currency, exchange = null) {
  const wallet = walletAddress.toLowerCase();
  const curr = currency.toUpperCase();
  
  // Jeśli exchange nie podano, pobierz z ustawień użytkownika
  if (!exchange) {
    exchange = await getExchange(walletAddress);
  }
  
  if (!walletBalances.has(wallet)) {
    walletBalances.set(wallet, new Map());
  }
  
  const exchanges = walletBalances.get(wallet);
  if (!exchanges.has(exchange)) {
    exchanges.set(exchange, new Map(Object.entries(DEFAULT_BALANCES)));
  }
  
  const balances = exchanges.get(exchange);
  return new Decimal(balances.get(curr) || '0');
}

/**
 * Synchronous version dla kompatybilności wstecznej (używa domyślnej giełdy)
 */
export function getBalanceSync(walletAddress, currency) {
  const wallet = walletAddress.toLowerCase();
  const curr = currency.toUpperCase();
  
  // Użyj pierwszej dostępnej giełdy lub domyślnych sald
  if (!walletBalances.has(wallet)) {
    return new Decimal(DEFAULT_BALANCES[curr] || '0');
  }
  
  const exchanges = walletBalances.get(wallet);
  // Sprawdź czy istnieje asterdex (domyślna)
  if (exchanges.has("asterdex")) {
    const balances = exchanges.get("asterdex");
    return new Decimal(balances.get(curr) || '0');
  }
  
  // Jeśli nie ma asterdex, użyj pierwszej dostępnej giełdy
  const firstExchange = exchanges.keys().next().value;
  if (firstExchange) {
    const balances = exchanges.get(firstExchange);
    return new Decimal(balances.get(curr) || '0');
  }
  
  return new Decimal(DEFAULT_BALANCES[curr] || '0');
}

/**
 * Ustawia saldo dla danej waluty na wybranej giełdzie (async)
 */
export async function setBalance(walletAddress, currency, balance, exchange = null) {
  const wallet = walletAddress.toLowerCase();
  const curr = currency.toUpperCase();
  
  // Jeśli exchange nie podano, pobierz z ustawień użytkownika
  if (!exchange) {
    exchange = await getExchange(walletAddress);
  }
  
  if (!walletBalances.has(wallet)) {
    walletBalances.set(wallet, new Map());
  }
  
  const exchanges = walletBalances.get(wallet);
  if (!exchanges.has(exchange)) {
    exchanges.set(exchange, new Map(Object.entries(DEFAULT_BALANCES)));
  }
  
  exchanges.get(exchange).set(curr, balance.toString());
}

/**
 * Synchronous version dla kompatybilności wstecznej (używa asterdex)
 */
export function setBalanceSync(walletAddress, currency, balance) {
  const wallet = walletAddress.toLowerCase();
  const curr = currency.toUpperCase();
  
  if (!walletBalances.has(wallet)) {
    walletBalances.set(wallet, new Map());
  }
  
  const exchanges = walletBalances.get(wallet);
  // Użyj asterdex jako domyślnej
  if (!exchanges.has("asterdex")) {
    exchanges.set("asterdex", new Map(Object.entries(DEFAULT_BALANCES)));
  }
  
  exchanges.get("asterdex").set(curr, balance.toString());
}

/**
 * Pobiera wszystkie salda dla portfela z wybranej giełdy
 */
export async function getAllBalances(walletAddress, exchange = null) {
  const wallet = walletAddress.toLowerCase();
  
  // Jeśli exchange nie podano, pobierz z ustawień użytkownika
  if (!exchange) {
    exchange = await getExchange(walletAddress);
  }
  
  if (!walletBalances.has(wallet)) {
    walletBalances.set(wallet, new Map());
  }
  
  const exchanges = walletBalances.get(wallet);
  if (!exchanges.has(exchange)) {
    exchanges.set(exchange, new Map(Object.entries(DEFAULT_BALANCES)));
  }
  
  const balances = exchanges.get(exchange);
  const result = {};
  balances.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Synchronous version dla kompatybilności wstecznej (używa asterdex)
 */
export function getAllBalancesSync(walletAddress) {
  const wallet = walletAddress.toLowerCase();
  
  if (!walletBalances.has(wallet)) {
    walletBalances.set(wallet, new Map());
  }
  
  const exchanges = walletBalances.get(wallet);
  // Użyj asterdex jako domyślnej
  if (!exchanges.has("asterdex")) {
    exchanges.set("asterdex", new Map(Object.entries(DEFAULT_BALANCES)));
  }
  
  const balances = exchanges.get("asterdex");
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
 * @param {string} exchange - giełda (opcjonalnie)
 * @returns {Promise<boolean>} true jeśli transakcja udana
 */
export async function executeBuy(walletAddress, quoteCurrency, baseCurrency, quoteAmount, baseAmount, exchange = null) {
  const wallet = walletAddress.toLowerCase();
  const quote = quoteCurrency.toUpperCase();
  const base = baseCurrency.toUpperCase();
  
  const currentQuote = await getBalance(walletAddress, quote, exchange);
  const quoteAmountDec = new Decimal(quoteAmount);
  
  // Sprawdź czy wystarczy środków
  if (currentQuote.lt(quoteAmountDec)) {
    console.error(`❌ Insufficient ${quote} balance: have=${currentQuote}, need=${quoteAmountDec}`);
    return false;
  }
  
  // Wykonaj transakcję
  const newQuoteBalance = currentQuote.minus(quoteAmountDec);
  const currentBase = await getBalance(walletAddress, base, exchange);
  const baseAmountDec = new Decimal(baseAmount);
  const newBaseBalance = currentBase.plus(baseAmountDec);
  
  await setBalance(walletAddress, quote, newQuoteBalance, exchange);
  await setBalance(walletAddress, base, newBaseBalance, exchange);
  
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
 * @param {string} exchange - giełda (opcjonalnie)
 * @returns {Promise<boolean>} true jeśli transakcja udana
 */
export async function executeSell(walletAddress, baseCurrency, quoteCurrency, baseAmount, quoteAmount, exchange = null) {
  const wallet = walletAddress.toLowerCase();
  const base = baseCurrency.toUpperCase();
  const quote = quoteCurrency.toUpperCase();
  
  const currentBase = await getBalance(walletAddress, base, exchange);
  const baseAmountDec = new Decimal(baseAmount);
  
  // Sprawdź czy wystarczy środków
  if (currentBase.lt(baseAmountDec)) {
    console.error(`❌ Insufficient ${base} balance: have=${currentBase}, need=${baseAmountDec}`);
    return false;
  }
  
  // Wykonaj transakcję
  const newBaseBalance = currentBase.minus(baseAmountDec);
  const currentQuote = await getBalance(walletAddress, quote, exchange);
  const quoteAmountDec = new Decimal(quoteAmount);
  const newQuoteBalance = currentQuote.plus(quoteAmountDec);
  
  await setBalance(walletAddress, base, newBaseBalance, exchange);
  await setBalance(walletAddress, quote, newQuoteBalance, exchange);
  
  console.log(`✅ SELL executed: -${baseAmountDec} ${base} -> +${quoteAmountDec} ${quote}`);
  
  return true;
}

/**
 * Rezerwuje środki dla transakcji (async)
 */
export async function reserveFunds(walletAddress, currency, amount, exchange = null) {
  const balance = await getBalance(walletAddress, currency, exchange);
  return balance.gte(new Decimal(amount));
}

/**
 * Synchronous version dla kompatybilności wstecznej
 */
export function reserveFundsSync(walletAddress, currency, amount) {
  const balance = getBalanceSync(walletAddress, currency);
  return balance.gte(new Decimal(amount));
}

/**
 * Synchronizuje salda z zewnętrznego źródła (np. API giełdy) i zapisuje do bazy
 * Salda są przechowywane per giełda
 */
export async function syncBalances(walletAddress, externalBalances, exchange = null) {
  const wallet = walletAddress.toLowerCase();
  
  // Jeśli exchange nie podano, pobierz z ustawień użytkownika
  if (!exchange) {
    exchange = await getExchange(walletAddress);
  }
  
  if (!walletBalances.has(wallet)) {
    walletBalances.set(wallet, new Map());
  }
  
  const exchanges = walletBalances.get(wallet);
  const balances = new Map();
  
  Object.entries(externalBalances).forEach(([currency, balance]) => {
    balances.set(currency.toUpperCase(), balance.toString());
  });
  
  exchanges.set(exchange, balances);
  console.log(`✅ Synced balances for ${walletAddress} from ${exchange}:`, externalBalances);

  // Zapisz do bazy danych (UserSettings) - dynamiczny import żeby uniknąć circular dependency
  // Uwaga: w bazie przechowujemy tylko salda z aktualnie wybranej giełdy
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
    console.log(`💾 Saved wallet to database for ${walletAddress} (${exchange})`);
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
