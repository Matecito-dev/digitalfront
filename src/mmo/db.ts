import pg from "pg";

let pool: pg.Pool | null = null;

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgresql://velis:velis@localhost:5432/velis";
}

export async function initDb(): Promise<pg.Pool> {
  if (pool) return pool;
  pool = new pg.Pool({ connectionString: getDatabaseUrl() });
  await pool.query("SELECT 1");
  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error("Database not initialized — call initDb() first");
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
