import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { Database, audit } from '../db';
import { ProductService } from '../products';
import { pageFields, uuid, validate } from '../validation';
import { foldSql, foldText } from '../search';
import { InvoiceStorage } from './storage';
const name = z.string().trim().min(1).max(200).refine(v => !/[\x00-\x1f\x7f]/.test(v), 'Identificação inválida');
export const invoiceInput = z.object({ name, productId: uuid.nullable().default(null), confirmInactive: z.boolean().default(false) }).strict();
const select = `SELECT d.id,d.name,d.original_name AS "originalName",d.byte_size AS size,d.mime_type AS "mimeType",d.checksum,d.uploaded_at AS "uploadedAt",
 jsonb_build_object('id',e.id,'name',e.name) AS "uploadedBy",
 CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'description',p.description,'active',p.active,'legacyId',p.legacy_id::text) END AS product
 FROM invoice_documents d JOIN employees e ON e.id=d.uploaded_by LEFT JOIN invoice_product_links l ON l.document_id=d.id LEFT JOIN products p ON p.id=l.product_id`;
@Injectable()
export class InvoiceService {
    constructor(private readonly db: Database, private readonly storage: InvoiceStorage, private readonly products: ProductService) { }
    private async actor(c: PoolClient, id: string, version: string | undefined) { if (!(await c.query('SELECT id FROM employees WHERE id=$1 AND active AND session_version::text=$2 FOR SHARE', [id, version ?? null])).rowCount)
        throw new ForbiddenException('Sessão revogada ou funcionário inativo. Entre novamente.'); }
    private async product(c: PoolClient, id: string | null, confirm: boolean) {
        if (!id)
            return;
        const p = (await c.query('SELECT id,active FROM products WHERE id=$1 FOR SHARE', [id])).rows[0];
        if (!p)
            throw new NotFoundException('Produto não encontrado.');
        if (!p.active && !confirm)
            throw new ConflictException('Produto inativo: confirme que este é o cadastro correto.');
    }
    async productOptions(query: unknown) {
        const q = validate(z.object({ ...pageFields, q: z.string().max(200).default('') }).strict(), query);
        const r = await this.products.search({ ...q, status: 'todos', availability: 'all' }, true);
        return { ...r, items: r.items.map(p => ({ id: p.id, description: p.description, active: p.active, legacyId: p.legacy_id?.toString() ?? null })) };
    }
    async productOption(id: string) { validate(uuid, id); const p = (await this.db.pool.query('SELECT id,description,active,legacy_id::text AS "legacyId" FROM products WHERE id=$1', [id])).rows[0]; if (!p)
        throw new NotFoundException('Produto não encontrado.'); return p; }
    async list(query: unknown) {
        const q = validate(z.object({ ...pageFields, q: z.string().trim().max(200).default(''), link: z.enum(['all', 'loose', 'linked']).default('all'), productId: uuid.optional() }).strict(), query);
        const where = `($1='' OR strpos(${foldSql("d.name||' '||d.original_name||' '||d.id::text")},$1)>0) AND ($2='all' OR ($2='loose' AND l.product_id IS NULL) OR ($2='linked' AND l.product_id IS NOT NULL)) AND ($3::uuid IS NULL OR l.product_id=$3)`;
        const r = (await this.db.pool.query(`WITH filtered AS (${select} WHERE ${where}), page AS (SELECT * FROM filtered ORDER BY "uploadedAt" DESC,id DESC LIMIT $4 OFFSET $5) SELECT (SELECT count(*)::int FROM filtered) total,COALESCE(jsonb_agg(to_jsonb(page) ORDER BY "uploadedAt" DESC,id DESC),'[]'::jsonb) items FROM page`, [foldText(q.q), q.link, q.productId ?? null, q.limit, (q.page - 1) * q.limit])).rows[0];
        return { ...r, page: q.page, limit: q.limit };
    }
    async get(id: string, c: Pick<PoolClient, 'query'> = this.db.pool) { validate(uuid, id); const d = (await c.query(select + ' WHERE d.id=$1', [id])).rows[0]; if (!d)
        throw new NotFoundException('Nota fiscal não encontrada.'); return d; }
    async upload(actor: string, input: unknown, originalName: string, stream: Readable, version: string | undefined) {
        const data = validate(invoiceInput, input);
        if (!originalName || originalName.length > 255 || /[\/\\\x00-\x1f\x7f]/.test(originalName) || !originalName.toLowerCase().endsWith('.pdf'))
            throw new BadRequestException('Selecione um arquivo com extensão PDF e nome válido.');
        const stage = await this.storage.stage(stream);
        try {
            return await this.db.transaction(async (c) => {
                await this.actor(c, actor, version);
                await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['invoice:' + stage.checksum]);
                const existing = (await c.query('SELECT id FROM invoice_documents WHERE checksum=$1', [stage.checksum])).rows[0];
                if (existing)
                    throw new ConflictException({ message: 'Este PDF já está cadastrado. Abra a nota existente ou revise seu vínculo.', code: 'INVOICE_DUPLICATE', documentId: existing.id });
                await this.product(c, data.productId, data.confirmInactive);
                const id = randomUUID(), key = id + '.pdf';
                await this.storage.publish(stage, key);
                await c.query('INSERT INTO invoice_documents(id,name,original_name,storage_key,mime_type,byte_size,checksum,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, data.name, originalName, key, 'application/pdf', stage.size, stage.checksum, actor]);
                if (data.productId)
                    await c.query('INSERT INTO invoice_product_links(document_id,product_id) VALUES($1,$2)', [id, data.productId]);
                await audit(c, actor, 'anexar_nota', 'nota_fiscal', id, { after: { name: data.name, productId: data.productId }, checksum: stage.checksum });
                return this.get(id, c);
            });
        }
        finally {
            await this.storage.discard(stage.temp);
        }
    }
    async update(actor: string, id: string, input: unknown, version: string | undefined) {
        validate(uuid, id);
        const d = validate(invoiceInput, input);
        return this.db.transaction(async (c) => {
            await this.actor(c, actor, version);
            if (!(await c.query('SELECT id FROM invoice_documents WHERE id=$1 FOR UPDATE', [id])).rowCount)
                throw new NotFoundException('Nota fiscal não encontrada.');
            const before = await this.get(id, c);
            await this.product(c, d.productId, d.confirmInactive || before.product?.id === d.productId);
            await c.query('UPDATE invoice_documents SET name=$2 WHERE id=$1', [id, d.name]);
            await c.query('DELETE FROM invoice_product_links WHERE document_id=$1', [id]);
            if (d.productId)
                await c.query('INSERT INTO invoice_product_links(document_id,product_id) VALUES($1,$2)', [id, d.productId]);
            await audit(c, actor, 'editar_nota', 'nota_fiscal', id, { before: { name: before.name, productId: before.product?.id ?? null }, after: { name: d.name, productId: d.productId } });
            return this.get(id, c);
        });
    }
    async file(id: string) {
        validate(uuid, id);
        const d = (await this.db.pool.query('SELECT storage_key,byte_size,checksum FROM invoice_documents WHERE id=$1', [id])).rows[0];
        if (!d)
            throw new NotFoundException('Nota fiscal não encontrada.');
        const file = await this.storage.verified(d.storage_key, d.byte_size, d.checksum);
        return { file, size: d.byte_size };
    }
}
