import { BadRequestException, Injectable, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, unlink, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Readable } from 'node:stream';
export const PDF_LIMIT = 20 * 1024 * 1024;
export type StagedPdf = {
    temp: string;
    size: number;
    checksum: string;
};
@Injectable()
export class InvoiceStorage {
    readonly directory = resolve(process.env.INVOICE_STORAGE_DIR || 'var/invoices');
    private key(key: string) { if (!/^[0-9a-f-]{36}\.pdf$/.test(key))
        throw new Error('Invalid storage key'); return join(this.directory, key); }
    async stage(stream: Readable): Promise<StagedPdf> {
        let temp = '';
        let file: Awaited<ReturnType<typeof open>> | undefined;
        try {
            await mkdir(this.directory, { recursive: true, mode: 0o700 });
            temp = join(this.directory, '.upload-' + randomUUID());
            file = await open(temp, 'wx+', 0o600);
            const hash = createHash('sha256');
            let size = 0, header = Buffer.alloc(0), tail = Buffer.alloc(0);
            // Não destruir socket antes da resposta413; o controller drena o restante sem armazená-lo.
            for await (const raw of stream.iterator({ destroyOnReturn: false })) {
                const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
                size += chunk.length;
                if (size > PDF_LIMIT)
                    throw new PayloadTooLargeException('PDF excede o limite de 20 MiB.');
                if (header.length < 16)
                    header = Buffer.concat([header, chunk.subarray(0, 16 - header.length)]);
                tail = Buffer.concat([tail, chunk]).subarray(-4096);
                hash.update(chunk);
                let written = 0;
                while (written < chunk.length) {
                    const r = await file.write(chunk, written, chunk.length - written);
                    if (!r.bytesWritten)
                        throw new Error('Write incomplete');
                    written += r.bytesWritten;
                }
            }
            if (!size)
                throw new BadRequestException('O arquivo PDF está vazio.');
            const end = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail.toString('latin1'));
            if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(header.toString('latin1')) || !end)
                throw new BadRequestException('Arquivo PDF inválido ou incompleto.');
            const offset = Number(end[1]);
            if (!Number.isSafeInteger(offset) || offset < 8 || offset >= size)
                throw new BadRequestException('Estrutura do PDF inválida.');
            const target = Buffer.alloc(Math.min(8192, size - offset));
            await file.read(target, 0, target.length, offset);
            const text = target.toString('latin1');
            if (!/^xref\s/.test(text) && !/^\d+\s+\d+\s+obj\s*<<[\s\S]*?\/Type\s*\/XRef\b/.test(text))
                throw new BadRequestException('Estrutura do PDF inválida.');
            await file.sync();
            await file.close();
            file = undefined;
            return { temp, size, checksum: hash.digest('hex') };
        }
        catch (error) {
            await file?.close().catch(() => { });
            if (temp)
                await this.discard(temp);
            if (error instanceof BadRequestException || error instanceof PayloadTooLargeException)
                throw error;
            if (stream.readableAborted)
                throw new BadRequestException('Envio interrompido. Confira a lista antes de enviar novamente.');
            throw new ServiceUnavailableException('Não foi possível gravar o PDF. Tente novamente mais tarde.');
        }
    }
    async discard(temp: string) {
        // Apenas o temporário criado por esta requisição; nunca recebe caminho do cliente.
        if (resolve(temp).startsWith(this.directory + require('node:path').sep + '.upload-'))
            await unlink(temp).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT')
                console.error(JSON.stringify({ operation: 'invoice_storage', phase: 'temp_cleanup' })); });
    }
    async publish(stage: StagedPdf, key: string) {
        const { link } = await import('node:fs/promises');
        try {
            await link(stage.temp, this.key(key));
            if (process.platform !== 'win32') {
                const directory = await open(this.directory, 'r');
                try {
                    await directory.sync();
                }
                finally {
                    await directory.close();
                }
            }
        }
        catch {
            throw new ServiceUnavailableException('Não foi possível armazenar o PDF.');
        }
        // Arquivo final jamais removido em erro de COMMIT: pode haver confirmação perdida.
    }
    async verified(key: string, size: number, checksum: string) {
        let file: Awaited<ReturnType<typeof open>> | undefined;
        try {
            file = await open(this.key(key), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            const stat = await file.stat();
            if (!stat.isFile() || stat.size !== size)
                throw new Error('size');
            const hash = createHash('sha256');
            for await (const chunk of file.createReadStream({ autoClose: false, start: 0 }))
                hash.update(chunk);
            if (hash.digest('hex') !== checksum)
                throw new Error('checksum');
            return file;
        }
        catch {
            await file?.close().catch(() => { });
            throw new ServiceUnavailableException('Documento indisponível ou com integridade divergente. Solicite verificação ao administrador.');
        }
    }
    async entries() { try {
        return await readdir(this.directory);
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return [];
        throw e;
    } }
}
