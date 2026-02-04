package com.gridbot.dto;

import java.math.BigDecimal;
import java.util.List;

public class OrderSettingsDto {
    private String id;
    private String name;
    private boolean isActive;
    private int refreshInterval;
    private BigDecimal minProfitPercent;
    private BigDecimal focusPrice;
    private int timeToNewFocus;
    private int buyTrendCounter;
    private int sellTrendCounter;
    private BuySellSettings buy;
    private BuySellSettings sell;
    private PlatformSettings platform;
    private TransactionConditions buyConditions;
    private TransactionConditions sellConditions;
    private List<TrendPercent> trendPercents;
    private List<PriceThreshold> additionalBuyValues;
    private List<PriceThreshold> additionalSellValues;
    private List<PriceThreshold> maxBuyPerTransaction;
    private List<PriceThreshold> maxSellPerTransaction;
    private List<SwingPercent> buySwingPercent;
    private List<SwingPercent> sellSwingPercent;

    // Getters
    public String getId() { return id; }
    public String getName() { return name; }
    public boolean isActive() { return isActive; }
    public int getRefreshInterval() { return refreshInterval; }
    public BigDecimal getMinProfitPercent() { return minProfitPercent; }
    public BigDecimal getFocusPrice() { return focusPrice; }
    public int getTimeToNewFocus() { return timeToNewFocus; }
    public int getBuyTrendCounter() { return buyTrendCounter; }
    public int getSellTrendCounter() { return sellTrendCounter; }
    public BuySellSettings getBuy() { return buy; }
    public BuySellSettings getSell() { return sell; }
    public PlatformSettings getPlatform() { return platform; }
    public TransactionConditions getBuyConditions() { return buyConditions; }
    public TransactionConditions getSellConditions() { return sellConditions; }
    public List<TrendPercent> getTrendPercents() { return trendPercents; }
    public List<PriceThreshold> getAdditionalBuyValues() { return additionalBuyValues; }
    public List<PriceThreshold> getAdditionalSellValues() { return additionalSellValues; }
    public List<PriceThreshold> getMaxBuyPerTransaction() { return maxBuyPerTransaction; }
    public List<PriceThreshold> getMaxSellPerTransaction() { return maxSellPerTransaction; }
    public List<SwingPercent> getBuySwingPercent() { return buySwingPercent; }
    public List<SwingPercent> getSellSwingPercent() { return sellSwingPercent; }

    // Setters
    public void setId(String id) { this.id = id; }
    public void setName(String name) { this.name = name; }
    public void setActive(boolean active) { isActive = active; }
    public void setRefreshInterval(int refreshInterval) { this.refreshInterval = refreshInterval; }
    public void setMinProfitPercent(BigDecimal minProfitPercent) { this.minProfitPercent = minProfitPercent; }
    public void setFocusPrice(BigDecimal focusPrice) { this.focusPrice = focusPrice; }
    public void setTimeToNewFocus(int timeToNewFocus) { this.timeToNewFocus = timeToNewFocus; }
    public void setBuyTrendCounter(int buyTrendCounter) { this.buyTrendCounter = buyTrendCounter; }
    public void setSellTrendCounter(int sellTrendCounter) { this.sellTrendCounter = sellTrendCounter; }
    public void setBuy(BuySellSettings buy) { this.buy = buy; }
    public void setSell(BuySellSettings sell) { this.sell = sell; }
    public void setPlatform(PlatformSettings platform) { this.platform = platform; }
    public void setBuyConditions(TransactionConditions buyConditions) { this.buyConditions = buyConditions; }
    public void setSellConditions(TransactionConditions sellConditions) { this.sellConditions = sellConditions; }
    public void setTrendPercents(List<TrendPercent> trendPercents) { this.trendPercents = trendPercents; }
    public void setAdditionalBuyValues(List<PriceThreshold> additionalBuyValues) { this.additionalBuyValues = additionalBuyValues; }
    public void setAdditionalSellValues(List<PriceThreshold> additionalSellValues) { this.additionalSellValues = additionalSellValues; }
    public void setMaxBuyPerTransaction(List<PriceThreshold> maxBuyPerTransaction) { this.maxBuyPerTransaction = maxBuyPerTransaction; }
    public void setMaxSellPerTransaction(List<PriceThreshold> maxSellPerTransaction) { this.maxSellPerTransaction = maxSellPerTransaction; }
    public void setBuySwingPercent(List<SwingPercent> buySwingPercent) { this.buySwingPercent = buySwingPercent; }
    public void setSellSwingPercent(List<SwingPercent> sellSwingPercent) { this.sellSwingPercent = sellSwingPercent; }

