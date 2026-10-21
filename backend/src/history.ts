import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { Database } from './db';
import { formatQuantity } from './quantity';
import { uuid, validate } from './validation';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Data inválida',
  );
const schema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    flow: z
      .enum(['entrada', 'saida', 'realocacao', 'abertura'])
      .default('entrada'),
    regime: z.enum(['operacional', 'legado', 'todos']).default('todos'),
    q: z.string().trim().max(200).optional(),
    productId: uuid.optional(),
    categoryId: uuid.optional(),
    subcategoryId: uuid.optional(),
    locationId: uuid.optional(),
    dateFrom: date.optional(),
    dateTo: date.optional(),
    reason: z
      .enum([
        'chamado',
        'uso_interno',
        'rma',
        'outro',
        'correcao_estoque',
        'recebimento',
        'contagem_fisica',
        'saldo_legado',
        'legado_nao_informado',
      ])
      .optional(),
    employeeId: uuid.optional(),
    ticket: z.string().trim().max(100).optional(),
  })
  .strict();
// Normalização de consulta sem extensão PostgreSQL ou alteração dos dados persistidos.
const fold = (sql: string) =>
  `lower(translate(${sql},'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'))`;
const historySql = `
 SELECT m.id,m.product_id,m.kind,m.quantity::text,m.event_date,m.recorded_at,m.reason,m.ticket,
 m.justification AS observation,m.actor_id,e.name AS author,p.description,p.original_description,p.legacy_id::text AS product_code,p.unit,p.category_id,p.subcategory_id,
 'operacional'::text AS regime,NULL::text AS origin,NULL::text AS legacy_id,false AS date_estimated,NULL::text AS date_original,NULL::text AS conversion_rule,'confirmado'::text AS validation_status,false AS zero_evidence,
 m.reversal_of,undo.id AS reversed_by,original.kind AS original_kind,
 CASE WHEN m.kind='abertura' THEN 'abertura' WHEN m.kind='realocacao' OR (m.kind='estorno' AND original.kind='realocacao') THEN 'realocacao'
 WHEN m.kind IN ('entrada','ajuste_entrada') OR (m.kind='estorno' AND original.kind IN ('saida','ajuste_saida')) THEN 'entrada' ELSE 'saida' END AS flow,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'active',a.active,'delta',l.delta::text) ORDER BY a.code,a.id) FROM ledger l JOIN locations a ON a.id=l.location_id WHERE l.movement_id=m.id),'[]'::jsonb) AS locations
 FROM movements m JOIN products p ON p.id=m.product_id JOIN employees e ON e.id=m.actor_id LEFT JOIN movements original ON original.id=m.reversal_of LEFT JOIN movements undo ON undo.reversal_of=m.id
 UNION ALL
 SELECT m.id,m.product_id,m.kind,m.quantity::text,m.event_date,NULL::timestamptz,m.reason,m.ticket,m.observation,NULL::uuid,m.author_label,p.description,p.original_description,p.legacy_id::text,p.unit,p.category_id,p.subcategory_id,
 'legado',m.origin,m.legacy_id::text,m.date_estimated,m.date_original,m.conversion_rule,m.validation_status,m.zero_evidence,NULL::uuid,NULL::uuid,NULL::text,m.kind,
 jsonb_build_array(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'active',a.active,'delta',NULL))
 FROM legacy_movements m JOIN products p ON p.id=m.product_id JOIN locations a ON a.code='NAO_INFORMADA'
`;
export async function queryHistory(db: Database, query: unknown) {
  const q = validate(schema, query);
  if (q.dateFrom && q.dateTo && q.dateFrom > q.dateTo)
    throw new BadRequestException(
      'Data inicial deve ser anterior ou igual à final',
    );
  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return '$' + params.length;
  };
  const where = [`h.flow=${bind(q.flow)}`];
  if (q.regime !== 'todos') where.push(`h.regime=${bind(q.regime)}`);
  for (const [key, column] of [
    ['productId', 'product_id'],
    ['categoryId', 'category_id'],
    ['subcategoryId', 'subcategory_id'],
    ['employeeId', 'actor_id'],
  ] as const)
    if (q[key]) where.push(`h.${column}=${bind(q[key])}::uuid`);
  if (q.locationId)
    where.push(
      `EXISTS(SELECT 1 FROM jsonb_array_elements(h.locations) a WHERE a->>'id'=${bind(q.locationId)})`,
    );
  if (q.dateFrom) where.push(`h.event_date>=${bind(q.dateFrom)}::date`);
  if (q.dateTo) where.push(`h.event_date<=${bind(q.dateTo)}::date`);
  if (q.reason) where.push(`h.reason=${bind(q.reason)}`);
  if (q.ticket)
    where.push(
      `strpos(lower(COALESCE(h.ticket,'')),lower(${bind(q.ticket)}))>0`,
    );
  if (q.q) {
    const normalized = q.q
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    where.push(
      `strpos(${fold("COALESCE(h.description,'')||' '||COALESCE(h.original_description,'')||' '||COALESCE(h.product_code,'')||' '||h.product_id::text")},${bind(normalized)})>0`,
    );
  }
  const limit = bind(q.limit),
    offset = bind((q.page - 1) * q.limit);
  const result = (
    await db.pool.query(
      `WITH history AS (${historySql}), filtered AS (SELECT * FROM history h WHERE ${where.join(' AND ')}), page AS (SELECT * FROM filtered ORDER BY event_date DESC,id DESC LIMIT ${limit} OFFSET ${offset}) SELECT (SELECT COUNT(*)::text FROM filtered) AS total,COALESCE(jsonb_agg(to_jsonb(page) ORDER BY event_date DESC,id DESC),'[]'::jsonb) AS items FROM page`,
      params,
    )
  ).rows[0];
  return {
    items: result.items.map((r: any) => ({
      ...r,
      quantity: formatQuantity(BigInt(r.quantity)),
      locations: r.locations.map((l: any) => ({
        ...l,
        delta: l.delta === null ? null : formatQuantity(BigInt(l.delta)),
      })),
    })),
    total: Number(result.total),
    page: q.page,
    limit: q.limit,
  };
}
