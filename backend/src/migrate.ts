import { logProcessFailure } from './diagnostics';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
export async function migrate(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(742105)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir(resolve('backend/migrations')))
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      const sql = await readFile(resolve('backend/migrations', name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const found = await client.query(
        'SELECT checksum FROM schema_migrations WHERE name=$1',
        [name],
      );
      if (found.rowCount) {
        if (found.rows[0].checksum !== checksum)
          throw new Error('Migração aplicada foi alterada: ' + name);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',
          [name, checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(742105)');
    client.release();
  }
}
if (require.main === module) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  migrate(pool)
    .then(() => console.log('Migrações aplicadas.'))
    .catch((error) => {
      logProcessFailure('migrate', error);
      console.error(
        'Falha na migração; confira o ambiente e a versão do banco.',
      );
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
