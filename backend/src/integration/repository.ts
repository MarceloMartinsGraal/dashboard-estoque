import { NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../db';
// SQL específico da integração; regras de cadastro/movimentação continuam nos serviços compartilhados.
export class IntegrationReadRepository {
    constructor(private readonly db: Database) { }
    snapshot<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
        return this.db.transaction(async (c) => {
            await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
            return work(c);
        });
    }
    async distribution(c: PoolClient, ids: string[]) {
        if (!ids.length)
            return [];
        return (await c.query(`SELECT m.product_id,a.id,a.code,a.name,a.active,SUM(l.delta)::text quantity
      FROM movements m JOIN ledger l ON l.movement_id=m.id JOIN locations a ON a.id=l.location_id
      WHERE m.product_id=ANY($1::uuid[]) GROUP BY m.product_id,a.id HAVING SUM(l.delta)>0 ORDER BY a.code,a.id`, [ids])).rows;
    }
    async product(c: PoolClient, id: string) {
        const p = (await c.query('SELECT id,unit,active,opening_date::text FROM products WHERE id=$1', [id])).rows[0];
        if (!p)
            throw new NotFoundException('Produto não encontrado');
        return p;
    }
    async locations(c: PoolClient, ids?: string[]) {
        return (await c.query('SELECT id,code,name,active FROM locations WHERE ' +
            (ids ? 'id=ANY($1::uuid[])' : 'active') + ' ORDER BY code,id', ids ? [ids] : [])).rows;
    }
    async result(instanceId: string, key: string) {
        const r = (await this.db.pool.query('SELECT operation,result,created_at FROM integration_operations WHERE instance_id=$1 AND idempotency_key=$2', [instanceId, key])).rows[0];
        if (!r)
            throw new NotFoundException('Operação não encontrada');
        return { idempotencyKey: key, instanceId, ...r };
    }
}
