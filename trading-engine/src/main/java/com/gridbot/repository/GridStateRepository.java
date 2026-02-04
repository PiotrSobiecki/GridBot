package com.gridbot.repository;

import com.gridbot.model.GridState;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface GridStateRepository extends JpaRepository<GridState, String> {
    Optional<GridState> findByWalletAddressAndOrderId(String walletAddress, String orderId);
    List<GridState> findByWalletAddress(String walletAddress);
    List<GridState> findByIsActiveTrue();
}
