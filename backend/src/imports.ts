import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { visit } from 'jsonc-parser';
import type { Request } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { SessionGuard } from './auth';
import { Database, audit } from './db';
import { parseQuantity, formatQuantity } from './quantity';
import { eventDate, uuid, validate } from './validation';
const SOURCE = 'graal-estoque';
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nullableText = z.string().max(4000).nullable().optional();
const productSchema = z.object({
  id,
  descricao: nullableText,
  categoria: z.string().min(1).max(200),
  subcategoria: nullableText,
  unidade: z.literal('unidade'),
  ativo: z.boolean(),
});
const movementSchema = z.object({
  id,
  tipo: z.enum(['entrada', 'saida']),
  produto_id: id,
  data: eventDate,
  quantidade: z.number().finite().min(0).max(9e12),
  chamado: nullableText,
  motivo: z
    .enum(['chamado', 'uso_interno', 'rma', 'outro', 'correcao_estoque'])
    .nullable()
    .optional(),
  observacao: nullableText,
  data_estimada: z.boolean(),
  origem: nullableText,
});
const schema = z.object({
  categorias: z.array(z.object({ nome: z.string().min(1).max(200) })).max(1000),
  produtos: z.array(productSchema).max(10000),
  movimentacoes: z.array(movementSchema).max(100000),
  revisar: z
    .object({ itens: z.array(z.record(z.string(), z.unknown())).max(10000) })
    .optional(),
});
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function parseLegacy(content: string) {
  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content) > 8 * 1024 * 1024
  )
    throw new BadRequestException('Arquivo excede 8 MiB');
  const document =
    content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  let invalid = false;
  let property = '';
  const objects: Set<string>[] = [];
  visit(
    document,
    {
      onObjectBegin: () => {
        objects.push(new Set());
      },
      onObjectProperty: (name) => {
        property = name;
        const set = objects.at(-1)!;
        if (set.has(name)) invalid = true;
        set.add(name);
      },
      onObjectEnd: () => {
        objects.pop();
      },
      onLiteralValue: (value, offset, length) => {
        if (
          property === 'quantidade' &&
          typeof value === 'number' &&
          !/^(0|[1-9]\d{0,12})(\.\d{1,3})?$/.test(
            document.slice(offset, offset + length),
          )
        )
          invalid = true;
      },
      onError: () => {
        invalid = true;
      },
    },
    { allowTrailingComma: false, disallowComments: true },
  );
  if (invalid)
    throw new BadRequestException('JSON inválido ou com chaves repetidas');
  let raw: unknown;
  try {
    raw = JSON.parse(document);
  } catch {
    throw new BadRequestException('JSON inválido');
  }
  const data = validate(schema, raw);
  const categories = data.categorias.map((c) => c.nome);
  if (new Set(categories).size !== categories.length)
    throw new BadRequestException('Categoria repetida');
  const products = data.produtos.map((p) => ({
    legacyId: p.id,
    description: p.descricao ?? '',
    originalDescription: p.descricao ?? null,
    category: p.categoria,
    subcategory: p.subcategoria ?? null,
    unit: p.unidade,
    active: p.ativo,
  }));
  const productMap = new Map(products.map((p) => [p.legacyId, p]));
  if (productMap.size !== products.length)
    throw new BadRequestException('ID legado de produto repetido');
  for (const p of products)
    if (!categories.includes(p.category))
      throw new BadRequestException('Categoria sem referência');
  const pending: any[] = [];
  const dateNotes = new Map<string, any>();
  for (const item of data.revisar?.itens ?? []) {
    if (
      ![
        'produto_descricao_invalida',
        'data_ajustada',
        'data_suspeita',
      ].includes(String(item.tipo))
    ) {
      pending.push({
        type: 'metadado_nao_suportado',
        status: 'pendente_validacao',
      });
      continue;
    }
    const isDate = ['data_ajustada', 'data_suspeita'].includes(
      String(item.tipo),
    );
    // Projeção explícita: nunca copiar objetos arbitrários ou valores financeiros.
    const note = {
      type:
        typeof item.tipo === 'string'
          ? item.tipo.slice(0, 100)
          : 'pendencia_legada',
      productId: typeof item.produto_id === 'number' ? item.produto_id : null,
      origin:
        typeof item.origem === 'string' ? item.origem.slice(0, 1000) : null,
      original:
        isDate &&
        (typeof item.valor_original === 'string' ||
          typeof item.valor_original === 'number')
          ? String(item.valor_original).slice(0, 2000)
          : null,
      rule:
        isDate && typeof item.nota === 'string'
          ? item.nota.slice(0, 2000)
          : null,
      status: 'pendente_validacao',
    };
    pending.push(note);
    if (isDate && note.origin)
      dateNotes.set(note.origin + ':' + note.productId, note);
  }
  const movements = data.movimentacoes.map((m) => {
    const product = productMap.get(m.produto_id);
    if (!product) throw new BadRequestException('Movimento com produto órfão');
    const quantity =
      m.quantidade === 0
        ? 0n
        : parseQuantity(String(m.quantidade), product.unit);
    const dateNote = dateNotes.get((m.origem ?? '') + ':' + m.produto_id);
    if (!m.motivo)
      pending.push({
        type: 'motivo_ausente',
        movementId: m.id,
        status: 'pendente_validacao',
      });
    if (quantity === 0n)
      pending.push({
        type: 'quantidade_zero',
        movementId: m.id,
        status: 'evidencia_legada',
      });
    if (m.data_estimada)
      pending.push({
        type: 'data_estimada',
        movementId: m.id,
        status: 'pendente_validacao',
      });
    return {
      legacyId: m.id,
      productLegacyId: m.produto_id,
      kind: m.tipo,
      quantity: quantity.toString(),
      eventDate: m.data,
      ticket: m.chamado ?? null,
      reason: m.motivo ?? 'legado_nao_informado',
      observation: m.observacao ?? null,
      origin: m.origem ?? null,
      dateEstimated: m.data_estimada,
      dateOriginal: dateNote?.original ?? null,
      conversionRule: dateNote?.rule ?? null,
      validationStatus: 'pendente_validacao',
      zeroEvidence: quantity === 0n,
    };
  });
  if (new Set(movements.map((m) => m.legacyId)).size !== movements.length)
    throw new BadRequestException('ID legado de movimento repetido');
  for (const p of products)
    if (!p.description.trim() || p.description.trim().length < 2)
      pending.push({
        type: 'descricao_a_validar',
        productId: p.legacyId,
        status: 'pendente_validacao',
      });
  const totalByProduct = new Map<number, bigint>();
  const dayDeltas = new Map<number, Map<string, bigint>>();
  for (const m of movements) {
    const delta = BigInt(m.quantity) * (m.kind === 'saida' ? -1n : 1n);
    totalByProduct.set(
      m.productLegacyId,
      (totalByProduct.get(m.productLegacyId) ?? 0n) + delta,
    );
    const days = dayDeltas.get(m.productLegacyId) ?? new Map();
    days.set(m.eventDate, (days.get(m.eventDate) ?? 0n) + delta);
    dayDeltas.set(m.productLegacyId, days);
  }
  const historicalNegative: number[] = [];
  for (const [pid, days] of dayDeltas) {
    let balance = 0n;
    for (const [, delta] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
      balance += delta;
      if (balance < 0n && !historicalNegative.includes(pid))
        historicalNegative.push(pid);
    }
  }
  for (const pid of historicalNegative)
    pending.push({
      type: 'fechamento_historico_negativo',
      productId: pid,
      status: 'pendente_validacao',
    });
  const totals: { [unit: string]: bigint } = { unidade: 0n };
  const balances = products.map((p) => {
    const q = totalByProduct.get(p.legacyId) ?? 0n;
    totals[p.unit] += q;
    if (q < 0n)
      pending.push({
        type: 'saldo_final_negativo',
        productId: p.legacyId,
        status: 'pendente_validacao',
      });
    return {
      legacyId: p.legacyId,
      description: p.description,
      unit: p.unit,
      quantity: formatQuantity(q),
    };
  });
  const duplicates = (
    items: any[],
    key: (item: any) => string,
    type: string,
  ) => {
    const map = new Map<string, number[]>();
    for (const item of items) {
      const k = key(item);
      map.set(k, [...(map.get(k) ?? []), item.legacyId]);
    }
    for (const ids of map.values())
      if (ids.length > 1)
        pending.push({
          type,
          ids,
          status: 'candidato_a_validacao_nao_comprova_duplicidade',
        });
  };
  duplicates(products, (p) => p.description, 'possivel_duplicata_produto');
  duplicates(
    movements,
    (m) =>
      JSON.stringify([
        m.kind,
        m.productLegacyId,
        m.quantity,
        m.eventDate,
        m.reason,
        m.ticket,
        m.observation,
      ]),
    'possivel_duplicata_movimento',
  );
  const summary = {
    counts: {
      products: products.length,
      categories: categories.length,
      movements: movements.length,
      entries: movements.filter((m) => m.kind === 'entrada').length,
      exits: movements.filter((m) => m.kind === 'saida').length,
      zeroEvidence: movements.filter((m) => m.zeroEvidence).length,
      historicalNegative: historicalNegative.length,
    },
    errors: [],
    pending,
    balances,
    unitTotals: Object.fromEntries(
      Object.entries(totals).map(([unit, q]) => [unit, formatQuantity(q)]),
    ),
    openingStatus: 'abertura_pelo_saldo_legado',
    notice:
      'Ao confirmar, cada produto abre com o saldo legado (entradas − saídas) em localização não informada; saldos negativos abrem zerados. Pendências continuam segregadas.',
  };
  return { payload: { categories, products, movements }, summary };
}
@Injectable()
export class ImportService {
  constructor(private readonly db: Database) {}
  async preview(actor: string, content: string) {
    const parsed = parseLegacy(content);
    const checksum = createHash('sha256').update(content, 'utf8').digest('hex');
    return this.db.transaction(async (c) => {
      const r = (
        await c.query(
          'INSERT INTO import_batches(source,checksum,created_by,payload,preview) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source,checksum) DO UPDATE SET checksum=EXCLUDED.checksum RETURNING id,checksum,confirmed_at,preview,payload',
          [
            SOURCE,
            checksum,
            actor,
            JSON.stringify(parsed.payload),
            JSON.stringify(parsed.summary),
          ],
        )
      ).rows[0];
      r.preview = {
        ...r.preview,
        // A impressão existente foi calculada sobre a representação JSONB persistida.
        report: await this.report(c, r.payload),
      };
      await c.query('UPDATE import_batches SET preview=$2 WHERE id=$1', [
        r.id,
        JSON.stringify(r.preview),
      ]);
      delete r.payload;
      await audit(c, actor, 'prever_importacao', 'lote', r.id, {
        checksum,
        counts: parsed.summary.counts,
      });
      return r;
    });
  }
  private async report(c: PoolClient, payload: any) {
    const known = new Map(
      (
        await c.query(
          'SELECT entity,legacy_id,fingerprint FROM source_records WHERE source=$1',
          [SOURCE],
        )
      ).rows.map((r) => [r.entity + ':' + r.legacy_id, r.fingerprint]),
    );
    const issues: { entity: string; legacyId: number; reason: string }[] = [];
    const count = (entity: string, rows: any[]) => {
      const result = {
        processed: rows.length,
        planned: 0,
        imported: 0,
        existing: 0,
        conflicting: 0,
      };
      for (const row of rows) {
        const hash = known.get(entity + ':' + row.legacyId);
        if (!hash) result.planned++;
        else if (hash === fingerprint(row)) result.existing++;
        else {
          result.conflicting++;
          issues.push({
            entity,
            legacyId: row.legacyId,
            reason:
              'ID legado com conteúdo divergente; confirmação integral será bloqueada',
          });
        }
      }
      return result;
    };
    const products = count('produto', payload.products);
    const movements = {
      ...count('movimentacao', payload.movements),
      entries: payload.movements.filter((m: any) => m.kind === 'entrada')
        .length,
      exits: payload.movements.filter((m: any) => m.kind === 'saida').length,
      zeroEvidence: payload.movements.filter((m: any) => m.zeroEvidence).length,
    };
    for (const m of payload.movements)
      if (m.zeroEvidence)
        issues.push({
          entity: 'movimentacao',
          legacyId: m.legacyId,
          reason:
            'Quantidade zero: preservada como evidência legada segregada, sem saldo operacional',
        });
    return { products, movements, issues };
  }
  private async register(
    c: PoolClient,
    entity: string,
    id: string,
    value: unknown,
  ) {
    const hash = fingerprint(value);
    const result = await c.query(
      'INSERT INTO source_records(source,entity,legacy_id,fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING fingerprint',
      [SOURCE, entity, id, hash],
    );
    if (result.rowCount) return true;
    const existing = (
      await c.query(
        'SELECT fingerprint FROM source_records WHERE source=$1 AND entity=$2 AND legacy_id=$3',
        [SOURCE, entity, id],
      )
    ).rows[0];
    if (existing.fingerprint !== hash)
      throw new ConflictException(
        'ID legado conflitante: ' + entity + ' ' + id,
      );
    return false;
  }
  /** Abre os produtos legados pendentes com o saldo líquido do histórico; o legado segue fora do ledger, sem dupla contagem. */
  async openFromLegacy(c: PoolClient, actor: string) {
    await c.query('SELECT pg_advisory_xact_lock(742107)');
    // Só abre o que o UPDATE realmente travou como pendente; contagens concorrentes prevalecem.
    return (
      await c.query(
        `WITH cutoff AS (SELECT COALESCE(MAX(event_date),(now() AT TIME ZONE 'America/Sao_Paulo')::date) d FROM legacy_movements),
 totals AS (SELECT p.id,COALESCE(SUM(CASE lm.kind WHEN 'saida' THEN -lm.quantity ELSE lm.quantity END),0) q FROM products p LEFT JOIN legacy_movements lm ON lm.product_id=p.id WHERE p.source=$2 AND p.opening_date IS NULL GROUP BY p.id),
 opened AS (UPDATE products p SET opening_date=(SELECT d FROM cutoff) FROM totals t WHERE p.id=t.id AND p.opening_date IS NULL RETURNING p.id,t.q),
 moved AS (INSERT INTO movements(product_id,kind,quantity,event_date,actor_id,reason,justification) SELECT id,'abertura',q,(SELECT d FROM cutoff),$1,'saldo_legado','Saldo líquido do histórico importado (entradas − saídas)' FROM opened WHERE q>0 RETURNING id,quantity),
 placed AS (INSERT INTO ledger(movement_id,location_id,delta) SELECT id,'00000000-0000-0000-0000-000000000001',quantity FROM moved)
 SELECT COUNT(*)::int products,COUNT(*) FILTER(WHERE q>0)::int "withBalance",COUNT(*) FILTER(WHERE q<0)::int "negativeOpenedAtZero" FROM opened`,
        [actor, SOURCE],
      )
    ).rows[0];
  }
  async openLegacyBalances(actor: string) {
    return this.db.transaction(async (c) => {
      const result = await this.openFromLegacy(c, actor);
      await audit(c, actor, 'abrir_saldo_legado', 'produto', SOURCE, result);
      return result;
    });
  }
  async confirm(actor: string, id: string, acknowledgePending: boolean) {
    validate(uuid, id);
    if (acknowledgePending !== true)
      throw new BadRequestException(
        'Confirme ciência das pendências; a abertura continuará pendente',
      );
    return this.db.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(742107)');
      const batch = (
        await c.query('SELECT * FROM import_batches WHERE id=$1 FOR UPDATE', [
          id,
        ])
      ).rows[0];
      if (!batch) throw new BadRequestException('Lote não encontrado');
      const payload = batch.payload;
      const result = await this.report(c, payload);
      if (batch.confirmed_at) return { id, repeated: true, result };
      for (const name of payload.categories)
        await c.query(
          'INSERT INTO categories(name) VALUES($1) ON CONFLICT(name) DO NOTHING',
          [name],
        );
      const products = new Map<number, string>();
      for (const p of payload.products) {
        if (await this.register(c, 'produto', String(p.legacyId), p)) {
          result.products.imported++;
          const category = (
            await c.query('SELECT id FROM categories WHERE name=$1', [
              p.category,
            ])
          ).rows[0].id;
          let subcategory = null;
          if (p.subcategory)
            subcategory = (
              await c.query(
                'INSERT INTO subcategories(category_id,name) VALUES($1,$2) ON CONFLICT(category_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id',
                [category, p.subcategory],
              )
            ).rows[0].id;
          await c.query(
            'INSERT INTO products(source,legacy_id,description,original_description,category_id,subcategory_id,unit,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              SOURCE,
              p.legacyId,
              p.description,
              p.originalDescription,
              category,
              subcategory,
              p.unit,
              p.active,
            ],
          );
        }
        products.set(
          p.legacyId,
          (
            await c.query(
              'SELECT id FROM products WHERE source=$1 AND legacy_id=$2',
              [SOURCE, p.legacyId],
            )
          ).rows[0].id,
        );
      }
      for (const m of payload.movements)
        if (await this.register(c, 'movimentacao', String(m.legacyId), m)) {
          result.movements.imported++;
          await c.query(
            `INSERT INTO legacy_movements(batch_id,source,legacy_id,product_id,kind,quantity,event_date,reason,ticket,origin,observation,date_estimated,date_original,conversion_rule,validation_status,zero_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
              id,
              SOURCE,
              m.legacyId,
              products.get(m.productLegacyId),
              m.kind,
              m.quantity,
              m.eventDate,
              m.reason,
              m.ticket,
              m.origin,
              m.observation,
              m.dateEstimated,
              m.dateOriginal,
              m.conversionRule,
              m.validationStatus,
              m.zeroEvidence,
            ],
          );
        }
      result.products.planned = 0;
      result.movements.planned = 0;
      await c.query(
        'UPDATE import_batches SET confirmed_at=now(),confirmed_by=$2,preview=$3 WHERE id=$1',
        [id, actor, JSON.stringify({ ...batch.preview, result })],
      );
      await audit(c, actor, 'confirmar_importacao_legada', 'lote', id, {
        checksum: batch.checksum,
        counts: batch.preview.counts,
        pendingAcknowledged: true,
      });
      return {
        id,
        repeated: false,
        result,
        opening: await this.openFromLegacy(c, actor),
      };
    });
  }
}
@Controller('imports')
@UseGuards(SessionGuard)
export class ImportController {
  constructor(
    private readonly imports: ImportService,
    private readonly db: Database,
  ) {}
  @Get() async list() {
    return (
      await this.db.pool.query(
        'SELECT id,source,checksum,created_at,confirmed_at,preview FROM import_batches ORDER BY created_at DESC LIMIT 20',
      )
    ).rows;
  }
  @Post('preview') preview(@Req() req: Request, @Body() body: unknown) {
    const d = validate(
      z.object({ content: z.string().max(8 * 1024 * 1024) }).strict(),
      body,
    );
    return this.imports.preview(req.employee!.id, d.content);
  }
  @Post('open-legacy-balances') openLegacy(@Req() req: Request) {
    return this.imports.openLegacyBalances(req.employee!.id);
  }
  @Post(':id/confirm') confirm(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const d = validate(
      z.object({ acknowledgePending: z.literal(true) }).strict(),
      body,
    );
    return this.imports.confirm(req.employee!.id, id, d.acknowledgePending);
  }
}
