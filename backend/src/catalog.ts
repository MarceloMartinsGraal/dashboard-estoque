import { queryHistory } from './history';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { SessionGuard } from './auth';
import { Database, audit } from './db';
import { formatQuantity } from './quantity';
import { text, uuid, validate } from './validation';
const pageFields = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};
const productSchema = z
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
@Controller()
@UseGuards(SessionGuard)
export class CatalogController {
  constructor(private readonly db: Database) {}
  @Get('catalog') async catalog() {
    const [categories, subcategories, units, locations] = await Promise.all(
      ['categories', 'subcategories', 'units', 'locations'].map((table) =>
        this.db.pool.query(
          'SELECT * FROM ' +
            table +
            ' ORDER BY ' +
            (table === 'units' ? 'code' : 'name'),
        ),
      ),
    );
    return {
      categories: categories.rows,
      subcategories: subcategories.rows,
      units: units.rows,
      locations: locations.rows,
    };
  }
  @Get('products') async products(@Query() query: unknown) {
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
      q.q,
      q.categoryId ?? null,
      q.locationId ?? null,
      q.status,
    ];
    const where = `($1='' OR p.description ILIKE '%'||$1||'%' OR p.legacy_id::text=$1) AND ($2::uuid IS NULL OR p.category_id=$2) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM ledger l JOIN movements m ON m.id=l.movement_id WHERE m.product_id=p.id AND l.location_id=$3)) AND ($4='todos' OR ($4='ativo' AND p.active) OR ($4='inativo' AND NOT p.active) OR ($4='abertura_pendente' AND p.opening_date IS NULL))`;
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
  @Post('products') async saveProduct(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const d = validate(productSchema, body);
    if (d.subcategoryId && !d.categoryId)
      throw new BadRequestException('Subcategoria exige categoria');
    return this.db.transaction(async (c) => {
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
              [p.id, o.quantity, req.employee!.id],
            )
          ).rows[0];
          await c.query(
            'INSERT INTO ledger(movement_id,location_id,delta) VALUES($1,$2,$3),($1,$4,$5)',
            [m.id, o.location_id, '-' + o.quantity, d.locationId, o.quantity],
          );
        }
      }
      await audit(
        c,
        req.employee!.id,
        d.id ? 'editar' : 'criar',
        'produto',
        p.id,
        { before, after: d },
      );
      return p;
    });
  }
  @Post('locations') async location(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const d = validate(
      z
        .object({
          id: uuid.optional(),
          code: z.string().trim().min(1).max(50),
          name: text,
          active: z.boolean(),
        })
        .strict(),
      body,
    );
    return this.db.transaction(async (c) => {
      let before = null;
      if (d.id) {
        before = (
          await c.query('SELECT * FROM locations WHERE id=$1 FOR UPDATE', [
            d.id,
          ])
        ).rows[0];
        if (!before) throw new NotFoundException();
        if (before.code === 'NAO_INFORMADA')
          throw new ConflictException('Localização legada é preservada');
        if (
          !d.active &&
          (
            await c.query(
              'SELECT 1 FROM ledger WHERE location_id=$1 GROUP BY location_id HAVING SUM(delta)<>0',
              [d.id],
            )
          ).rowCount
        )
          throw new ConflictException(
            'Armário com saldo não pode ser inativado',
          );
      }
      const row = d.id
        ? (
            await c.query(
              'UPDATE locations SET code=$2,name=$3,active=$4 WHERE id=$1 RETURNING id',
              [d.id, d.code, d.name, d.active],
            )
          ).rows[0]
        : (
            await c.query(
              'INSERT INTO locations(code,name,active) VALUES($1,$2,$3) RETURNING id',
              [d.code, d.name, d.active],
            )
          ).rows[0];
      await audit(
        c,
        req.employee!.id,
        d.id ? 'editar' : 'criar',
        'armario',
        row.id,
        { before, after: d },
      );
      return row;
    });
  }
  @Post('categories') async category(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.classification(req, body, false);
  }
  @Post('subcategories') async subcategory(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.classification(req, body, true);
  }
  private async classification(req: Request, body: unknown, sub: boolean) {
    const d = validate(
      z
        .object({
          id: uuid.optional(),
          name: text,
          active: z.boolean(),
          categoryId: uuid.optional(),
        })
        .strict(),
      body,
    );
    if (sub && !d.categoryId)
      throw new BadRequestException('Categoria obrigatória');
    if (!sub && d.categoryId) throw new BadRequestException('Campo inesperado');
    return this.db.transaction(async (c) => {
      const table = sub ? 'subcategories' : 'categories';
      const before = d.id
        ? (
            await c.query(
              'SELECT * FROM ' + table + ' WHERE id=$1 FOR UPDATE',
              [d.id],
            )
          ).rows[0]
        : null;
      if (d.id && !before) throw new NotFoundException();
      let row;
      if (sub)
        row = d.id
          ? (
              await c.query(
                'UPDATE subcategories SET name=$2,active=$3,category_id=$4 WHERE id=$1 RETURNING id',
                [d.id, d.name, d.active, d.categoryId],
              )
            ).rows[0]
          : (
              await c.query(
                'INSERT INTO subcategories(name,active,category_id) VALUES($1,$2,$3) RETURNING id',
                [d.name, d.active, d.categoryId],
              )
            ).rows[0];
      else
        row = d.id
          ? (
              await c.query(
                'UPDATE categories SET name=$2,active=$3 WHERE id=$1 RETURNING id',
                [d.id, d.name, d.active],
              )
            ).rows[0]
          : (
              await c.query(
                'INSERT INTO categories(name,active) VALUES($1,$2) RETURNING id',
                [d.name, d.active],
              )
            ).rows[0];
      await audit(
        c,
        req.employee!.id,
        d.id ? 'editar' : 'criar',
        sub ? 'subcategoria' : 'categoria',
        row.id,
        { before, after: d },
      );
      return row;
    });
  }

  @Post('units') async unit(@Req() req: Request, @Body() body: unknown) {
    const d = validate(
      z.object({ code: z.literal('unidade'), name: text }).strict(),
      body,
    );
    return this.db.transaction(async (c) => {
      const before = (
        await c.query('SELECT * FROM units WHERE code=$1 FOR UPDATE', [d.code])
      ).rows[0];
      if (!before) throw new NotFoundException();
      await c.query('UPDATE units SET name=$2 WHERE code=$1', [d.code, d.name]);
      await audit(c, req.employee!.id, 'editar', 'unidade', d.code, {
        before,
        after: d,
      });
      return { code: d.code };
    });
  }
  @Get('overview') async overview() {
    const totals = await this.db.pool.query(
      'SELECT p.unit,COALESCE(SUM(l.delta),0)::text quantity FROM products p LEFT JOIN movements m ON m.product_id=p.id LEFT JOIN ledger l ON l.movement_id=m.id GROUP BY p.unit',
    );
    const counts = (
      await this.db.pool.query(
        'SELECT COUNT(*)::int products,COUNT(*) FILTER(WHERE opening_date IS NULL)::int pending FROM products',
      )
    ).rows[0];
    return {
      ...counts,
      totals: Object.fromEntries(
        totals.rows.map((r) => [r.unit, formatQuantity(BigInt(r.quantity))]),
      ),
    };
  }

  @Get('history') history(@Query() query: unknown) {
    return queryHistory(this.db, query);
  }
  @Get('history/filters') async historyFilters() {
    return {
      employees: (
        await this.db.pool.query(
          'SELECT id,name,active FROM employees ORDER BY name,id',
        )
      ).rows,
    };
  }
  @Get('locations') async locations(@Query() query: unknown) {
    const q = validate(
      z
        .object({
          ...pageFields,
          q: z.string().trim().max(200).default(''),
          status: z.enum(['todos', 'ativo', 'inativo']).default('todos'),
        })
        .strict(),
      query,
    );
    const where =
      "(strpos(lower(a.code||' '||a.name),lower($1))>0) AND ($2='todos' OR a.active=($2='ativo'))";
    const total = (
      await this.db.pool.query(
        'SELECT COUNT(*)::text total FROM locations a WHERE ' + where,
        [q.q, q.status],
      )
    ).rows[0].total;
    const items = (
      await this.db.pool.query(
        `SELECT a.*,(SELECT COALESCE(jsonb_object_agg(s.unit,s.quantity),'{}'::jsonb) FROM (SELECT p.unit,SUM(l.delta)::text quantity FROM ledger l JOIN movements m ON m.id=l.movement_id JOIN products p ON p.id=m.product_id WHERE l.location_id=a.id GROUP BY p.unit) s) totals FROM locations a WHERE ${where} ORDER BY a.code,a.id LIMIT $3 OFFSET $4`,
        [q.q, q.status, q.limit, (q.page - 1) * q.limit],
      )
    ).rows;
    return {
      items: items.map((r) => ({
        ...r,
        totals: Object.fromEntries(
          Object.entries(r.totals).map(([u, n]) => [
            u,
            formatQuantity(BigInt(n as string)),
          ]),
        ),
      })),
      total: Number(total),
      page: q.page,
      limit: q.limit,
    };
  }
  @Get('locations/:id/products') async locationProducts(
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    validate(uuid, id);
    const q = validate(z.object(pageFields).strict(), query);
    const rows = (
      await this.db.pool.query(
        `SELECT p.id,p.description,p.unit,p.active,p.opening_date::text opening_date,p.legacy_id,SUM(l.delta)::text quantity FROM products p JOIN movements m ON m.product_id=p.id JOIN ledger l ON l.movement_id=m.id WHERE l.location_id=$1 GROUP BY p.id HAVING SUM(l.delta)>0 ORDER BY p.description,p.id LIMIT $2 OFFSET $3`,
        [id, q.limit, (q.page - 1) * q.limit],
      )
    ).rows;
    return rows.map((r) => ({
      ...r,
      quantity: formatQuantity(BigInt(r.quantity)),
    }));
  }
  @Get('audit') async audit() {
    return (
      await this.db.pool.query(
        'SELECT a.id,a.action,a.entity,a.entity_id,a.recorded_at,e.name author FROM audit_log a LEFT JOIN employees e ON e.id=a.actor_id ORDER BY a.id DESC LIMIT 200',
      )
    ).rows;
  }
}
