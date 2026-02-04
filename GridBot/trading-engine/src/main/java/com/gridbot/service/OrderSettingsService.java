package com.gridbot.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gridbot.dto.OrderSettingsDto;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Serwis do pobierania i cache'owania ustawień zleceń
 */
@Service
public class OrderSettingsService {
    
    private static final Logger log = LoggerFactory.getLogger(OrderSettingsService.class);
    
    @Value("${gridbot.auth-service.url}")
    private String authServiceUrl;
    
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final OkHttpClient httpClient = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build();
    
    // Cache dla ustawień (odświeżany co minutę)
    private final Map<String, CachedSettings> settingsCache = new ConcurrentHashMap<>();
    private static final long CACHE_TTL_MS = 60000; // 1 minuta
    
    /**
     * Pobiera ustawienia zlecenia (z cache lub API)
     */
    public OrderSettingsDto getOrderSettings(String walletAddress, String orderId) {
        String cacheKey = walletAddress + ":" + orderId;
        CachedSettings cached = settingsCache.get(cacheKey);
        
        if (cached != null && !cached.isExpired()) {
            return cached.settings;
        }
        
        try {
            OrderSettingsDto settings = fetchFromApi(walletAddress, orderId);
            if (settings != null) {
                settingsCache.put(cacheKey, new CachedSettings(settings));
            }
            return settings;
        } catch (Exception e) {
            log.error("Failed to fetch settings: {}", e.getMessage());
            return cached != null ? cached.settings : null;
        }
    }
    
    private OrderSettingsDto fetchFromApi(String walletAddress, String orderId) {
        try {
            Request request = new Request.Builder()
                    .url(authServiceUrl + "/settings/orders")
                    .header("X-Wallet-Address", walletAddress)
                    .build();
            
            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful() || response.body() == null) {
                    return null;
                }
                
                String body = response.body().string();
                OrderSettingsDto[] orders = objectMapper.readValue(body, OrderSettingsDto[].class);
                
                for (OrderSettingsDto order : orders) {
                    if (orderId.equals(order.getId())) {
                        return order;
                    }
                }
            }
        } catch (Exception e) {
            log.error("API call failed: {}", e.getMessage());
        }
        
        return null;
    }
    
    /**
     * Czyści cache dla konkretnego zlecenia
     */
    public void invalidateCache(String walletAddress, String orderId) {
        settingsCache.remove(walletAddress + ":" + orderId);
    }
    
    /**
     * Czyści cały cache
     */
    public void clearCache() {
        settingsCache.clear();
    }
    
    private static class CachedSettings {
        final OrderSettingsDto settings;
        final long timestamp;
        
        CachedSettings(OrderSettingsDto settings) {
            this.settings = settings;
            this.timestamp = System.currentTimeMillis();
        }
        
        boolean isExpired() {
            return System.currentTimeMillis() - timestamp > CACHE_TTL_MS;
        }
    }
}
