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
import { compareProducts } from './product-matches';
import { foldSql, foldText } from './search';

export const productSchema = z
  .object({
    id: uuid.optional(),
    duplicateConfirmation: z.object({candidateIds:z.array(uuid).min(1).max(10000),justification:z.string().trim().min(5).max(500)}).strict().optional(),
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
          ...(integrationSearch?{availability:z.enum(['all','positive']).default('all')}:{}),
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
    const positive=integrationSearch&&'availability' in q&&q.availability==='positive';
    const availability=positive?` AND p.active AND COALESCE((SELECT SUM(l.delta) FROM movements m JOIN ledger l ON l.movement_id=m.id WHERE m.product_id=p.id),0)>0`:'';
    const where = `${search}${availability} AND ($2::uuid IS NULL OR p.category_id=$2) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM ledger l JOIN movements m ON m.id=l.movement_id WHERE m.product_id=p.id AND l.location_id=$3)) AND ($4='todos' OR ($4='ativo' AND p.active) OR ($4='inativo' AND NOT p.active) OR ($4='abertura_pendente' AND p.opening_date IS NULL))`;
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
  async productOptions() {
    const [categories,subcategories]=await Promise.all([
      this.db.pool.query('SELECT id,name,active FROM categories ORDER BY name,id'),
      this.db.pool.query('SELECT id,name,category_id,active FROM subcategories ORDER BY name,id'),
    ]);
    return {categories:categories.rows,subcategories:subcategories.rows};
  }
  private async candidateRows(description: string, client: Pick<PoolClient,'query'> = this.db.pool) {
    const rows=(await client.query(`SELECT p.id,p.description,p.unit,p.active,p.opening_date::text AS opening_date,p.legacy_id AS "legacyId",c.name AS category,s.name AS subcategory,
      (SELECT COALESCE(SUM(l.delta),0)::text FROM movements m JOIN ledger l ON l.movement_id=m.id WHERE m.product_id=p.id) AS quantity
      FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN subcategories s ON s.id=p.subcategory_id ORDER BY p.id`)).rows;
    return rows.map(p=>({...p,quantity:formatQuantity(BigInt(p.quantity)),...compareProducts(description,p.description)})).filter(p=>p.similar)
      .sort((a,b)=>Number(b.exact)-Number(a.exact)||b.score-a.score||a.id.localeCompare(b.id));
  }
  async matches(query: unknown) {
    const q=validate(z.object({description:text,...pageFields}).strict(),query);
    const all=await this.candidateRows(q.description);
    return {items:all.slice((q.page-1)*q.limit,q.page*q.limit),total:all.length,page:q.page,limit:q.limit,candidateIds:all.map(p=>p.id).sort()};
  }
  async save(actor: string, body: unknown, client?: PoolClient, initializeEmpty = false) {
    const d = validate(productSchema, body);
    if (d.subcategoryId && !d.categoryId)
      throw new BadRequestException('Subcategoria exige categoria');
    const execute = async (c: PoolClient) => {
      let before = null;
      if (!d.id) {
        // Serializa criações normais para que duas confirmações não ignorem um cadastro recém-criado.
        await c.query("SELECT pg_advisory_xact_lock(736261,1)");
        const matches=await this.candidateRows(d.description,c);
        if(matches.length){
          const ids=matches.map(p=>p.id).sort();
          const confirmed=[...new Set(d.duplicateConfirmation?.candidateIds??[])].sort();
          if(JSON.stringify(ids)!==JSON.stringify(confirmed))throw new ConflictException({message:'Possíveis duplicatas encontradas ou lista alterada. Revise os candidatos e justifique se for produto diferente.',code:'PRODUCT_CANDIDATES',candidateIds:ids});
        }
      }
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
      // Apenas criação explicitamente solicitada pela integração: base zero, sem ledger.
      // Importação e produtos existentes nunca passam por esta inicialização.
      if (!d.id && initializeEmpty) {
        await c.query("UPDATE products SET opening_date=(now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id=$1", [p.id]);
        await audit(c, actor, 'inicializar_base_zero', 'produto', p.id, {
          origin: 'integration', quantity: '0.000', createsMovement: false,
        });
      }
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
      if (!d.id && d.duplicateConfirmation) await audit(c,actor,'confirmar_produto_distinto','produto',p.id,d.duplicateConfirmation);
      await audit(c, actor, d.id ? 'editar' : 'criar', 'produto', p.id, {
        before,
        after: d,
      });
      return p;
    };
    return client ? execute(client) : this.db.transaction(execute);
  }
}
