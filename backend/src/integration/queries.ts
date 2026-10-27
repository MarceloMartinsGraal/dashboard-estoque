import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Database } from '../db';
import { ProductService } from '../products';
import { StockService } from '../stock';
import { formatQuantity } from '../quantity';
import { queryHistory } from '../history';
import { pageFields, validate, uuid } from '../validation';
import { Client, externalId, keySchema } from './contracts';
import { IntegrationReadRepository } from './repository';
export class IntegrationQueries {
    private readonly repository: IntegrationReadRepository;
    constructor(private readonly db: Database, private readonly stock: StockService, private readonly products: ProductService) {
        this.repository = new IntegrationReadRepository(db);
    }
    productOptions() { return this.repository.snapshot(c => this.products.productOptions(c)); }
    matches(query: unknown) { return this.products.matches(query); }
    async search(query: unknown) {
        const q = validate(z.object({ ...pageFields, q: z.string().max(200).default(''),
            availability: z.enum(['all', 'positive']).default('all'),
            status: z.enum(['todos', 'ativo', 'inativo', 'abertura_pendente']).default('todos') }).strict(), query);
        return this.repository.snapshot(async (c) => {
            const r = await this.products.search(q, true, c);
            const distributions = await this.repository.distribution(c, r.items.map(p => p.id));
            return { ...r, items: r.items.map(p => ({
                    id: p.id, description: p.description, unit: p.unit, active: p.active,
                    legacyId: p.legacy_id?.toString() ?? null, quantity: p.quantity, openingDate: p.opening_date,
                    locations: distributions.filter(l => l.product_id === p.id).map(({ product_id, ...l }) => ({ ...l, quantity: formatQuantity(BigInt(l.quantity)) })),
                })) };
        });
    }
    private async productBalances(c: PoolClient, id: string) {
        const p = await this.repository.product(c, id);
        const b = await this.stock.balances(id, c);
        const locations = await this.repository.locations(c, b.locations.map(l => l.id));
        const byId = new Map(locations.map(l => [l.id, l]));
        return { productId: id, unit: p.unit, active: p.active, openingDate: p.opening_date,
            ...b, locations: b.locations.map(l => ({ ...l, ...byId.get(l.id) })) };
    }
    balances(id: string) {
        validate(uuid, id);
        return this.repository.snapshot(c => this.productBalances(c, id));
    }
    async locations(query: unknown, productId?: string) {
        const q = validate(z.object({ ...pageFields, purpose: z.enum(['entrada', 'saida']).default('entrada') }).strict(), query);
        if (productId)
            validate(uuid, productId);
        else if (q.purpose === 'saida')
            throw new BadRequestException('Informe o produto para consultar disponibilidade');
        return this.repository.snapshot(async (c) => {
            const balances = productId ? await this.productBalances(c, productId) : undefined;
            const all = await this.repository.locations(c);
            const byId = new Map(balances?.locations.map(l => [l.id, l.quantity]) ?? []);
            const rows = balances ? all.map(l => ({ ...l, quantity: byId.get(l.id) ?? '0.000' }))
                .filter(l => q.purpose === 'entrada' || BigInt(l.quantity.split('.')[0]) > 0n) : all;
            return { items: rows.slice((q.page - 1) * q.limit, q.page * q.limit), total: rows.length, page: q.page, limit: q.limit };
        });
    }
    result(client: Client, key: string) {
        validate(keySchema, key);
        return this.repository.result(client.instance_id, key);
    }
    history(client: Client, ticketId: string, query: unknown) {
        validate(externalId, ticketId);
        const q = validate(z.object({ ...pageFields, flow: z.enum(['entrada', 'saida', 'realocacao', 'abertura']).optional() }).strict(), query);
        return queryHistory(this.db, q, { instanceId: client.instance_id, ticketId });
    }
}
