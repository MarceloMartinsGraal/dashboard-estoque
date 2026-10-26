import {
  BadRequestException,
  Body,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { audit, Database } from './db';
import { ProductService, productSchema } from './products';
import { StockService, movementSchema } from './stock';
import { formatQuantity, parseQuantity } from './quantity';
import { queryHistory } from './history';
import { pageFields, validate, uuid } from './validation';

type Client = {
  id: string;
  instance_id: string;
  scopes: string[];
  credentialHash: string;
};
declare global {
  namespace Express {
    interface Request {
      integrationClient?: Client;
    }
  }
}
const prefix = '/api/integration/v1';
export const isIntegrationRequest = (req: Request) =>
  req.path === prefix || req.path.startsWith(prefix + '/');
const keySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/);
const externalId = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (v) => v === v.trim() && !/\p{Cc}/u.test(v),
    'Identificador textual inválido',
  );

const moveSchema = movementSchema
  .omit({ ticket: true, justification: true, destinationId: true })
  .extend({
    kind: z.enum(['entrada', 'saida']),
    externalUserId: externalId,
    ticketId: externalId.max(100),
    observation: z.string().trim().max(2000).optional(),
  })
  .strict();
const createSchema = productSchema
  .omit({ id: true, locationId: true })
  .extend({ externalUserId: externalId })
  .strict();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
