import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { SessionGuard } from '../auth';
import { validate } from '../validation';
import { InvoiceService } from './service';
const header = (req: Request, key: string) => { try {
    const v = req.headers[key];
    if (typeof v !== 'string')
        throw new Error();
    return decodeURIComponent(v);
}
catch {
    throw new BadRequestException('Metadados do PDF inválidos.');
} };
@Controller('invoices')
@UseGuards(SessionGuard)
export class InvoiceController {
    constructor(private readonly service: InvoiceService) { }
    @Get('products')
    products(
    @Query()
    q: unknown) { return this.service.productOptions(q); }
    @Get('products/:id')
    product(
    @Param('id')
    id: string) { return this.service.productOption(id); }
    @Get()
    list(
    @Query()
    q: unknown) { return this.service.list(q); }
    @Get(':id')
    get(
    @Param('id')
    id: string) { return this.service.get(id); }
    @Post()
    async upload(
    @Req()
    req: Request) {
        try {
            if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/pdf')
                throw new BadRequestException('Envie somente arquivos PDF.');
            const confirm = req.headers['x-confirm-inactive'];
            if (confirm !== undefined && confirm !== 'true' && confirm !== 'false')
                throw new BadRequestException('Confirmação inválida.');
            return await this.service.upload(req.employee!.id, { name: header(req, 'x-invoice-name'), productId: header(req, 'x-product-id') || null, confirmInactive: confirm === 'true' }, header(req, 'x-file-name'), req, req.session.employeeVersion);
        }
        catch (e) {
            // Drenar no máximo1MiB restante sem armazenar evita reset prematuro em rejeições próximas ao limite.
            let remaining = 1024 * 1024;
            try {
                if (!req.readableEnded && !req.destroyed) {
                    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
                        remaining -= chunk.length;
                        if (remaining < 0)
                            break;
                    }
                }
            }
            catch { }
            req.resume();
            throw e;
        }
    }
    @Post(':id')
    update(
    @Req()
    req: Request, 
    @Param('id')
    id: string, 
    @Body()
    body: unknown) { return this.service.update(req.employee!.id, id, body, req.session.employeeVersion); }
    @Get(':id/file')
    async file(
    @Param('id')
    id: string, 
    @Query()
    query: unknown, 
    @Res({ passthrough: true })
    res: Response) {
        const q = validate(z.object({ download: z.enum(['true', 'false']).default('false') }).strict(), query);
        const { file, size } = await this.service.file(id);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', size);
        res.setHeader('Content-Disposition', (q.download === 'true' ? 'attachment' : 'inline') + '; filename="nota-fiscal-' + id + '.pdf"');
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'self'");
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Accept-Ranges', 'none');
        return new StreamableFile(file.createReadStream({ start: 0 }));
    }
}
