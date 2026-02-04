package com.gridbot.repository;

import com.gridbot.model.Position;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PositionRepository extends JpaRepository<Position, String> {
    List<Position> findByWalletAddressAndOrderIdAndStatus(String walletAddress, String orderId, Position.PositionStatus status);
    List<Position> findByWalletAddressAndOrderId(String walletAddress, String orderId);
    List<Position> findByIdIn(List<String> ids);
}
