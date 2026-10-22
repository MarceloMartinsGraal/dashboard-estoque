import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { Database, audit } from './db';
import { formatQuantity } from './quantity';
import { pageFields, text, uuid, validate } from './validation';
import { foldSql, foldText } from './search';

export const productSchema = z
  .object({
    id: uuid.optional(),
    description: text,
    categoryId: uuid.nullable().default(null),
    subcategoryId: uuid.nullable().default(null),
    unit: z.literal('unidade').default('unidade'),
    active: z.boolean(),
    locationId: uuid.nullable().default(null),
  })
  .strict();
@Injectable()
export class ProductService {
  constructor(private readonly db: Database) {}
  async search(query: unknown, integrationSearch = false) {
    const q = validate(
      z
        .object({
          ...pageFields,
          q: z.string().max(200).default(''),
          categoryId: uuid.optional(),
          locationId: uuid.optional(),
          status: z
            .enum(['todos', 'ativo', 'inativo', 'abertura_pendente'])
            .default('todos'),
        })
        .strict(),
      query,
    );
    const args = [
      integrationSearch ? foldText(q.q) : q.q,
      q.categoryId ?? null,
      q.locationId ?? null,
      q.status,
    ];
    const search = integrationSearch
      ? `($1='' OR strpos(${foldSql("p.description||' '||COALESCE(p.legacy_id::text,'')||' '||p.id::text")},$1)>0)`
      : `($1='' OR p.description ILIKE '%'||$1||'%' OR p.legacy_id::text=$1)`;
    const where = `${search} AND ($2::uuid IS NULL OR p.category_id=$2) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM ledger l JOIN movements m ON m.id=l.movement_id WHERE m.product_id=p.id AND l.location_id=$3)) AND ($4='todos' OR ($4='ativo' AND p.active) OR ($4='inativo' AND NOT p.active) OR ($4='abertura_pendente' AND p.opening_date IS NULL))`;
    const items = await this.db.pool.query(
      `SELECT p.*,p.opening_date::text AS opening_date,c.name AS category,(SELECT COALESCE(SUM(l.delta),0)::text FROM movements m JOIN ledger l ON l.movement_id=m.id WHERE m.product_id=p.id) AS quantity,(SELECT COALESCE(jsonb_agg(s.location_id),'[]'::jsonb) FROM (SELECT l.location_id FROM movements m JOIN ledger l ON l.movement_id=m.id WHERE m.product_id=p.id GROUP BY l.location_id HAVING SUM(l.delta)>0) s) AS location_ids FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${where} ORDER BY p.description,p.id LIMIT $5 OFFSET $6`,
      [...args, q.limit, (q.page - 1) * q.limit],
    );
    const total = (
      await this.db.pool.query(
        `SELECT COUNT(*) FROM products p WHERE ${where}`,
        args,
      )
    ).rows[0].count;
    return {
      items: items.rows.map((p) => ({
        ...p,
        quantity: formatQuantity(BigInt(p.quantity)),
      })),
      total: Number(total),
      page: q.page,
      limit: q.limit,
    };
  }
  async save(actor: string, body: unknown, client?: PoolClient) {
    const d = validate(productSchema, body);
    if (d.subcategoryId && !d.categoryId)
      throw new BadRequestException('Subcategoria exige categoria');
    const execute = async (c: PoolClient) => {
      let before = null;
      if (d.id) {
        before = (
          await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [d.id])
        ).rows[0];
        if (!before) throw new NotFoundException();
      }
      const params = [
        d.description,
        d.categoryId,
        d.subcategoryId,
        d.unit,
        d.active,
      ];
      const p = d.id
        ? (
            await c.query(
              'UPDATE products SET description=$1,category_id=$2,subcategory_id=$3,unit=$4,active=$5 WHERE id=$6 RETURNING id',
              [...params, d.id],
            )
          ).rows[0]
        : (
            await c.query(
              'INSERT INTO products(description,category_id,subcategory_id,unit,active) VALUES($1,$2,$3,$4,$5) RETURNING id',
              params,
            )
          ).rows[0];
      if (d.locationId) {
        if (!before?.opening_date)
          throw new ConflictException(
            'Abra o saldo do produto antes de definir o armário',
          );
        if (
          !(
            await c.query(
              'SELECT 1 FROM locations WHERE id=$1 AND active FOR SHARE',
              [d.locationId],
            )
          ).rowCount
        )
          throw new BadRequestException('Armário inválido ou inativo');
        // Realocação rastreável de todo o saldo dos demais armários para o escolhido.
        const others = (
          await c.query(
            'SELECT l.location_id,SUM(l.delta)::text quantity FROM ledger l JOIN movements m ON m.id=l.movement_id WHERE m.product_id=$1 AND l.location_id<>$2 GROUP BY l.location_id HAVING SUM(l.delta)>0',
            [p.id, d.locationId],
          )
        ).rows;
        for (const o of others) {
          const m = (
            await c.query(
              "INSERT INTO movements(product_id,kind,quantity,event_date,actor_id,reason,justification) SELECT id,'realocacao',$2,GREATEST((now() AT TIME ZONE 'America/Sao_Paulo')::date,opening_date),$3,'outro','Armário definido no cadastro do produto' FROM products WHERE id=$1 RETURNING id",
              [p.id, o.quantity, actor],
            )
          ).rows[0];
          await c.query(
            'INSERT INTO ledger(movement_id,location_id,delta) VALUES($1,$2,$3),($1,$4,$5)',
            [m.id, o.location_id, '-' + o.quantity, d.locationId, o.quantity],
          );
        }
      }
      await audit(c, actor, d.id ? 'editar' : 'criar', 'produto', p.id, {
        before,
        after: d,
      });
      return p;
    };
    return client ? execute(client) : this.db.transaction(execute);
  }
}
