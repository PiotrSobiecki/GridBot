/**
 * Jednorazowe czyszczenie osieroconych stanów GRID/pozycji
 * dla podanych orderId.
 *
 * Uruchom:
 *   cd auth-service
 *   node scripts/cleanup-orphan-orders.js
 */
import db from "../src/trading/db.js";

const ORPHAN_ORDER_IDS = [
  "5810ac96-24d0-48b4-9000-f8539d81be3b",
  "2c7cd9d0-c1ff-4667-88cb-a70361f1ac6b",
];

function cleanup() {
  for (const orderId of ORPHAN_ORDER_IDS) {
    const delStates = db
      .prepare("DELETE FROM grid_states WHERE order_id = ?")
      .run(orderId);
    const delPositions = db
      .prepare("DELETE FROM positions WHERE order_id = ?")
      .run(orderId);

    console.log(
      `🧹 orderId=${orderId}: deleted ${delStates.changes} grid_states, ${delPositions.changes} positions`
    );
  }
}

cleanup();
console.log("✅ Cleanup finished");