// A ordem das propriedades não altera o fingerprint. Valores são validados antes.
const canonical = (value: any): string =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
function enabled() {
  if (process.env.INTEGRATION_ENABLED !== 'true')
    throw new ServiceUnavailableException('Integração desabilitada');
}
@Injectable()
export class IntegrationGuard implements CanActivate {
  constructor(private readonly db: Database) {}
  async canActivate(context: ExecutionContext) {
    enabled();
    const req = context.switchToHttp().getRequest<Request>();
    const match = /^Bearer ([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(
      req.headers.authorization ?? '',
    );
    if (!match || !uuid.safeParse(match[1]).success)
      throw new UnauthorizedException('Credencial de integração inválida');
    const row = (
      await this.db.pool.query(
        'SELECT id,instance_id,scopes,token_hash FROM integration_clients WHERE id=$1 AND active AND expires_at>now()',
        [match[1]],
      )
    ).rows[0];
    if (
      !row ||
      !timingSafeEqual(
        Buffer.from(row.token_hash, 'hex'),
        Buffer.from(hash(match[2]), 'hex'),
      )
    )
      throw new UnauthorizedException('Credencial de integração inválida');
    const scope: string | undefined = Reflect.getMetadata(
      'integration:scope',
      context.getHandler(),
    );
    if (!scope || !row.scopes.includes(scope))
      throw new ForbiddenException('Permissão de integração insuficiente');
    req.integrationClient = {
      id: row.id,
      instance_id: row.instance_id,
      scopes: row.scopes,
      credentialHash: row.token_hash,
    };
    return true;
  }
}
@Injectable()
export class IntegrationService {
  constructor(
    private readonly db: Database,
    private readonly stock: StockService,
    private readonly products: ProductService,
  ) {}
  private async actor(
    c: PoolClient,
    client: Client,
    externalUserId: string,
    scope: string,
  ) {
    enabled();
    // Revogação/permissões e vínculo são reavaliados dentro da transação, após esperar pela chave.
    if (
      !(
        await c.query(
          'SELECT id FROM integration_clients WHERE id=$1 AND instance_id=$2 AND active AND expires_at>clock_timestamp() AND $3=ANY(scopes) AND token_hash=$4 FOR SHARE',
          [client.id, client.instance_id, scope, client.credentialHash],
        )
      ).rowCount
    )
      throw new UnauthorizedException('Credencial de integração inválida');
    const link = (
      await c.query(
        'SELECT employee_id FROM external_employee_links WHERE instance_id=$1 AND external_user_id=$2 AND active FOR SHARE',
        [client.instance_id, externalUserId],
      )
    ).rows[0];
    if (
      !link ||
      !(
        await c.query(
          'SELECT id FROM employees WHERE id=$1 AND active FOR SHARE',
          [link.employee_id],
        )
      ).rowCount
    )
      throw new ForbiddenException(
        'Usuário externo sem vínculo ativo com funcionário ativo',
      );
    return link.employee_id as string;
  }
  private async execute(
    client: Client,
    key: unknown,
    operation: 'movement' | 'product',
    data: any,
    work: (c: PoolClient, actor: string) => Promise<any>,
  ) {
    const idempotencyKey = validate(keySchema, key);
    const fingerprint = hash(canonical({ operation, data }));
    return this.db.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify([client.instance_id, idempotencyKey]),
      ]);
      const previous = (
        await c.query(
          'SELECT fingerprint,result FROM integration_operations WHERE instance_id=$1 AND idempotency_key=$2',
          [client.instance_id, idempotencyKey],
        )
      ).rows[0];
      // Mesmo identificador, conteúdo diferente: nunca executar ou sobrescrever.
      if (previous && previous.fingerprint !== fingerprint)
        throw new ConflictException(
          'Chave de idempotência já utilizada com conteúdo diferente',
        );
      const actor = await this.actor(
        c,
        client,
        data.externalUserId,
        operation === 'movement' ? 'movements:write' : 'products:write',
      );
      if (previous) return previous.result;
      const result = await work(c, actor);
      await c.query(
        'INSERT INTO integration_operations(instance_id,idempotency_key,operation,fingerprint,result,client_id,employee_id,external_user_id,ticket_id,movement_id,product_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
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
        ],
      );
      await audit(
        c,
        actor,
        'integracao_' + operation,
        'operacao_integracao',
        idempotencyKey,
        {
          instanceId: client.instance_id,
          clientId: client.id,
          externalUserId: data.externalUserId,
          ticketId: data.ticketId ?? null,
          resultId: result.id,
        },
      );
      return result;
    });
  }
  async move(client: Client, key: unknown, body: unknown) {
    const d = validate(moveSchema, body);
    d.quantity = formatQuantity(parseQuantity(d.quantity, 'unidade'));
    return this.execute(client, key, 'movement', d, async (c, actor) => {
      const m = await this.stock.move(
        actor,
        {
          productId: d.productId,
          kind: d.kind,
          quantity: d.quantity,
          eventDate: d.eventDate,
          reason: d.reason,
          ticket: d.ticketId,
          locationId: d.locationId,
          justification: d.observation,
        },
        c,
      );
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
  async productOptions() {return this.products.productOptions();}
  async matches(query: unknown) { return this.products.matches(query); }
  async search(query: unknown) {
    const q = validate(
      z.object({ ...pageFields, q: z.string().max(200).default(''),availability:z.enum(['all','positive']).default('all'),status:z.enum(['todos','ativo','inativo','abertura_pendente']).default('todos') }).strict(),
      query,
    );
    const r = await this.products.search(q, true);
    const distributions=r.items.length?(await this.db.pool.query(`SELECT m.product_id,a.id,a.code,a.name,a.active,SUM(l.delta)::text quantity FROM movements m JOIN ledger l ON l.movement_id=m.id JOIN locations a ON a.id=l.location_id WHERE m.product_id=ANY($1::uuid[]) GROUP BY m.product_id,a.id HAVING SUM(l.delta)>0 ORDER BY a.code,a.id`,[r.items.map(p=>p.id)])).rows:[];

    return {
      ...r,
      items: r.items.map((p) => ({
        id: p.id,
        description: p.description,
        unit: p.unit,
        active: p.active,
        legacyId: p.legacy_id?.toString() ?? null,
        quantity: p.quantity,
        openingDate: p.opening_date,
        locations:distributions.filter(l=>l.product_id===p.id).map(({product_id,...l})=>({...l,quantity:formatQuantity(BigInt(l.quantity))})),
      })),
    };
  }
  async balances(id: string) {
    validate(uuid, id);
    const p = (
      await this.db.pool.query(
        'SELECT id,unit,active,opening_date::text FROM products WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (!p) throw new NotFoundException('Produto não encontrado');
    const b = await this.stock.balances(id);
    const locations = (
      await this.db.pool.query(
        'SELECT id,code,name,active FROM locations WHERE id=ANY($1::uuid[])',
        [b.locations.map((l) => l.id)],
      )
    ).rows;
    const locationsById = new Map(locations.map((l) => [l.id, l]));
    return {
      productId: id,
      unit: p.unit,
      active: p.active,
      openingDate: p.opening_date,
      ...b,
      locations: b.locations.map((l) => ({
        ...l,
        ...locationsById.get(l.id),
      })),
    };
  }
  async locations(query: unknown, productId?: string) {
    const q = validate(
      z
        .object({
          ...pageFields,
          purpose: z.enum(['entrada', 'saida']).default('entrada'),
        })
        .strict(),
      query,
    );
    let rows: any[];
    if (productId) {
      const balances = await this.balances(productId);
      const all = (
        await this.db.pool.query(
          'SELECT id,code,name,active FROM locations WHERE active ORDER BY code,id',
        )
      ).rows;
      const balancesById = new Map(
        balances.locations.map((l) => [l.id, l.quantity]),
      );
      rows = all
        .map((l) => ({
          ...l,
          quantity: balancesById.get(l.id) ?? '0.000',
        }))
        .filter(
          (l) =>
            q.purpose === 'entrada' || BigInt(l.quantity.split('.')[0]) > 0n,
        );
    } else {
      if (q.purpose === 'saida')
        throw new BadRequestException(
          'Informe o produto para consultar disponibilidade',
        );
      rows = (
        await this.db.pool.query(
          'SELECT id,code,name,active FROM locations WHERE active ORDER BY code,id',
        )
      ).rows;
    }
    return {
      items: rows.slice((q.page - 1) * q.limit, q.page * q.limit),
      total: rows.length,
      page: q.page,
      limit: q.limit,
    };
  }
  async result(client: Client, key: string) {
    validate(keySchema, key);
    const r = (
      await this.db.pool.query(
        'SELECT operation,result,created_at FROM integration_operations WHERE instance_id=$1 AND idempotency_key=$2',
        [client.instance_id, key],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Operação não encontrada');
    return { idempotencyKey: key, instanceId: client.instance_id, ...r };
  }
  async history(client: Client, ticketId: string, query: unknown) {
    validate(externalId, ticketId);
    const q = validate(
      z
        .object({
          ...pageFields,
          flow: z
            .enum(['entrada', 'saida', 'realocacao', 'abertura'])
            .optional(),
        })
        .strict(),
      query,
    );
    return queryHistory(this.db, q, {
      instanceId: client.instance_id,
      ticketId,
    });
  }
}
@Controller('integration/v1')
@UseGuards(IntegrationGuard)
export class IntegrationController {
  constructor(private readonly service: IntegrationService) {}
  @SetMetadata('integration:scope', 'read')
  @Get('product-options')
  productOptions() {return this.service.productOptions();}
  @SetMetadata('integration:scope', 'read')
  @Get('product-matches')
  productMatches(@Query() q: unknown) {return this.service.matches(q);}
  @SetMetadata('integration:scope', 'read')
  @Get('products')
  products(@Query() q: unknown) {
    return this.service.search(q);
  }
  @SetMetadata('integration:scope', 'read')
  @Get('products/:id/balances')
  balances(@Param('id') id: string) {
    return this.service.balances(id);
  }
  @SetMetadata('integration:scope', 'read')
  @Get('locations')
  locations(@Query() q: unknown) {
    return this.service.locations(q);
  }
  @SetMetadata('integration:scope', 'read')
  @Get('products/:id/locations')
  productLocations(@Param('id') id: string, @Query() q: unknown) {
    return this.service.locations(q, id);
  }
  @SetMetadata('integration:scope', 'movements:write')
  @Post('movements')
  move(@Req() req: Request, @Body() body: unknown) {
    return this.service.move(
      req.integrationClient!,
      req.headers['idempotency-key'],
      body,
    );
  }
  @SetMetadata('integration:scope', 'products:write')
  @Post('products')
  create(@Req() req: Request, @Body() body: unknown) {
    return this.service.create(
      req.integrationClient!,
      req.headers['idempotency-key'],
      body,
    );
  }
  @SetMetadata('integration:scope', 'read')
  @Get('operations/:key')
  result(@Req() req: Request, @Param('key') key: string) {
    return this.service.result(req.integrationClient!, key);
  }
  @SetMetadata('integration:scope', 'read')
  @Get('tickets/:ticketId/movements')
  history(
    @Req() req: Request,
    @Param('ticketId') ticketId: string,
    @Query() q: unknown,
  ) {
    return this.service.history(req.integrationClient!, ticketId, q);
  }
}
