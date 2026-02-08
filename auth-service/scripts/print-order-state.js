
/**
 * Szybki podgląd stanu dla jednego orderId w SQLite.
 *
 * Uruchom:
 *   cd auth-service
 *   node scripts/print-order-state.js
 */
import db from "../src/trading/db.js";

// ORDER_ID można przekazać jako argument CLI:
// node scripts/print-order-state.js <orderId>
const ORDER_ID =
  process.argv[2] || "563a5f8a-e41d-42af-9401-e9412f26b5ec";

function printOrderState(orderId) {
  const gridStates = db
    .prepare("SELECT * FROM grid_states WHERE order_id = ?")
    .all(orderId);

  const positions = db
    .prepare("SELECT * FROM positions WHERE order_id = ? ORDER BY created_at")
    .all(orderId);

  console.log("=== GRID STATE(S) ===");
  console.log(JSON.stringify(gridStates, null, 2));

  console.log("\n=== POSITIONS ===");
  console.log(JSON.stringify(positions, null, 2));
}

printOrderState(ORDER_ID);
console.log("\n✅ Done");

