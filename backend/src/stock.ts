import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { audit, Database } from './db';
import { formatQuantity, parseQuantity } from './quantity';
import { eventDate, text, uuid, validate } from './validation';
export const movementSchema = z
  .object({
    productId: uuid,
    kind: z.enum([
      'entrada',
      'saida',
      'ajuste_entrada',
      'ajuste_saida',
      'realocacao',
    ]),
    quantity: z.string().max(24),
    eventDate,
    reason: z.enum([
      'chamado',
      'uso_interno',
      'rma',
      'outro',
      'correcao_estoque',
      'recebimento',
    ]),
    ticket: z.string().trim().max(100).optional(),
    justification: z.string().trim().max(2000).optional(),
    locationId: uuid,
    destinationId: uuid.optional(),
  })
  .strict();
export type MovementInput = z.infer<typeof movementSchema>;
export const openingSchema = z
  .object({
    eventDate,
    counts: z
      .array(
        z.object({ locationId: uuid, quantity: z.string().max(24) }).strict(),
      )
      .min(1)
      .max(500),
    justification: text,
  })
  .strict();
@Injectable()
export class StockService {
  constructor(private readonly db: Database) {}
  private async lock(client: PoolClient, actor: string, id: string) {
    if (
      !(
        await client.query(
          'SELECT id FROM employees WHERE id=$1 AND active AND NOT must_change_password FOR SHARE',
          [actor],
        )
      ).rowCount
    )
      throw new UnauthorizedException();
    const product = (
      await client.query(
        'SELECT *, opening_date::text AS cutoff FROM products WHERE id=$1 FOR UPDATE',
        [validate(uuid, id)],
      )
    ).rows[0];
    if (!product) throw new NotFoundException('Produto não encontrado');
    if (!product.active) throw new ConflictException('Produto inativo');
    return product;
  }
  private async location(client: PoolClient, id: string) {
    if (
      !(
        await client.query(
          'SELECT id FROM locations WHERE id=$1 AND active FOR SHARE',
          [validate(uuid, id)],
        )
      ).rowCount
    )
      throw new BadRequestException('Armário inválido ou inativo');
  }
  private async checkBalances(client: PoolClient, product: string) {
    const negative = await client.query(
      `WITH daily AS (
   SELECT m.event_date,l.location_id,SUM(l.delta) AS delta FROM ledger l JOIN movements m ON m.id=l.movement_id WHERE m.product_id=$1 GROUP BY m.event_date,l.location_id
  ), running AS (SELECT SUM(delta) OVER(PARTITION BY location_id ORDER BY event_date) AS balance FROM daily)
  SELECT 1 FROM running WHERE balance<0 LIMIT 1`,
      [product],
    );
    if (negative.rowCount)
      throw new ConflictException(
        'Saldo insuficiente no armário ou em fechamento histórico',
      );
  }
  async opening(
    actor: string,
    id: string,
    date: string,
    counts: { locationId: string; quantity: string }[],
    justification: string,
  ) {
    const data = validate(openingSchema, {
      eventDate: date,
      counts,
      justification,
    });
    return this.db.transaction(async (client) => {
      const p = await this.lock(client, actor, id);
      if (p.cutoff) throw new ConflictException('Abertura já aprovada');
      if (new Set(counts.map((c) => c.locationId)).size !== counts.length)
        throw new BadRequestException('Armário repetido');
      const values = [];
      let total = 0n;
      for (const item of data.counts) {
        await this.location(client, item.locationId);
        const q =
          item.quantity === '0' ? 0n : parseQuantity(item.quantity, p.unit);
        values.push({ id: item.locationId, q });
        total += q;
      }
      if (total > 9_000_000_000_000_000n)
        throw new BadRequestException('Contagem excede limite');
      let movement = null;
      if (total > 0n) {
        movement = (
          await client.query(
            "INSERT INTO movements(product_id,kind,quantity,event_date,actor_id,reason,justification) VALUES($1,'abertura',$2,$3,$4,'contagem_fisica',$5) RETURNING *",
            [id, total.toString(), date, actor, data.justification],
          )
        ).rows[0];
        for (const v of values)
          if (v.q > 0n)
            await client.query(
              'INSERT INTO ledger(movement_id,location_id,delta) VALUES($1,$2,$3)',
              [movement.id, v.id, v.q.toString()],
            );
      }
      await client.query('UPDATE products SET opening_date=$2 WHERE id=$1', [
        id,
        date,
      ]);
      await audit(client, actor, 'aprovar_abertura', 'produto', id, {
        date,
        counts,
        justification: data.justification,
      });
      return { id: movement?.id, productId: id, status: 'aprovada' };
    });
  }
  async move(actor: string, input: MovementInput, client?: PoolClient) {
    const data = validate(movementSchema, input);
    if (data.reason === 'chamado' && !data.ticket)
      throw new BadRequestException('Chamado obrigatório');
    if (
      (data.kind.startsWith('ajuste') ||
        ['outro', 'correcao_estoque'].includes(data.reason)) &&
      !data.justification
    )
      throw new BadRequestException('Justificativa obrigatória');
    if (
      data.kind === 'realocacao' &&
      (!data.destinationId || data.destinationId === data.locationId)
    )
      throw new BadRequestException(
        'Armários de origem e destino devem ser distintos',
      );
    const execute = async (client: PoolClient) => {
      const p = await this.lock(client, actor, data.productId);
      if (!p.cutoff)
        throw new ConflictException(
          'Abertura pendente de contagem física aprovada',
        );
      if (data.eventDate < p.cutoff)
        throw new BadRequestException('Data anterior à abertura');
      const quantity = parseQuantity(data.quantity, p.unit);
      await this.location(client, data.locationId);
      if (data.kind === 'realocacao')
        await this.location(client, data.destinationId!);
      const m = (
        await client.query(
          'INSERT INTO movements(product_id,kind,quantity,event_date,actor_id,reason,ticket,justification) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
          [
            p.id,
            data.kind,
            quantity.toString(),
            data.eventDate,
            actor,
            data.reason,
            data.ticket || null,
            data.justification || null,
          ],
        )
      ).rows[0];
      const outgoing = ['saida', 'ajuste_saida', 'realocacao'].includes(
        data.kind,
      );
      await client.query(
        'INSERT INTO ledger(movement_id,location_id,delta) VALUES($1,$2,$3)',
        [m.id, data.locationId, (outgoing ? -quantity : quantity).toString()],
      );
      if (data.kind === 'realocacao')
        await client.query(
          'INSERT INTO ledger(movement_id,location_id,delta) VALUES($1,$2,$3)',
          [m.id, data.destinationId, quantity.toString()],
        );
      await this.checkBalances(client, p.id);
      await audit(client, actor, 'movimentar', 'movimentacao', m.id, data);
      return m;
    };
    return client ? execute(client) : this.db.transaction(execute);
  }
  async reverse(
    actor: string,
    id: string,
    date: string,
    justification: string,
  ) {
    validate(z.object({ id: uuid, date: eventDate, justification: text }), {
      id,
      date,
      justification,
    });
    return this.db.transaction(async (client) => {
      const original = (
        await client.query(
          'SELECT *,event_date::text AS date FROM movements WHERE id=$1',
          [id],
        )
      ).rows[0];
      if (!original) throw new NotFoundException('Movimentação não encontrada');
      await this.lock(client, actor, original.product_id);
      if (['abertura', 'estorno'].includes(original.kind))
        throw new BadRequestException(
          'Abertura exige ajuste documentado; estorno não pode ser estornado',
        );
      const originalLocations = await client.query(
        'SELECT DISTINCT location_id FROM ledger WHERE movement_id=$1 ORDER BY location_id',
        [id],
      );
      for (const row of originalLocations.rows)
        await this.location(client, row.location_id);
      if (date < original.date)
        throw new BadRequestException('Estorno anterior ao lançamento');
      if (
        (
          await client.query('SELECT id FROM movements WHERE reversal_of=$1', [
            id,
          ])
        ).rowCount
      )
        throw new ConflictException('Movimentação já estornada');
      const m = (
        await client.query(
          "INSERT INTO movements(product_id,kind,quantity,event_date,actor_id,reason,justification,reversal_of) VALUES($1,'estorno',$2,$3,$4,'correcao_estoque',$5,$6) RETURNING *",
          [
            original.product_id,
            original.quantity,
            date,
            actor,
            justification,
            id,
          ],
        )
      ).rows[0];
      await client.query(
        'INSERT INTO ledger(movement_id,location_id,delta) SELECT $1,location_id,-delta FROM ledger WHERE movement_id=$2',
        [m.id, id],
      );
      await this.checkBalances(client, original.product_id);
      await audit(client, actor, 'estornar', 'movimentacao', m.id, {
        originalId: id,
        justification,
      });
      return m;
    });
  }
  async balances(product: string, client: Pick<PoolClient, 'query'> = this.db.pool) {
    validate(uuid, product);
    const result = await client.query(
      'SELECT a.id,a.name,SUM(l.delta)::text AS quantity FROM ledger l JOIN movements m ON m.id=l.movement_id JOIN locations a ON a.id=l.location_id WHERE m.product_id=$1 GROUP BY a.id ORDER BY a.name',
      [product],
    );
    let total = 0n;
    const locations = result.rows.map((r) => {
      total += BigInt(r.quantity);
      return { ...r, quantity: formatQuantity(BigInt(r.quantity)) };
    });
    return { total: formatQuantity(total), locations };
  }
}
