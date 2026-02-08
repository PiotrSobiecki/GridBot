package com.gridbot.service;

import com.gridbot.dto.OrderSettingsDto;
import com.gridbot.dto.OrderSettingsDto.*;
import com.gridbot.model.GridState;
import com.gridbot.model.Position;
import com.gridbot.repository.GridStateRepository;
import com.gridbot.repository.PositionRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Główny serwis implementujący algorytm GRID
 */
@Service
public class GridAlgorithmService {
    
    private static final Logger log = LoggerFactory.getLogger(GridAlgorithmService.class);
    
    private final GridStateRepository gridStateRepository;
    private final PositionRepository positionRepository;
    private final WalletService walletService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    
    public GridAlgorithmService(GridStateRepository gridStateRepository, 
                                 PositionRepository positionRepository, 
                                 WalletService walletService) {
        this.gridStateRepository = gridStateRepository;
        this.positionRepository = positionRepository;
        this.walletService = walletService;
    }
    
    private static final int PRICE_SCALE = 2;
    private static final int AMOUNT_SCALE = 8;
    private static final BigDecimal DEFAULT_FEE_PERCENT = new BigDecimal("0.1");
    
    // Helper methods for JSON list handling
    private List<String> parseIdList(String json) {
        try {
            if (json == null || json.isEmpty()) return new ArrayList<>();
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }
    
    private String toIdListJson(List<String> ids) {
        try {
            return objectMapper.writeValueAsString(ids);
        } catch (Exception e) {
            return "[]";
        }
    }
    
    /**
     * Inicjalizuje stan GRID dla nowego zlecenia
     */
    public GridState initializeGridState(String walletAddress, OrderSettingsDto settings) {
        GridState state = GridState.builder()
                .walletAddress(walletAddress)
                .orderId(settings.getId())
                .currentFocusPrice(settings.getFocusPrice())
                .buyTrendCounter(0)
                .sellTrendCounter(0)
                .nextBuyTarget(calculateNextBuyTarget(settings.getFocusPrice(), 0, settings))
                .nextSellTarget(calculateNextSellTarget(settings.getFocusPrice(), 0, settings))
                .openPositionIds("[]")
                .openSellPositionIds("[]")
                .totalProfit(BigDecimal.ZERO)
                .totalBuyTransactions(0)
                .totalSellTransactions(0)
                .totalBoughtValue(BigDecimal.ZERO)
                .totalSoldValue(BigDecimal.ZERO)
                .isActive(settings.isActive())
                .focusLastUpdated(Instant.now())
                .createdAt(Instant.now())
                .lastUpdated(Instant.now())
                .build();
        
        return gridStateRepository.save(state);
    }
    
    /**
     * Przetwarza aktualizację ceny
     */
    public void processPrice(String walletAddress, String orderId, BigDecimal currentPrice, OrderSettingsDto settings) {
        Optional<GridState> stateOpt = gridStateRepository.findByWalletAddressAndOrderId(walletAddress, orderId);
        
        if (stateOpt.isEmpty()) {
            log.warn("Grid state not found for wallet {} and order {}", walletAddress, orderId);
            return;
        }
        
        GridState state = stateOpt.get();
        
        if (!state.isActive()) {
            return;
        }
        
        state.setLastKnownPrice(currentPrice);
        state.setLastPriceUpdate(Instant.now());
        
        checkAndUpdateFocusTime(state, currentPrice, settings);
        
        if (shouldBuy(currentPrice, state, settings)) {
            executeBuy(currentPrice, state, settings);
        }
        
        checkAndExecuteBuySells(currentPrice, state, settings);
        
        if (shouldSellShort(currentPrice, state, settings)) {
            executeSellShort(currentPrice, state, settings);
        }
        
        checkAndExecuteSellBuybacks(currentPrice, state, settings);
        
        state.setLastUpdated(Instant.now());
        gridStateRepository.save(state);
    }
    
    private void checkAndUpdateFocusTime(GridState state, BigDecimal currentPrice, OrderSettingsDto settings) {
        int timeToNewFocus = settings.getTimeToNewFocus();
        
        if (timeToNewFocus <= 0) {
            return;
        }
        
        if (state.getFocusLastUpdated() != null) {
            Duration elapsed = Duration.between(state.getFocusLastUpdated(), Instant.now());
            
            if (elapsed.getSeconds() >= timeToNewFocus) {
                if (state.getBuyTrendCounter() == 0 && state.getSellTrendCounter() == 0) {
                    state.setCurrentFocusPrice(currentPrice);
                    state.setFocusLastUpdated(Instant.now());
                    state.setNextBuyTarget(calculateNextBuyTarget(currentPrice, 0, settings));
                    state.setNextSellTarget(calculateNextSellTarget(currentPrice, 0, settings));
                }
            }
        }
    }
    
    private boolean canExecuteBuy(BigDecimal transactionValue, GridState state, OrderSettingsDto settings) {
        BuySellSettings buySettings = settings.getBuy();
        if (buySettings == null) return true;
        
        String currency = buySettings.getCurrency();
        BigDecimal walletBalance = walletService.getBalance(state.getWalletAddress(), currency);
        BigDecimal walletProtection = buySettings.getWalletProtection() != null 
                ? buySettings.getWalletProtection() : BigDecimal.ZERO;
        BigDecimal availableBalance = walletBalance.subtract(walletProtection);
        
        if (availableBalance.compareTo(transactionValue) < 0) {
            return false;
        }
        
        String mode = buySettings.getMode();
        if (mode == null) return true;
        
        BigDecimal maxValue = buySettings.getMaxValue() != null ? buySettings.getMaxValue() : BigDecimal.ZERO;
        boolean addProfit = buySettings.isAddProfit();
        
        switch (mode) {
            case "onlySold":
                BigDecimal soldValue = state.getTotalSoldValue();
                BigDecimal boughtValue = state.getTotalBoughtValue();
                BigDecimal allowedToBuy = soldValue.subtract(boughtValue);
                if (addProfit) allowedToBuy = allowedToBuy.add(state.getTotalProfit());
                if (transactionValue.compareTo(allowedToBuy) > 0) return false;
                break;
                
            case "maxDefined":
                BigDecimal totalBought = state.getTotalBoughtValue();
                BigDecimal effectiveMax = maxValue;
                if (addProfit) effectiveMax = effectiveMax.add(state.getTotalProfit());
                if (totalBought.add(transactionValue).compareTo(effectiveMax) > 0) return false;
                break;
        }
        
        return true;
    }
    
    private boolean canExecuteSell(BigDecimal amount, GridState state, OrderSettingsDto settings) {
        BuySellSettings sellSettings = settings.getSell();
        if (sellSettings == null) return true;
        
        String currency = sellSettings.getCurrency();
        BigDecimal walletBalance = walletService.getBalance(state.getWalletAddress(), currency);
        BigDecimal walletProtection = sellSettings.getWalletProtection() != null 
                ? sellSettings.getWalletProtection() : BigDecimal.ZERO;
        BigDecimal availableBalance = walletBalance.subtract(walletProtection);
        
        return availableBalance.compareTo(amount) >= 0;
    }
    
    private boolean meetsMinTransactionValue(BigDecimal transactionValue, OrderSettingsDto settings) {
        if (settings.getPlatform() == null || settings.getPlatform().getMinTransactionValue() == null) {
            return true;
        }
        return transactionValue.compareTo(settings.getPlatform().getMinTransactionValue()) >= 0;
    }
    
    private boolean checkFeeDoesNotEatProfit(BigDecimal buyValue, BigDecimal expectedProfit, OrderSettingsDto settings) {
        if (settings.getPlatform() == null || !settings.getPlatform().isCheckFeeProfit()) {
            return true;
        }
        
        BigDecimal totalFee = buyValue.multiply(DEFAULT_FEE_PERCENT)
                .multiply(BigDecimal.valueOf(2))
                .divide(BigDecimal.valueOf(100), PRICE_SCALE, RoundingMode.UP);
        
        return totalFee.compareTo(expectedProfit) < 0;
    }
    
    private BigDecimal getSwingPercent(BigDecimal currentPrice, OrderSettingsDto settings, boolean isBuy) {
        List<SwingPercent> swingPercents = isBuy 
                ? settings.getBuySwingPercent() 
                : settings.getSellSwingPercent();
        
        if (swingPercents == null || swingPercents.isEmpty()) {
            return BigDecimal.ZERO;
        }
        
        for (SwingPercent sp : swingPercents) {
            // Sprawdź zakres cen: minPrice <= cena < maxPrice
            if (sp.getMinPrice() != null && currentPrice.compareTo(sp.getMinPrice()) < 0) {
                continue;
            }
            if (sp.getMaxPrice() != null && currentPrice.compareTo(sp.getMaxPrice()) >= 0) {
                continue;
            }
            return sp.getValue() != null ? sp.getValue() : BigDecimal.ZERO;
        }
        
        return BigDecimal.ZERO;
    }
    
    private boolean meetsMinSwing(BigDecimal previousPrice, BigDecimal currentPrice, int trend, 
                                   OrderSettingsDto settings, boolean isBuy) {
        BigDecimal minSwingPercent = getSwingPercent(currentPrice, settings, isBuy);
        
        if (minSwingPercent.compareTo(BigDecimal.ZERO) == 0) {
            return true;
        }
        
        BigDecimal priceDiff = previousPrice.subtract(currentPrice).abs();
        BigDecimal percentChange = priceDiff.divide(previousPrice, 6, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(100));
        
        return percentChange.compareTo(minSwingPercent) >= 0;
    }
    
    private boolean shouldBuy(BigDecimal currentPrice, GridState state, OrderSettingsDto settings) {
        if (settings.getBuyConditions() == null) return false;
        
        BigDecimal priceThreshold = settings.getBuyConditions().getPriceThreshold();
        if (priceThreshold != null && currentPrice.compareTo(priceThreshold) > 0) {
            if (settings.getBuyConditions().isCheckThresholdIfProfitable()) {
                return false;
            }
            if (state.getTotalProfit().compareTo(BigDecimal.ZERO) <= 0) {
                return false;
            }
        }
        
        BigDecimal buyTarget = state.getNextBuyTarget();
        if (buyTarget == null) {
            buyTarget = calculateNextBuyTarget(state.getCurrentFocusPrice(), state.getBuyTrendCounter(), settings);
        }
        
        if (currentPrice.compareTo(buyTarget) > 0) {
            return false;
        }
        
        return meetsMinSwing(state.getCurrentFocusPrice(), currentPrice, state.getBuyTrendCounter(), settings, true);
    }
    
    private void executeBuy(BigDecimal currentPrice, GridState state, OrderSettingsDto settings) {
        int currentTrend = state.getBuyTrendCounter();
        
        BigDecimal transactionValue = calculateTransactionValue(currentPrice, currentTrend, settings, true);
        
        if (!meetsMinTransactionValue(transactionValue, settings)) {
            return;
        }
        
        if (!canExecuteBuy(transactionValue, state, settings)) {
            return;
        }
        
        BigDecimal amount = transactionValue.divide(currentPrice, AMOUNT_SCALE, RoundingMode.DOWN);
        
        BigDecimal minProfitPercent = settings.getMinProfitPercent() != null 
                ? settings.getMinProfitPercent() : BigDecimal.valueOf(0.5);
        BigDecimal targetSellPrice = currentPrice.multiply(
            BigDecimal.ONE.add(minProfitPercent.divide(BigDecimal.valueOf(100), 6, RoundingMode.HALF_UP))
        ).setScale(PRICE_SCALE, RoundingMode.UP);
        
        BigDecimal expectedProfit = targetSellPrice.subtract(currentPrice).multiply(amount);
        
        if (!checkFeeDoesNotEatProfit(transactionValue, expectedProfit, settings)) {
            return;
        }
        
        // Na spocie jako stable używamy USDT
        String buyCurrency = settings.getBuy() != null ? settings.getBuy().getCurrency() : "USDT";
        String sellCurrency = settings.getSell() != null ? settings.getSell().getCurrency() : "BTC";
        
        boolean success = walletService.executeBuy(state.getWalletAddress(), buyCurrency, sellCurrency, transactionValue, amount);
        
        if (!success) {
            log.error("Failed to execute buy in wallet");
            return;
        }
        
        Position position = Position.builder()
                .walletAddress(state.getWalletAddress())
                .orderId(state.getOrderId())
                .type(Position.PositionType.BUY)
                .buyPrice(currentPrice)
                .amount(amount)
                .buyValue(transactionValue)
                .trendAtBuy(currentTrend)
                .targetSellPrice(targetSellPrice)
                .status(Position.PositionStatus.OPEN)
                .createdAt(Instant.now())
                .build();
        
        position = positionRepository.save(position);
        
        List<String> posIds = parseIdList(state.getOpenPositionIds());
        posIds.add(position.getId());
        state.setOpenPositionIds(toIdListJson(posIds));
        
        state.setBuyTrendCounter(currentTrend + 1);
        state.setTotalBuyTransactions(state.getTotalBuyTransactions() + 1);
        state.setTotalBoughtValue(state.getTotalBoughtValue().add(transactionValue));
        state.setCurrentFocusPrice(currentPrice);
        state.setFocusLastUpdated(Instant.now());
        state.setNextBuyTarget(calculateNextBuyTarget(currentPrice, state.getBuyTrendCounter(), settings));
        
        log.info("BUY executed: price={}, amount={}, value={}, trend={}", currentPrice, amount, transactionValue, currentTrend);
    }
    
    /**
     * Zamyka pozycje kupna (sprzedaż z zyskiem), z uwzględnieniem progu cenowego sprzedaży.
     */
    private void checkAndExecuteBuySells(BigDecimal currentPrice, GridState state, OrderSettingsDto settings) {
        List<String> positionIds = parseIdList(state.getOpenPositionIds());
        if (positionIds.isEmpty()) return;

        var sellConditions = settings.getSellConditions();
        if (sellConditions != null) {
            BigDecimal priceThreshold = sellConditions.getPriceThreshold();
            if (priceThreshold != null && currentPrice.compareTo(priceThreshold) < 0) {
                if (sellConditions.isCheckThresholdIfProfitable()) {
                    return;
                }
                if (state.getTotalProfit().compareTo(BigDecimal.ZERO) <= 0) {
                    return;
                }
            }
        }

        List<Position> positions = positionRepository.findByIdIn(positionIds);
        positions.sort(Comparator.comparing(Position::getTargetSellPrice));

        for (Position position : positions) {
            if (position.getStatus() != Position.PositionStatus.OPEN) continue;
            if (position.getTargetSellPrice() != null && currentPrice.compareTo(position.getTargetSellPrice()) >= 0) {
                executeBuySell(currentPrice, position, state, settings);
            }
        }
    }
    
    private void executeBuySell(BigDecimal currentPrice, Position position, GridState state, OrderSettingsDto settings) {
        BigDecimal sellValue = position.getAmount().multiply(currentPrice);
        BigDecimal profit = sellValue.subtract(position.getBuyValue());
        
        if (profit.compareTo(BigDecimal.ZERO) < 0) {
            return;
        }
        
        String sellCurrency = settings.getSell() != null ? settings.getSell().getCurrency() : "BTC";
        String buyCurrency = settings.getBuy() != null ? settings.getBuy().getCurrency() : "USDT";
        
        boolean success = walletService.executeSell(state.getWalletAddress(), sellCurrency, buyCurrency, position.getAmount(), sellValue);
        
        if (!success) return;
        
        position.setSellPrice(currentPrice);
        position.setSellValue(sellValue);
        position.setProfit(profit);
        position.setStatus(Position.PositionStatus.CLOSED);
        position.setClosedAt(Instant.now());
        positionRepository.save(position);
        
        List<String> posIds = parseIdList(state.getOpenPositionIds());
        posIds.remove(position.getId());
        state.setOpenPositionIds(toIdListJson(posIds));
        
        state.setBuyTrendCounter(Math.max(0, state.getBuyTrendCounter() - 1));
        state.setTotalSellTransactions(state.getTotalSellTransactions() + 1);
        state.setTotalSoldValue(state.getTotalSoldValue().add(sellValue));
        state.setTotalProfit(state.getTotalProfit().add(profit));
        state.setCurrentFocusPrice(currentPrice);
        state.setFocusLastUpdated(Instant.now());
        state.setNextBuyTarget(calculateNextBuyTarget(currentPrice, state.getBuyTrendCounter(), settings));
        
        log.info("SELL executed: price={}, profit={}", currentPrice, profit);
    }
    
    private boolean shouldSellShort(BigDecimal currentPrice, GridState state, OrderSettingsDto settings) {
        if (settings.getSellConditions() == null) return false;
        
        BigDecimal priceThreshold = settings.getSellConditions().getPriceThreshold();
        if (priceThreshold != null && currentPrice.compareTo(priceThreshold) < 0) {
            if (settings.getSellConditions().isCheckThresholdIfProfitable()) {
                return false;
            }
            if (state.getTotalProfit().compareTo(BigDecimal.ZERO) <= 0) {
                return false;
            }
        }
        
        BigDecimal sellTarget = state.getNextSellTarget();
        if (sellTarget == null) {
            sellTarget = calculateNextSellTarget(state.getCurrentFocusPrice(), state.getSellTrendCounter(), settings);
        }
        
        if (currentPrice.compareTo(sellTarget) < 0) {
            return false;
        }
        
        return meetsMinSwing(state.getCurrentFocusPrice(), currentPrice, state.getSellTrendCounter(), settings, false);
    }
    
    private void executeSellShort(BigDecimal currentPrice, GridState state, OrderSettingsDto settings) {
        int currentTrend = state.getSellTrendCounter();
        
        BigDecimal transactionValue = calculateTransactionValue(currentPrice, currentTrend, settings, false);
        
        if (!meetsMinTransactionValue(transactionValue, settings)) {
            return;
        }
        
        BigDecimal amount = transactionValue.divide(currentPrice, AMOUNT_SCALE, RoundingMode.DOWN);
        
        if (!canExecuteSell(amount, state, settings)) {
            return;
        }
        
        BigDecimal minProfitPercent = settings.getMinProfitPercent() != null 
                ? settings.getMinProfitPercent() : BigDecimal.valueOf(0.5);
        BigDecimal targetBuybackPrice = currentPrice.multiply(
            BigDecimal.ONE.subtract(minProfitPercent.divide(BigDecimal.valueOf(100), 6, RoundingMode.HALF_UP))
        ).setScale(PRICE_SCALE, RoundingMode.DOWN);
        
        BigDecimal expectedProfit = currentPrice.subtract(targetBuybackPrice).multiply(amount);
        
        if (!checkFeeDoesNotEatProfit(transactionValue, expectedProfit, settings)) {
            return;
        }
        
        String sellCurrency = settings.getSell() != null ? settings.getSell().getCurrency() : "BTC";
        String buyCurrency = settings.getBuy() != null ? settings.getBuy().getCurrency() : "USDT";
        
        boolean success = walletService.executeSell(state.getWalletAddress(), sellCurrency, buyCurrency, amount, transactionValue);
        
        if (!success) return;
        
        Position position = Position.builder()
                .walletAddress(state.getWalletAddress())
                .orderId(state.getOrderId())
                .type(Position.PositionType.SELL)
                .sellPrice(currentPrice)
                .amount(amount)
                .sellValue(transactionValue)
                .trendAtBuy(currentTrend)
                .targetBuybackPrice(targetBuybackPrice)
                .status(Position.PositionStatus.OPEN)
                .createdAt(Instant.now())
                .build();
        
        position = positionRepository.save(position);
        
        List<String> posIds = parseIdList(state.getOpenSellPositionIds());
        posIds.add(position.getId());
        state.setOpenSellPositionIds(toIdListJson(posIds));
        
        state.setSellTrendCounter(currentTrend + 1);
        state.setTotalSellTransactions(state.getTotalSellTransactions() + 1);
        state.setTotalSoldValue(state.getTotalSoldValue().add(transactionValue));
        state.setCurrentFocusPrice(currentPrice);
        state.setFocusLastUpdated(Instant.now());
        state.setNextSellTarget(calculateNextSellTarget(currentPrice, state.getSellTrendCounter(), settings));
        
        log.info("SELL executed: price={}, amount={}", currentPrice, amount);
    }
    
    private void checkAndExecuteSellBuybacks(BigDecimal currentPrice, GridState state, OrderSettingsDto settings) {
        List<String> positionIds = parseIdList(state.getOpenSellPositionIds());
        if (positionIds.isEmpty()) return;
        
        List<Position> positions = positionRepository.findByIdIn(positionIds);
        
        for (Position position : positions) {
            if (position.getStatus() != Position.PositionStatus.OPEN) continue;
            if (position.getTargetBuybackPrice() != null && currentPrice.compareTo(position.getTargetBuybackPrice()) <= 0) {
                executeSellBuyback(currentPrice, position, state, settings);
            }
        }
    }
    
    private void executeSellBuyback(BigDecimal currentPrice, Position position, GridState state, OrderSettingsDto settings) {
        BigDecimal buybackValue = position.getAmount().multiply(currentPrice);
        BigDecimal profit = position.getSellValue().subtract(buybackValue);
        
        if (profit.compareTo(BigDecimal.ZERO) < 0) {
            return;
        }
        
        String buyCurrency = settings.getBuy() != null ? settings.getBuy().getCurrency() : "USDT";
        String sellCurrency = settings.getSell() != null ? settings.getSell().getCurrency() : "BTC";
        
        boolean success = walletService.executeBuy(state.getWalletAddress(), buyCurrency, sellCurrency, buybackValue, position.getAmount());
        
        if (!success) return;
        
        position.setBuyPrice(currentPrice);
        position.setBuyValue(buybackValue);
        position.setProfit(profit);
        position.setStatus(Position.PositionStatus.CLOSED);
        position.setClosedAt(Instant.now());
        positionRepository.save(position);
        
        List<String> posIds = parseIdList(state.getOpenSellPositionIds());
        posIds.remove(position.getId());
        state.setOpenSellPositionIds(toIdListJson(posIds));
        
        state.setSellTrendCounter(Math.max(0, state.getSellTrendCounter() - 1));
        state.setTotalBuyTransactions(state.getTotalBuyTransactions() + 1);
        state.setTotalBoughtValue(state.getTotalBoughtValue().add(buybackValue));
        state.setTotalProfit(state.getTotalProfit().add(profit));
        state.setCurrentFocusPrice(currentPrice);
        state.setFocusLastUpdated(Instant.now());
        state.setNextSellTarget(calculateNextSellTarget(currentPrice, state.getSellTrendCounter(), settings));
        
        log.info("BUYBACK executed: price={}, profit={}", currentPrice, profit);
    }
    
    public BigDecimal calculateNextBuyTarget(BigDecimal focusPrice, int trend, OrderSettingsDto settings) {
        BigDecimal trendPercent = getTrendPercent(trend, settings, true);
        
        BigDecimal decrease = focusPrice.multiply(trendPercent)
                .divide(BigDecimal.valueOf(100), PRICE_SCALE, RoundingMode.DOWN);
        return focusPrice.subtract(decrease);
    }
    
    public BigDecimal calculateNextSellTarget(BigDecimal focusPrice, int trend, OrderSettingsDto settings) {
        BigDecimal trendPercent = getTrendPercent(trend, settings, false);
        
        BigDecimal increase = focusPrice.multiply(trendPercent)
                .divide(BigDecimal.valueOf(100), PRICE_SCALE, RoundingMode.UP);
        return focusPrice.add(increase);
    }
    
    private BigDecimal getTrendPercent(int trend, OrderSettingsDto settings, boolean isBuy) {
        List<TrendPercent> trendPercents = settings.getTrendPercents();
        
        if (trendPercents == null || trendPercents.isEmpty()) {
            // Brak zdefiniowanych trendów:
            // użyj globalnego minProfitPercent jako domyślnego kroku (BUY/SELL),
            // a jeśli go nie ma – wróć do 0.5% jak wcześniej.
            BigDecimal minProfit = settings.getMinProfitPercent();
            if (minProfit != null) {
                return minProfit;
            }
            return BigDecimal.valueOf(0.5);
        }
        
        TrendPercent result = trendPercents.stream()
                .filter(tp -> tp.getTrend() <= trend)
                .max(Comparator.comparingInt(TrendPercent::getTrend))
                .orElse(trendPercents.get(0));
        
        BigDecimal percent = isBuy ? result.getBuyPercent() : result.getSellPercent();
        // Jeśli w trendzie nie ustawiono konkretnego procentu,
        // też użyj minProfitPercent jako sensownego defaultu.
        if (percent != null) {
            return percent;
        }
        BigDecimal minProfit = settings.getMinProfitPercent();
        return minProfit != null ? minProfit : BigDecimal.valueOf(0.5);
    }
    
    private BigDecimal calculateTransactionValue(BigDecimal currentPrice, int trend, 
                                                   OrderSettingsDto settings, boolean isBuy) {
        BigDecimal trendPercent = getTrendPercent(trend, settings, isBuy);
        
        BigDecimal minValuePer1Percent;
        if (isBuy && settings.getBuyConditions() != null && settings.getBuyConditions().getMinValuePer1Percent() != null) {
            minValuePer1Percent = settings.getBuyConditions().getMinValuePer1Percent();
        } else if (!isBuy && settings.getSellConditions() != null && settings.getSellConditions().getMinValuePer1Percent() != null) {
            minValuePer1Percent = settings.getSellConditions().getMinValuePer1Percent();
        } else {
            minValuePer1Percent = BigDecimal.valueOf(200);
        }
        
        BigDecimal baseValue = minValuePer1Percent.multiply(trendPercent);
        
        List<PriceThreshold> additionalValues = isBuy 
                ? settings.getAdditionalBuyValues() 
                : settings.getAdditionalSellValues();
        
        if (additionalValues != null && !additionalValues.isEmpty()) {
            for (PriceThreshold threshold : additionalValues) {
                if (matchesThreshold(currentPrice, threshold)) {
                    BigDecimal addVal = threshold.getValue() != null ? threshold.getValue() : BigDecimal.ZERO;
                    baseValue = baseValue.add(addVal.multiply(trendPercent));
                    break;
                }
            }
        }
        
        List<PriceThreshold> maxValues = isBuy 
                ? settings.getMaxBuyPerTransaction() 
                : settings.getMaxSellPerTransaction();
        
        if (maxValues != null && !maxValues.isEmpty()) {
            for (PriceThreshold threshold : maxValues) {
                if (matchesThreshold(currentPrice, threshold)) {
                    BigDecimal maxVal = threshold.getValue() != null ? threshold.getValue() : BigDecimal.valueOf(10000);
                    if (baseValue.compareTo(maxVal) > 0) {
                        baseValue = maxVal;
                    }
                    break;
                }
            }
        }
        
        return baseValue.setScale(PRICE_SCALE, RoundingMode.DOWN);
    }
    
    private boolean matchesThreshold(BigDecimal price, PriceThreshold threshold) {
        if (threshold == null) return false;

        // Nowy tryb: zakres cen w jednej linii (minPrice <= price < maxPrice)
        if (threshold.getMinPrice() != null || threshold.getMaxPrice() != null) {
            if (threshold.getMinPrice() != null && price.compareTo(threshold.getMinPrice()) < 0) {
                return false;
            }
            if (threshold.getMaxPrice() != null && price.compareTo(threshold.getMaxPrice()) >= 0) {
                return false;
            }
            return true;
        }

        // Stary tryb: pojedynczy warunek względem price/condition
        if (threshold.getPrice() == null || threshold.getCondition() == null) return false;
        
        BigDecimal thresholdPrice = threshold.getPrice();
        String condition = threshold.getCondition();
        
        return switch (condition) {
            case "less" -> price.compareTo(thresholdPrice) < 0;
            case "lessEqual" -> price.compareTo(thresholdPrice) <= 0;
            case "greater" -> price.compareTo(thresholdPrice) > 0;
            case "greaterEqual" -> price.compareTo(thresholdPrice) >= 0;
            default -> false;
        };
    }
    
    public Optional<GridState> getGridState(String walletAddress, String orderId) {
        return gridStateRepository.findByWalletAddressAndOrderId(walletAddress, orderId);
    }
    
    public List<Position> getOpenPositions(String walletAddress, String orderId) {
        return positionRepository.findByWalletAddressAndOrderIdAndStatus(
                walletAddress, orderId, Position.PositionStatus.OPEN);
    }
    
    public void stopGrid(String walletAddress, String orderId) {
        gridStateRepository.findByWalletAddressAndOrderId(walletAddress, orderId)
                .ifPresent(state -> {
                    state.setActive(false);
                    state.setLastUpdated(Instant.now());
                    gridStateRepository.save(state);
                });
    }
    
    public void startGrid(String walletAddress, String orderId) {
        gridStateRepository.findByWalletAddressAndOrderId(walletAddress, orderId)
                .ifPresent(state -> {
                    state.setActive(true);
                    state.setLastUpdated(Instant.now());
                    gridStateRepository.save(state);
                });
    }
}
