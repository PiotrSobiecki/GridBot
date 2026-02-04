package com.gridbot.controller;

import com.gridbot.dto.OrderSettingsDto;
import com.gridbot.model.GridState;
import com.gridbot.model.Position;
import com.gridbot.service.GridAlgorithmService;
import com.gridbot.service.PriceFeedService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/trading")
@CrossOrigin(origins = "*")
public class TradingController {
    
    private static final Logger log = LoggerFactory.getLogger(TradingController.class);
    
    private final GridAlgorithmService gridAlgorithmService;
    private final PriceFeedService priceFeedService;
    
    public TradingController(GridAlgorithmService gridAlgorithmService, 
                              PriceFeedService priceFeedService) {
        this.gridAlgorithmService = gridAlgorithmService;
        this.priceFeedService = priceFeedService;
    }
    
    /**
     * Inicjalizuje algorytm GRID dla zlecenia
     */
    @PostMapping("/grid/init")
    public ResponseEntity<GridState> initializeGrid(
            @RequestHeader("X-Wallet-Address") String walletAddress,
            @RequestBody OrderSettingsDto settings) {
        
        log.info("Initializing GRID for wallet {} with order {}", walletAddress, settings.getId());
        
        GridState state = gridAlgorithmService.initializeGridState(walletAddress, settings);
        return ResponseEntity.ok(state);
    }
    
    /**
     * Pobiera stan algorytmu GRID
     */
    @GetMapping("/grid/state/{orderId}")
    public ResponseEntity<GridState> getGridState(
            @RequestHeader("X-Wallet-Address") String walletAddress,
            @PathVariable String orderId) {
        
        Optional<GridState> state = gridAlgorithmService.getGridState(walletAddress, orderId);
        return state.map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
    
    /**
     * Uruchamia algorytm GRID
     */
    @PostMapping("/grid/start/{orderId}")
    public ResponseEntity<Void> startGrid(
            @RequestHeader("X-Wallet-Address") String walletAddress,
            @PathVariable String orderId) {
        
        log.info("Starting GRID for wallet {} order {}", walletAddress, orderId);
        gridAlgorithmService.startGrid(walletAddress, orderId);
        return ResponseEntity.ok().build();
    }
    
    /**
     * Zatrzymuje algorytm GRID
     */
    @PostMapping("/grid/stop/{orderId}")
    public ResponseEntity<Void> stopGrid(
            @RequestHeader("X-Wallet-Address") String walletAddress,
            @PathVariable String orderId) {
        
        log.info("Stopping GRID for wallet {} order {}", walletAddress, orderId);
        gridAlgorithmService.stopGrid(walletAddress, orderId);
        return ResponseEntity.ok().build();
    }
    
    /**
     * Pobiera otwarte pozycje dla zlecenia
     */
    @GetMapping("/positions/{orderId}")
    public ResponseEntity<List<Position>> getPositions(
            @RequestHeader("X-Wallet-Address") String walletAddress,
            @PathVariable String orderId) {
        
        List<Position> positions = gridAlgorithmService.getOpenPositions(walletAddress, orderId);
        return ResponseEntity.ok(positions);
    }
    
    /**
     * Oblicza następny cel zakupu (preview)
     */
    @PostMapping("/grid/calculate-buy-target")
    public ResponseEntity<Map<String, Object>> calculateBuyTarget(
            @RequestBody OrderSettingsDto settings,
            @RequestParam BigDecimal focusPrice,
            @RequestParam int trend) {
        
        BigDecimal target = gridAlgorithmService.calculateNextBuyTarget(focusPrice, trend, settings);
        
        return ResponseEntity.ok(Map.of(
                "focusPrice", focusPrice,
                "trend", trend,
                "targetPrice", target
        ));
    }
    
    /**
     * Pobiera aktualne ceny
     */
    @GetMapping("/prices")
    public ResponseEntity<Map<String, BigDecimal>> getPrices() {
        return ResponseEntity.ok(priceFeedService.getAllPrices());
    }
    
    /**
     * Pobiera cenę dla konkretnego symbolu
     */
    @GetMapping("/prices/{symbol}")
    public ResponseEntity<Map<String, Object>> getPrice(@PathVariable String symbol) {
        BigDecimal price = priceFeedService.getPrice(symbol);
        boolean stale = priceFeedService.isPriceStale(symbol);
        
        return ResponseEntity.ok(Map.of(
                "symbol", symbol.toUpperCase(),
                "price", price,
                "stale", stale
        ));
    }
    
    /**
     * Ręcznie ustawia cenę (dla testów/symulacji)
     */
    @PostMapping("/prices/{symbol}")
    public ResponseEntity<Void> setPrice(
            @PathVariable String symbol,
            @RequestBody Map<String, BigDecimal> body) {
        
        BigDecimal price = body.get("price");
        priceFeedService.setPrice(symbol, price);
        return ResponseEntity.ok().build();
    }
    
    /**
     * Ręcznie wywołuje przetworzenie ceny (dla testów)
     */
    @PostMapping("/grid/process-price/{orderId}")
    public ResponseEntity<GridState> processPrice(
            @RequestHeader("X-Wallet-Address") String walletAddress,
            @PathVariable String orderId,
            @RequestBody OrderSettingsDto settings,
            @RequestParam BigDecimal price) {
        
        gridAlgorithmService.processPrice(walletAddress, orderId, price, settings);
        
        Optional<GridState> state = gridAlgorithmService.getGridState(walletAddress, orderId);
        return state.map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
