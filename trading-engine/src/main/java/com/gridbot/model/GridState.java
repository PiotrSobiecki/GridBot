package com.gridbot.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * Stan algorytmu GRID dla konkretnego zlecenia
 */
@Entity
@Table(name = "grid_states")
public class GridState {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;
    private String walletAddress;
    private String orderId;
    private BigDecimal currentFocusPrice;
    private Instant focusLastUpdated;
    private int buyTrendCounter;
    private int sellTrendCounter;
    private BigDecimal nextBuyTarget;
    private BigDecimal nextSellTarget;
    
    @Column(length = 10000)
    private String openPositionIds; // JSON array stored as string
    
    @Column(length = 10000)
    private String openSellPositionIds; // JSON array stored as string
    
    private BigDecimal totalProfit;
    private int totalBuyTransactions;
    private int totalSellTransactions;
    private BigDecimal totalBoughtValue;
    private BigDecimal totalSoldValue;
    private boolean isActive;
    private Instant lastUpdated;
    private Instant createdAt;
    private BigDecimal lastKnownPrice;
    private Instant lastPriceUpdate;

    public GridState() {
        this.openPositionIds = "[]";
        this.openSellPositionIds = "[]";
        this.totalProfit = BigDecimal.ZERO;
        this.totalBoughtValue = BigDecimal.ZERO;
        this.totalSoldValue = BigDecimal.ZERO;
    }

    // Getters
    public String getId() { return id; }
    public String getWalletAddress() { return walletAddress; }
    public String getOrderId() { return orderId; }
    public BigDecimal getCurrentFocusPrice() { return currentFocusPrice; }
    public Instant getFocusLastUpdated() { return focusLastUpdated; }
    public int getBuyTrendCounter() { return buyTrendCounter; }
    public int getSellTrendCounter() { return sellTrendCounter; }
    public BigDecimal getNextBuyTarget() { return nextBuyTarget; }
    public BigDecimal getNextSellTarget() { return nextSellTarget; }
    public String getOpenPositionIds() { return openPositionIds; }
    public String getOpenSellPositionIds() { return openSellPositionIds; }
    public BigDecimal getTotalProfit() { return totalProfit; }
    public int getTotalBuyTransactions() { return totalBuyTransactions; }
    public int getTotalSellTransactions() { return totalSellTransactions; }
    public BigDecimal getTotalBoughtValue() { return totalBoughtValue; }
    public BigDecimal getTotalSoldValue() { return totalSoldValue; }
    public boolean isActive() { return isActive; }
    public Instant getLastUpdated() { return lastUpdated; }
    public Instant getCreatedAt() { return createdAt; }
    public BigDecimal getLastKnownPrice() { return lastKnownPrice; }
    public Instant getLastPriceUpdate() { return lastPriceUpdate; }

    // Setters
    public void setId(String id) { this.id = id; }
    public void setWalletAddress(String walletAddress) { this.walletAddress = walletAddress; }
    public void setOrderId(String orderId) { this.orderId = orderId; }
    public void setCurrentFocusPrice(BigDecimal currentFocusPrice) { this.currentFocusPrice = currentFocusPrice; }
    public void setFocusLastUpdated(Instant focusLastUpdated) { this.focusLastUpdated = focusLastUpdated; }
    public void setBuyTrendCounter(int buyTrendCounter) { this.buyTrendCounter = buyTrendCounter; }
    public void setSellTrendCounter(int sellTrendCounter) { this.sellTrendCounter = sellTrendCounter; }
    public void setNextBuyTarget(BigDecimal nextBuyTarget) { this.nextBuyTarget = nextBuyTarget; }
    public void setNextSellTarget(BigDecimal nextSellTarget) { this.nextSellTarget = nextSellTarget; }
    public void setOpenPositionIds(String openPositionIds) { this.openPositionIds = openPositionIds; }
    public void setOpenSellPositionIds(String openSellPositionIds) { this.openSellPositionIds = openSellPositionIds; }
    public void setTotalProfit(BigDecimal totalProfit) { this.totalProfit = totalProfit; }
    public void setTotalBuyTransactions(int totalBuyTransactions) { this.totalBuyTransactions = totalBuyTransactions; }
    public void setTotalSellTransactions(int totalSellTransactions) { this.totalSellTransactions = totalSellTransactions; }
    public void setTotalBoughtValue(BigDecimal totalBoughtValue) { this.totalBoughtValue = totalBoughtValue; }
    public void setTotalSoldValue(BigDecimal totalSoldValue) { this.totalSoldValue = totalSoldValue; }
    public void setActive(boolean active) { isActive = active; }
    public void setLastUpdated(Instant lastUpdated) { this.lastUpdated = lastUpdated; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public void setLastKnownPrice(BigDecimal lastKnownPrice) { this.lastKnownPrice = lastKnownPrice; }
    public void setLastPriceUpdate(Instant lastPriceUpdate) { this.lastPriceUpdate = lastPriceUpdate; }

    // Builder
    public static Builder builder() { return new Builder(); }

    public static class Builder {
        private final GridState s = new GridState();
        public Builder id(String v) { s.id = v; return this; }
        public Builder walletAddress(String v) { s.walletAddress = v; return this; }
        public Builder orderId(String v) { s.orderId = v; return this; }
        public Builder currentFocusPrice(BigDecimal v) { s.currentFocusPrice = v; return this; }
        public Builder focusLastUpdated(Instant v) { s.focusLastUpdated = v; return this; }
        public Builder buyTrendCounter(int v) { s.buyTrendCounter = v; return this; }
        public Builder sellTrendCounter(int v) { s.sellTrendCounter = v; return this; }
        public Builder nextBuyTarget(BigDecimal v) { s.nextBuyTarget = v; return this; }
        public Builder nextSellTarget(BigDecimal v) { s.nextSellTarget = v; return this; }
        public Builder openPositionIds(String v) { s.openPositionIds = v != null ? v : "[]"; return this; }
        public Builder openSellPositionIds(String v) { s.openSellPositionIds = v != null ? v : "[]"; return this; }
        public Builder totalProfit(BigDecimal v) { s.totalProfit = v != null ? v : BigDecimal.ZERO; return this; }
        public Builder totalBuyTransactions(int v) { s.totalBuyTransactions = v; return this; }
        public Builder totalSellTransactions(int v) { s.totalSellTransactions = v; return this; }
        public Builder totalBoughtValue(BigDecimal v) { s.totalBoughtValue = v != null ? v : BigDecimal.ZERO; return this; }
        public Builder totalSoldValue(BigDecimal v) { s.totalSoldValue = v != null ? v : BigDecimal.ZERO; return this; }
        public Builder isActive(boolean v) { s.isActive = v; return this; }
        public Builder lastUpdated(Instant v) { s.lastUpdated = v; return this; }
        public Builder createdAt(Instant v) { s.createdAt = v; return this; }
        public Builder lastKnownPrice(BigDecimal v) { s.lastKnownPrice = v; return this; }
        public Builder lastPriceUpdate(Instant v) { s.lastPriceUpdate = v; return this; }
        public GridState build() { return s; }
    }
}
