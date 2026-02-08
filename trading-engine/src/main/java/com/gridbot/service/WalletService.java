package com.gridbot.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Serwis do zarządzania portfelem użytkownika
 * W trybie symulacji przechowuje salda lokalnie
 * W produkcji połączyć z prawdziwym API giełdy
 */
@Service
public class WalletService {
    
    private static final Logger log = LoggerFactory.getLogger(WalletService.class);
    
    // Symulowane salda portfeli: walletAddress -> currency -> balance
    private final Map<String, Map<String, BigDecimal>> walletBalances = new ConcurrentHashMap<>();
    
    // Domyślne salda dla nowych portfeli (stable: USDT)
    private static final Map<String, BigDecimal> DEFAULT_BALANCES = Map.of(
            "USDT", new BigDecimal("10000"),
            "BTC", new BigDecimal("1"),
            "ETH", new BigDecimal("10"),
            "DOGE", new BigDecimal("10000"),
            "SOL", new BigDecimal("50")
    );
    
    /**
     * Pobiera saldo dla danej waluty
     */
    public BigDecimal getBalance(String walletAddress, String currency) {
        Map<String, BigDecimal> balances = walletBalances.computeIfAbsent(
                walletAddress.toLowerCase(), 
                k -> new ConcurrentHashMap<>(DEFAULT_BALANCES)
        );
        
        return balances.getOrDefault(currency.toUpperCase(), BigDecimal.ZERO);
    }
    
    /**
     * Ustawia saldo dla danej waluty
     */
    public void setBalance(String walletAddress, String currency, BigDecimal balance) {
        Map<String, BigDecimal> balances = walletBalances.computeIfAbsent(
                walletAddress.toLowerCase(), 
                k -> new ConcurrentHashMap<>(DEFAULT_BALANCES)
        );
        
        balances.put(currency.toUpperCase(), balance);
    }
    
    /**
     * Pobiera wszystkie salda dla portfela
     */
    public Map<String, BigDecimal> getAllBalances(String walletAddress) {
        return walletBalances.computeIfAbsent(
                walletAddress.toLowerCase(), 
                k -> new ConcurrentHashMap<>(DEFAULT_BALANCES)
        );
    }
    
    /**
     * Wykonuje transakcję zakupu (wydaje quoteCurrency, otrzymuje baseCurrency)
     * 
     * @param walletAddress adres portfela
     * @param quoteCurrency waluta płatności (np. USDC)
     * @param baseCurrency waluta kupowana (np. BTC)
     * @param quoteAmount ilość wydawana (np. 1000 USDC)
     * @param baseAmount ilość otrzymywana (np. 0.01 BTC)
     * @return true jeśli transakcja udana
     */
    public boolean executeBuy(String walletAddress, String quoteCurrency, String baseCurrency, 
                              BigDecimal quoteAmount, BigDecimal baseAmount) {
        String wallet = walletAddress.toLowerCase();
        String quote = quoteCurrency.toUpperCase();
        String base = baseCurrency.toUpperCase();
        
        BigDecimal currentQuote = getBalance(wallet, quote);
        
        // Sprawdź czy wystarczy środków
        if (currentQuote.compareTo(quoteAmount) < 0) {
            log.error("Insufficient {} balance: have={}, need={}", quote, currentQuote, quoteAmount);
            return false;
        }
        
        // Wykonaj transakcję
        BigDecimal newQuoteBalance = currentQuote.subtract(quoteAmount);
        BigDecimal currentBase = getBalance(wallet, base);
        BigDecimal newBaseBalance = currentBase.add(baseAmount);
        
        setBalance(wallet, quote, newQuoteBalance);
        setBalance(wallet, base, newBaseBalance);
        
        log.info("BUY executed: -{} {} -> +{} {}", quoteAmount, quote, baseAmount, base);
        log.debug("New balances: {}={}, {}={}", quote, newQuoteBalance, base, newBaseBalance);
        
        return true;
    }
    
    /**
     * Wykonuje transakcję sprzedaży (wydaje baseCurrency, otrzymuje quoteCurrency)
     * 
     * @param walletAddress adres portfela
     * @param baseCurrency waluta sprzedawana (np. BTC)
     * @param quoteCurrency waluta otrzymywana (np. USDC)
     * @param baseAmount ilość sprzedawana (np. 0.01 BTC)
     * @param quoteAmount ilość otrzymywana (np. 1000 USDC)
     * @return true jeśli transakcja udana
     */
    public boolean executeSell(String walletAddress, String baseCurrency, String quoteCurrency,
                               BigDecimal baseAmount, BigDecimal quoteAmount) {
        String wallet = walletAddress.toLowerCase();
        String base = baseCurrency.toUpperCase();
        String quote = quoteCurrency.toUpperCase();
        
        BigDecimal currentBase = getBalance(wallet, base);
        
        // Sprawdź czy wystarczy środków
        if (currentBase.compareTo(baseAmount) < 0) {
            log.error("Insufficient {} balance: have={}, need={}", base, currentBase, baseAmount);
            return false;
        }
        
        // Wykonaj transakcję
        BigDecimal newBaseBalance = currentBase.subtract(baseAmount);
        BigDecimal currentQuote = getBalance(wallet, quote);
        BigDecimal newQuoteBalance = currentQuote.add(quoteAmount);
        
        setBalance(wallet, base, newBaseBalance);
        setBalance(wallet, quote, newQuoteBalance);
        
        log.info("SELL executed: -{} {} -> +{} {}", baseAmount, base, quoteAmount, quote);
        log.debug("New balances: {}={}, {}={}", base, newBaseBalance, quote, newQuoteBalance);
        
        return true;
    }
    
    /**
     * Rezerwuje środki dla transakcji
     */
    public boolean reserveFunds(String walletAddress, String currency, BigDecimal amount) {
        // W pełnej implementacji - śledzenie zarezerwowanych środków
        // Na razie tylko sprawdzamy dostępność
        BigDecimal balance = getBalance(walletAddress, currency);
        return balance.compareTo(amount) >= 0;
    }
    
    /**
     * Synchronizuje salda z zewnętrznego źródła (np. API giełdy)
     */
    public void syncBalances(String walletAddress, Map<String, BigDecimal> externalBalances) {
        Map<String, BigDecimal> balances = walletBalances.computeIfAbsent(
                walletAddress.toLowerCase(), 
                k -> new ConcurrentHashMap<>()
        );
        
        balances.clear();
        externalBalances.forEach((currency, balance) -> 
                balances.put(currency.toUpperCase(), balance));
        
        log.info("Synced balances for {}: {}", walletAddress, balances);
    }
}
