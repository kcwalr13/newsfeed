// Database migration runner.
//
// Applies every lib/db/migrations/NNN_*.sql file in numeric order exactly once,
// recording applied versions in a schema_migrations table. Idempotent: files
// already recorded are skipped, and the migrations themselves use
// IF [NOT] EXISTS so a re-run against an already-provisioned database is safe.
//
// Usage:
//   node scripts/migrate.mjs            # apply pending migrations
//   node scripts/migrate.mjs --status   # list applied/pending, apply nothing
//
// Requires DATABASE_URL (read from the environment, or from .env.local if present).
// Run manually against Neon — NOT part of the build/deploy.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'lib', 'db', 'migrations');

// Neon's Pool talks WebSocket; Node 22+ ships a global WebSocket implementation.
if (typeof WebSocket !== 'undefined') {
  neonConfig.webSocketConstructor = WebSocket;
}

// Load DATABASE_URL from .env.local if not already in the environment.
if (!process.env.DATABASE_URL) {
  const envPath = join(__dirname, '..', '.env.local');
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (env or .env.local). Aborting.');
  process.exit(1);
}

const statusOnly = process.argv.includes('--status');

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      return na !== nb ? na - nb : a.localeCompare(b);
    });
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedRows = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRows.rows.map((r) => r.version));
    const files = migrationFiles();

    if (statusOnly) {
      console.log('Migration status:');
      for (const f of files) {
        console.log(`  ${applied.has(f) ? '[applied]' : '[pending]'} ${f}`);
      }
      return;
    }

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log('No pending migrations. Database is up to date.');
      return;
    }

    for (const file of pending) {
      const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      process.stdout.write(`Applying ${file} ... `);
      try {
        // Each file is executed as a single script; files that need atomicity
        // wrap themselves in BEGIN/COMMIT (e.g. 016).
        await client.query(sqlText);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        console.log('ok');
      } catch (err) {
        console.log('FAILED');
        console.error(`\nMigration ${file} failed:\n${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }
    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
