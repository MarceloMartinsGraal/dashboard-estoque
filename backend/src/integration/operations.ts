import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { audit, Database } from '../db';
import { StockService } from '../stock';
import { ProductService } from '../products';
import { formatQuantity, parseQuantity } from '../quantity';
import { validate } from '../validation';
import { Client, keySchema, moveSchema, createSchema } from './contracts';
import { enabled } from './auth';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
// A ordem das propriedades não altera o fingerprint. Valores são validados antes.
const canonical = (value: any): string => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v)
        .sort()
        .map((k) => [k, v[k]]))
    : v);
@Injectable()
export class IntegrationOperations {
    constructor(private readonly db: Database, private readonly stock: StockService, private readonly products: ProductService) { }
    private async actor(c: PoolClient, client: Client, externalUserId: string, scope: string) {
        enabled();
        // Revogação/permissões e vínculo são reavaliados dentro da transação, após esperar pela chave.
        if (!(await c.query('SELECT id FROM integration_clients WHERE id=$1 AND instance_id=$2 AND active AND expires_at>clock_timestamp() AND $3=ANY(scopes) AND token_hash=$4 FOR SHARE', [client.id, client.instance_id, scope, client.credentialHash])).rowCount)
            throw new UnauthorizedException('Credencial de integração inválida');
        const link = (await c.query('SELECT employee_id FROM external_employee_links WHERE instance_id=$1 AND external_user_id=$2 AND active FOR SHARE', [client.instance_id, externalUserId])).rows[0];
        if (!link ||
            !(await c.query('SELECT id FROM employees WHERE id=$1 AND active FOR SHARE', [link.employee_id])).rowCount)
            throw new ForbiddenException('Usuário externo sem vínculo ativo com funcionário ativo');
        return link.employee_id as string;
    }
    private async execute(client: Client, key: unknown, operation: 'movement' | 'product', data: any, work: (c: PoolClient, actor: string) => Promise<any>) {
        const idempotencyKey = validate(keySchema, key);
        const fingerprint = hash(canonical({ operation, data }));
        return this.db.transaction(async (c) => {
            await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
                JSON.stringify([client.instance_id, idempotencyKey]),
            ]);
            const previous = (await c.query('SELECT fingerprint,result FROM integration_operations WHERE instance_id=$1 AND idempotency_key=$2', [client.instance_id, idempotencyKey])).rows[0];
            // Mesmo identificador, conteúdo diferente: nunca executar ou sobrescrever.
            if (previous && previous.fingerprint !== fingerprint)
                throw new ConflictException('Chave de idempotência já utilizada com conteúdo diferente');
            const actor = await this.actor(c, client, data.externalUserId, operation === 'movement' ? 'movements:write' : 'products:write');
            if (previous)
                return previous.result;
            const result = await work(c, actor);
            await c.query('INSERT INTO integration_operations(instance_id,idempotency_key,operation,fingerprint,result,client_id,employee_id,external_user_id,ticket_id,movement_id,product_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [
                client.instance_id,
                idempotencyKey,
                operation,
                fingerprint,
                JSON.stringify(result),
                client.id,
                actor,
                data.externalUserId,
                data.ticketId ?? null,
                operation === 'movement' ? result.id : null,
                operation === 'movement' ? data.productId : result.id,
            ]);
            await audit(c, actor, 'integracao_' + operation, 'operacao_integracao', idempotencyKey, {
                instanceId: client.instance_id,
                clientId: client.id,
                externalUserId: data.externalUserId,
                ticketId: data.ticketId ?? null,
                resultId: result.id,
            });
            return result;
        });
    }
    async move(client: Client, key: unknown, body: unknown) {
        const d = validate(moveSchema, body);
        d.quantity = formatQuantity(parseQuantity(d.quantity, 'unidade'));
        return this.execute(client, key, 'movement', d, async (c, actor) => {
            const m = await this.stock.move(actor, {
                productId: d.productId,
                kind: d.kind,
                quantity: d.quantity,
                eventDate: d.eventDate,
                reason: d.reason,
                ticket: d.ticketId,
                locationId: d.locationId,
                justification: d.observation,
            }, c);
            return {
                id: m.id,
                productId: m.product_id,
                kind: m.kind,
                quantity: formatQuantity(BigInt(m.quantity)),
                eventDate: d.eventDate,
                recordedAt: m.recorded_at.toISOString(),
                actorId: actor,
                locationId: d.locationId,
                reason: d.reason,
                observation: d.observation ?? null,
                externalReference: {
                    instanceId: client.instance_id,
                    ticketId: d.ticketId,
                    externalUserId: d.externalUserId,
                },
            };
        });
    }
    async create(client: Client, key: unknown, body: unknown) {
        const d = validate(createSchema, body);
        return this.execute(client, key, 'product', d, async (c, actor) => {
            const { externalUserId, ...product } = d;
            return this.products.save(actor, product, c, true);
        });
    }
}
