/**
 * Wypisuje z SQLite pełne ustawienia zlecenia (UserSettings.orders)
 * dla podanego orderId.
 *
 * Uruchom:
 *   cd auth-service
 *   node scripts/print-order-settings.js
 */
import db from "../src/trading/db.js";

// ORDER_ID można przekazać jako argument CLI:
// node scripts/print-order-settings.js <orderId>
const ORDER_ID =
  process.argv[2] || "563a5f8a-e41d-42af-9401-e9412f26b5ec";

function printOrderSettings(orderId) {
  const row = db
    .prepare("SELECT * FROM user_settings WHERE wallet_address = ?")
    .get("0xf8c5da53b1bec27acad14ae52112fe6410b1fe31".toLowerCase());

  if (!row) {
    console.log("No user_settings row found for this wallet.");
    return;
  }

  const orders = JSON.parse(row.orders || "[]");
  const order = orders.find((o) => o.id === orderId || o._id === orderId);

  console.log("=== RAW USER_SETTINGS ===");
  console.log(JSON.stringify(row, null, 2));

  console.log("\n=== MATCHING ORDER SETTINGS ===");
  console.log(JSON.stringify(order, null, 2));
}

printOrderSettings(ORDER_ID);
console.log("\n✅ Done");

