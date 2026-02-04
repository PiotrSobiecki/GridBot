package com.gridbot.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * Reprezentuje pojedynczą pozycję (zakup lub sprzedaż short)
 */
@Entity
@Table(name = "positions")
public class Position {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;
    private String walletAddress;
    private String orderId;
    
    @Enumerated(EnumType.STRING)
    private PositionType type;
    
    private BigDecimal buyPrice;
    private BigDecimal buyValue;
    private BigDecimal sellPrice;
    private BigDecimal sellValue;
    private BigDecimal amount;
    private int trendAtBuy;
    private BigDecimal targetSellPrice;
    private BigDecimal targetBuybackPrice;
    
    @Enumerated(EnumType.STRING)
    private PositionStatus status;
    
    private BigDecimal profit;
    private Instant createdAt;
    private Instant closedAt;

    public Position() {}

    // Getters
    public String getId() { return id; }
    public String getWalletAddress() { return walletAddress; }
    public String getOrderId() { return orderId; }
    public PositionType getType() { return type; }
    public BigDecimal getBuyPrice() { return buyPrice; }
    public BigDecimal getBuyValue() { return buyValue; }
    public BigDecimal getSellPrice() { return sellPrice; }
    public BigDecimal getSellValue() { return sellValue; }
    public BigDecimal getAmount() { return amount; }
    public int getTrendAtBuy() { return trendAtBuy; }
    public BigDecimal getTargetSellPrice() { return targetSellPrice; }
    public BigDecimal getTargetBuybackPrice() { return targetBuybackPrice; }
    public PositionStatus getStatus() { return status; }
    public BigDecimal getProfit() { return profit; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getClosedAt() { return closedAt; }

    // Setters
    public void setId(String id) { this.id = id; }
    public void setWalletAddress(String walletAddress) { this.walletAddress = walletAddress; }
    public void setOrderId(String orderId) { this.orderId = orderId; }
    public void setType(PositionType type) { this.type = type; }
    public void setBuyPrice(BigDecimal buyPrice) { this.buyPrice = buyPrice; }
    public void setBuyValue(BigDecimal buyValue) { this.buyValue = buyValue; }
    public void setSellPrice(BigDecimal sellPrice) { this.sellPrice = sellPrice; }
    public void setSellValue(BigDecimal sellValue) { this.sellValue = sellValue; }
    public void setAmount(BigDecimal amount) { this.amount = amount; }
    public void setTrendAtBuy(int trendAtBuy) { this.trendAtBuy = trendAtBuy; }
    public void setTargetSellPrice(BigDecimal targetSellPrice) { this.targetSellPrice = targetSellPrice; }
    public void setTargetBuybackPrice(BigDecimal targetBuybackPrice) { this.targetBuybackPrice = targetBuybackPrice; }
    public void setStatus(PositionStatus status) { this.status = status; }
    public void setProfit(BigDecimal profit) { this.profit = profit; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public void setClosedAt(Instant closedAt) { this.closedAt = closedAt; }

    // Builder pattern
    public static Builder builder() { return new Builder(); }

    public static class Builder {
        private final Position p = new Position();
        public Builder id(String v) { p.id = v; return this; }
        public Builder walletAddress(String v) { p.walletAddress = v; return this; }
        public Builder orderId(String v) { p.orderId = v; return this; }
        public Builder type(PositionType v) { p.type = v; return this; }
        public Builder buyPrice(BigDecimal v) { p.buyPrice = v; return this; }
        public Builder buyValue(BigDecimal v) { p.buyValue = v; return this; }
        public Builder sellPrice(BigDecimal v) { p.sellPrice = v; return this; }
        public Builder sellValue(BigDecimal v) { p.sellValue = v; return this; }
        public Builder amount(BigDecimal v) { p.amount = v; return this; }
        public Builder trendAtBuy(int v) { p.trendAtBuy = v; return this; }
        public Builder targetSellPrice(BigDecimal v) { p.targetSellPrice = v; return this; }
        public Builder targetBuybackPrice(BigDecimal v) { p.targetBuybackPrice = v; return this; }
        public Builder status(PositionStatus v) { p.status = v; return this; }
        public Builder profit(BigDecimal v) { p.profit = v; return this; }
        public Builder createdAt(Instant v) { p.createdAt = v; return this; }
        public Builder closedAt(Instant v) { p.closedAt = v; return this; }
        public Position build() { return p; }
    }

    public enum PositionStatus {
        OPEN, CLOSED, CANCELLED
    }

    public enum PositionType {
        BUY, SELL
    }
}
