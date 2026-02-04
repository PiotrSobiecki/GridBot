package com.gridbot.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.util.Map;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Serwis do pobierania cen w czasie rzeczywistym
 */
@Service
public class PriceFeedService {
    
    private static final Logger log = LoggerFactory.getLogger(PriceFeedService.class);
    
    private final SimpMessagingTemplate messagingTemplate;
    
    public PriceFeedService(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }
    private final ObjectMapper objectMapper = new ObjectMapper();
    
    @Value("${gridbot.trading.simulation-mode:true}")
    private boolean simulationMode;
    
    @Value("${gridbot.trading.price-feed.url:wss://stream.binance.com:9443/ws}")
    private String websocketUrl;
    
    private final Map<String, BigDecimal> currentPrices = new ConcurrentHashMap<>();
    private final Map<String, Long> lastUpdateTime = new ConcurrentHashMap<>();
    
    private WebSocket webSocket;
    private HttpClient httpClient;
    
    // Symulowane ceny początkowe
    private final Map<String, BigDecimal> simulatedPrices = new ConcurrentHashMap<>(Map.of(
            "BTCUSDT", new BigDecimal("94000"),
            "ETHUSDT", new BigDecimal("3200"),
            "DOGEUSDT", new BigDecimal("0.35"),
            "SOLUSDT", new BigDecimal("180")
    ));
    
    @PostConstruct
    public void init() {
        if (simulationMode) {
            log.info("🎮 Price feed running in SIMULATION mode");
            currentPrices.putAll(simulatedPrices);
        } else {
            log.info("📡 Connecting to Binance WebSocket...");
            connectToWebSocket();
        }
    }
    
    @PreDestroy
    public void cleanup() {
        if (webSocket != null) {
            webSocket.sendClose(WebSocket.NORMAL_CLOSURE, "Shutting down");
        }
    }
    
    /**
     * Łączy się z WebSocket Binance
     */
    private void connectToWebSocket() {
        try {
            httpClient = HttpClient.newHttpClient();
            
            String streams = "btcusdt@trade/ethusdt@trade/dogeusdt@trade/solusdt@trade";
            String url = websocketUrl + "/" + streams;
            
            webSocket = httpClient.newWebSocketBuilder()
                    .buildAsync(URI.create(url), new WebSocketListener())
                    .join();
            
            log.info("✅ Connected to Binance WebSocket");
        } catch (Exception e) {
            log.error("❌ Failed to connect to WebSocket: {}", e.getMessage());
            // Fallback do trybu symulacji
            simulationMode = true;
            currentPrices.putAll(simulatedPrices);
        }
    }
    
    /**
     * Listener dla WebSocket
     */
    private class WebSocketListener implements WebSocket.Listener {
        private final StringBuilder messageBuilder = new StringBuilder();
        
        @Override
        public void onOpen(WebSocket webSocket) {
            log.info("WebSocket opened");
            webSocket.request(1);
        }
        
        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            messageBuilder.append(data);
            
            if (last) {
                processMessage(messageBuilder.toString());
                messageBuilder.setLength(0);
            }
            
            webSocket.request(1);
            return null;
        }
        
        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            log.warn("WebSocket closed: {} - {}", statusCode, reason);
            // Próba ponownego połączenia po 5 sekundach
            if (statusCode != WebSocket.NORMAL_CLOSURE) {
                new Thread(() -> {
                    try {
                        Thread.sleep(5000);
                        connectToWebSocket();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }).start();
            }
            return null;
        }
        
        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            log.error("WebSocket error: {}", error.getMessage());
        }
    }
    
    /**
     * Przetwarza wiadomość z WebSocket
     */
    private void processMessage(String message) {
        try {
            JsonNode json = objectMapper.readTree(message);
            
            if (json.has("s") && json.has("p")) {
                String symbol = json.get("s").asText();
                BigDecimal price = new BigDecimal(json.get("p").asText());
                
                currentPrices.put(symbol, price);
                lastUpdateTime.put(symbol, System.currentTimeMillis());
                
                // Wyślij przez WebSocket do klientów
                broadcastPrice(symbol, price);
            }
        } catch (Exception e) {
            log.error("Error processing message: {}", e.getMessage());
        }
    }
    
    /**
     * Symuluje zmiany cen (dla trybu symulacji)
     */
    @Scheduled(fixedRate = 2000)
    public void simulatePriceChanges() {
        if (!simulationMode) return;
        
        currentPrices.forEach((symbol, price) -> {
            // Losowa zmiana -0.5% do +0.5%
            double changePercent = (Math.random() - 0.5) * 0.01;
            BigDecimal newPrice = price.multiply(BigDecimal.ONE.add(BigDecimal.valueOf(changePercent)))
                    .setScale(symbol.contains("DOGE") ? 5 : 2, java.math.RoundingMode.HALF_UP);
            
            currentPrices.put(symbol, newPrice);
            lastUpdateTime.put(symbol, System.currentTimeMillis());
            
            broadcastPrice(symbol, newPrice);
        });
    }
    
    /**
     * Wysyła cenę przez WebSocket do klientów
     */
    private void broadcastPrice(String symbol, BigDecimal price) {
        try {
            Map<String, Object> priceData = Map.of(
                    "symbol", symbol,
                    "price", price,
                    "timestamp", System.currentTimeMillis()
            );
            
            messagingTemplate.convertAndSend("/topic/prices", priceData);
            messagingTemplate.convertAndSend("/topic/prices/" + symbol.toLowerCase(), priceData);
        } catch (Exception e) {
            log.error("Error broadcasting price: {}", e.getMessage());
        }
    }
    
    /**
     * Pobiera aktualną cenę dla symbolu
     */
    public BigDecimal getPrice(String symbol) {
        return currentPrices.getOrDefault(symbol.toUpperCase(), BigDecimal.ZERO);
    }
    
    /**
     * Pobiera wszystkie aktualne ceny
     */
    public Map<String, BigDecimal> getAllPrices() {
        return new ConcurrentHashMap<>(currentPrices);
    }
    
    /**
     * Sprawdza czy cena jest aktualna (nie starsza niż 30 sekund)
     */
    public boolean isPriceStale(String symbol) {
        Long lastUpdate = lastUpdateTime.get(symbol.toUpperCase());
        if (lastUpdate == null) return true;
        return System.currentTimeMillis() - lastUpdate > 30000;
    }
    
    /**
     * Ustawia cenę ręcznie (dla testów)
     */
    public void setPrice(String symbol, BigDecimal price) {
        currentPrices.put(symbol.toUpperCase(), price);
        lastUpdateTime.put(symbol.toUpperCase(), System.currentTimeMillis());
        broadcastPrice(symbol.toUpperCase(), price);
    }
}
