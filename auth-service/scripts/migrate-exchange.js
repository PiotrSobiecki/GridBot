// Skrypt migracyjny - dodaje kolumnę exchange do user_settings
import db from '../src/trading/db.js';

async function migrate() {
  try {
    console.log('🔄 Starting migration: adding exchange column to user_settings...');
    
    // Sprawdź czy kolumna już istnieje (SQLite)
    if (!db.pool) {
      // SQLite
      try {
        const result = db.prepare("PRAGMA table_info(user_settings)").all();
        const hasExchange = result.some(col => col.name === 'exchange');
        
        if (!hasExchange) {
          db.exec("ALTER TABLE user_settings ADD COLUMN exchange TEXT DEFAULT 'asterdex';");
          console.log('✅ Migration completed: Added exchange column to user_settings (SQLite)');
        } else {
          console.log('ℹ️ Migration skipped: exchange column already exists');
        }
      } catch (error) {
        if (error.message.includes('duplicate column')) {
          console.log('ℹ️ Migration skipped: exchange column already exists');
        } else {
          throw error;
        }
      }
    } else {
      // Postgres
      const result = await db.pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'user_settings' AND column_name = 'exchange'
      `);
      
      if (result.rows.length === 0) {
        await db.pool.query(`
          ALTER TABLE user_settings ADD COLUMN exchange VARCHAR(50) DEFAULT 'asterdex';
        `);
        console.log('✅ Migration completed: Added exchange column to user_settings (Postgres)');
      } else {
        console.log('ℹ️ Migration skipped: exchange column already exists');
      }
    }
    
    // Aktualizuj istniejące rekordy, które mają NULL
    if (!db.pool) {
      // SQLite
      const updateStmt = db.prepare("UPDATE user_settings SET exchange = 'asterdex' WHERE exchange IS NULL");
      const changes = updateStmt.run();
      if (changes.changes > 0) {
        console.log(`✅ Updated ${changes.changes} existing records with default exchange value`);
      }
    } else {
      // Postgres
      const result = await db.pool.query(`
        UPDATE user_settings SET exchange = 'asterdex' WHERE exchange IS NULL
      `);
      if (result.rowCount > 0) {
        console.log(`✅ Updated ${result.rowCount} existing records with default exchange value`);
      }
    }
    
    console.log('✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
