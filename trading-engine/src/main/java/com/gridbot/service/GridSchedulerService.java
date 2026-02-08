package com.gridbot.service;

import com.gridbot.dto.OrderSettingsDto;
import com.gridbot.model.GridState;
import com.gridbot.repository.GridStateRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Serwis schedulera do automatycznego przetwarzania zleceń GRID
 */
@Service
public class GridSchedulerService {
    
    private static final Logger log = LoggerFactory.getLogger(GridSchedulerService.class);
    
    private final GridStateRepository gridStateRepository;
    private final GridAlgorithmService gridAlgorithmService;
    private final PriceFeedService priceFeedService;
    private final OrderSettingsService orderSettingsService;
    
    public GridSchedulerService(GridStateRepository gridStateRepository,
                                 GridAlgorithmService gridAlgorithmService,
                                 PriceFeedService priceFeedService,
                                 OrderSettingsService orderSettingsService) {
        this.gridStateRepository = gridStateRepository;
        this.gridAlgorithmService = gridAlgorithmService;
        this.priceFeedService = priceFeedService;
        this.orderSettingsService = orderSettingsService;
    }
    
    /**
     * Przetwarza wszystkie aktywne zlecenia w interwale z konfiguracji (domyślnie 5 s – zgodnie z odświeżaniem na froncie)
     */
    @Scheduled(fixedRateString = "${gridbot.trading.scheduler-interval-ms:5000}")
    public void processActiveOrders() {
        List<GridState> activeStates = gridStateRepository.findByIsActiveTrue();
        
        for (GridState state : activeStates) {
            try {
                processOrder(state);
            } catch (Exception e) {
                log.error("Error processing order {}: {}", state.getOrderId(), e.getMessage());
            }
        }
    }
    
    private void processOrder(GridState state) {
        // Pobierz ustawienia zlecenia z auth-service
        OrderSettingsDto settings = orderSettingsService.getOrderSettings(
                state.getWalletAddress(), 
                state.getOrderId()
        );
        
        if (settings == null) {
            log.warn("Settings not found for order {}", state.getOrderId());
            return;
        }

        // Uszanuj refreshInterval z frontu (w sekundach) – ten sam co odświeżanie na stronie
        int refreshIntervalSec = settings.getRefreshInterval() > 0 ? settings.getRefreshInterval() : 5;
        if (state.getLastUpdated() != null && refreshIntervalSec > 0) {
            long elapsedSec = Duration.between(state.getLastUpdated(), Instant.now()).getSeconds();
            if (elapsedSec < refreshIntervalSec) {
                return;
            }
        }
        
        // Pobierz aktualną cenę
        String symbol = settings.getSell().getCurrency() + "USDT";
        BigDecimal currentPrice = priceFeedService.getPrice(symbol);
        
        if (currentPrice.compareTo(BigDecimal.ZERO) == 0) {
            log.warn("Price not available for {}", symbol);
            return;
        }
        
        // Przetwórz cenę
        gridAlgorithmService.processPrice(
                state.getWalletAddress(),
                state.getOrderId(),
                currentPrice,
                settings
        );
    }
}
