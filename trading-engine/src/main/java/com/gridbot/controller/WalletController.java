package com.gridbot.controller;

import com.gridbot.service.WalletService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.Map;

@RestController
@RequestMapping("/api/wallet")
@CrossOrigin(origins = "*")
public class WalletController {
    
    private final WalletService walletService;
    
    public WalletController(WalletService walletService) {
        this.walletService = walletService;
    }
    
    /**
     * Pobiera wszystkie salda portfela
     */
    @GetMapping
    public ResponseEntity<Map<String, BigDecimal>> getBalances(
            @RequestHeader("X-Wallet-Address") String walletAddress) {
        
        Map<String, BigDecimal> balances = walletService.getAllBalances(walletAddress);
        return ResponseEntity.ok(balances);
    }
    
    /**
     * Pobiera saldo dla konkretnej waluty
     */
    @GetMapping("/{currency}")
    public ResponseEntity<Map<String, Object>> getBalance(
            @RequestHeader("X-Wallet-Address") String walletAddress,
            @PathVariable String currency) {
        
        BigDecimal balance = walletService.getBalance(walletAddress, currency);
        return ResponseEntity.ok(Map.of(
                "currency", currency.toUpperCase(),
                "balance", balance
        ));
    }
    
    /**
     * Ustawia saldo (dla symulacji/testów)
     */
    @PostMapping("/{currency}")
    public ResponseEntity<Void> setBalance(
            @RequestHeader("X-Wallet-Address") String walletAddress,
            @PathVariable String currency,
            @RequestBody Map<String, BigDecimal> body) {
        
        BigDecimal balance = body.get("balance");
        walletService.setBalance(walletAddress, currency, balance);
        return ResponseEntity.ok().build();
    }
    
    /**
     * Synchronizuje salda z zewnętrznego źródła
     */
    @PutMapping("/sync")
    public ResponseEntity<Void> syncBalances(
            @RequestHeader("X-Wallet-Address") String walletAddress,
            @RequestBody Map<String, BigDecimal> balances) {
        
        walletService.syncBalances(walletAddress, balances);
        return ResponseEntity.ok().build();
    }
}
