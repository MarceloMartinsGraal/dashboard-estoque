import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool: Pool;
  constructor() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL obrigatória');
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 12,
    });
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
export async function audit(
  client: PoolClient,
  actor: string,
  action: string,
  entity: string,
  id: string,
  details: unknown,
) {
  await client.query(
    'INSERT INTO audit_log(actor_id,action,entity,entity_id,details) VALUES($1,$2,$3,$4,$5)',
    [actor, action, entity, id, JSON.stringify(details)],
  );
}
