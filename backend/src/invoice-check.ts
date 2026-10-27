import { Database } from './db';
import { InvoiceStorage } from './invoices/storage';
export async function inspectInvoices(db: Database, storage: InvoiceStorage) {
    const rows = (await db.pool.query('SELECT id,storage_key,byte_size,checksum FROM invoice_documents ORDER BY id')).rows;
    const known = new Set(rows.map(r => r.storage_key)), entries = await storage.entries(), issues = [];
    for (const row of rows) {
        try {
            const file = await storage.verified(row.storage_key, row.byte_size, row.checksum);
            await file.close();
        }
        catch {
            issues.push({ id: row.id, status: 'unavailable_or_corrupt' });
        }
    }
    return { documents: rows.length, issues, orphans: entries.filter(n => /^[0-9a-f-]{36}\.pdf$/.test(n) && !known.has(n)), temporaries: entries.filter(n => /^\.upload-[0-9a-f-]{36}$/.test(n)), readOnly: true };
}
if (require.main === module) {
    const db = new Database();
    inspectInvoices(db, new InvoiceStorage()).then(r => { console.log(JSON.stringify(r)); if (r.issues.length || r.orphans.length || r.temporaries.length)
        process.exitCode = 2; }).catch(() => { console.error('Falha na verificação documental. Confira banco, diretório e permissões.'); process.exitCode = 1; }).finally(() => db.onModuleDestroy());
}
