// Sprawdź strukturę tabeli user_settings
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../data/gridbot.db');

const db = new Database(dbPath);

console.log('📊 Structure of user_settings table:');
console.log('');

const columns = db.prepare('PRAGMA table_info(user_settings)').all();

columns.forEach(col => {
  console.log(`  ${col.name.padEnd(20)} ${col.type.padEnd(15)} ${col.dflt_value !== null ? `DEFAULT: ${col.dflt_value}` : ''}`);
});

console.log('');
console.log('✅ Schema check completed');

db.close();