    public static class BuySellSettings {
        private String currency;
        private BigDecimal walletProtection;
        private String mode;
        private BigDecimal maxValue;
        private boolean addProfit;

        public String getCurrency() { return currency; }
        public BigDecimal getWalletProtection() { return walletProtection; }
        public String getMode() { return mode; }
        public BigDecimal getMaxValue() { return maxValue; }
        public boolean isAddProfit() { return addProfit; }
        
        public void setCurrency(String currency) { this.currency = currency; }
        public void setWalletProtection(BigDecimal walletProtection) { this.walletProtection = walletProtection; }
        public void setMode(String mode) { this.mode = mode; }
        public void setMaxValue(BigDecimal maxValue) { this.maxValue = maxValue; }
        public void setAddProfit(boolean addProfit) { this.addProfit = addProfit; }
    }

    public static class PlatformSettings {
        private BigDecimal minTransactionValue;
        private boolean checkFeeProfit;

        public BigDecimal getMinTransactionValue() { return minTransactionValue; }
        public boolean isCheckFeeProfit() { return checkFeeProfit; }
        public void setMinTransactionValue(BigDecimal minTransactionValue) { this.minTransactionValue = minTransactionValue; }
        public void setCheckFeeProfit(boolean checkFeeProfit) { this.checkFeeProfit = checkFeeProfit; }
    }

    public static class TransactionConditions {
        private BigDecimal minValuePer1Percent;
        private BigDecimal priceThreshold;
        private boolean checkThresholdIfProfitable;

        public BigDecimal getMinValuePer1Percent() { return minValuePer1Percent; }
        public BigDecimal getPriceThreshold() { return priceThreshold; }
        public boolean isCheckThresholdIfProfitable() { return checkThresholdIfProfitable; }
        public void setMinValuePer1Percent(BigDecimal minValuePer1Percent) { this.minValuePer1Percent = minValuePer1Percent; }
        public void setPriceThreshold(BigDecimal priceThreshold) { this.priceThreshold = priceThreshold; }
        public void setCheckThresholdIfProfitable(boolean checkThresholdIfProfitable) { this.checkThresholdIfProfitable = checkThresholdIfProfitable; }
    }

    public static class TrendPercent {
        private int trend;
        private BigDecimal buyPercent;
        private BigDecimal sellPercent;

        public int getTrend() { return trend; }
        public BigDecimal getBuyPercent() { return buyPercent; }
        public BigDecimal getSellPercent() { return sellPercent; }
        public void setTrend(int trend) { this.trend = trend; }
        public void setBuyPercent(BigDecimal buyPercent) { this.buyPercent = buyPercent; }
        public void setSellPercent(BigDecimal sellPercent) { this.sellPercent = sellPercent; }
    }

    public static class PriceThreshold {
        private String condition;
        private BigDecimal price;
        private BigDecimal value;

        public String getCondition() { return condition; }
        public BigDecimal getPrice() { return price; }
        public BigDecimal getValue() { return value; }
        public void setCondition(String condition) { this.condition = condition; }
        public void setPrice(BigDecimal price) { this.price = price; }
        public void setValue(BigDecimal value) { this.value = value; }
    }

    public static class SwingPercent {
        private int minTrend;
        private int maxTrend;
        private BigDecimal value;

        public int getMinTrend() { return minTrend; }
        public int getMaxTrend() { return maxTrend; }
        public BigDecimal getValue() { return value; }
        public void setMinTrend(int minTrend) { this.minTrend = minTrend; }
        public void setMaxTrend(int maxTrend) { this.maxTrend = maxTrend; }
        public void setValue(BigDecimal value) { this.value = value; }
    }
}
