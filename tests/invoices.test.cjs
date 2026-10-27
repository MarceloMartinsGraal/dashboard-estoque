const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),request=require('supertest'),argon=require('argon2');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Database}=require('../dist/backend/db'),{migrate}=require('../dist/backend/migrate'),{createApp}=require('../dist/backend/app');
let db,app,http,agent,csrf,actor,product,inactive,dir;
const origin='http://localhost:5173';
function pdf(label='synthetic'){
 const parts=['%PDF-1.4\n'];const offsets=[0];
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>'];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(parts.join('')));parts.push(`${i+1} 0 obj\n${objects[i]}\nendobj\n`);}
 parts.push('% '+label+'\n');const xref=Buffer.byteLength(parts.join(''));
 parts.push('xref\n0 4\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');return Buffer.from(parts.join(''));
}
const upload=(bytes=pdf(),meta={},client=agent)=>client.post('/api/invoices').set('Origin',origin).set('x-csrf-token',csrf).set('Content-Type','application/pdf').set('x-file-name',encodeURIComponent(meta.filename??'nota.pdf')).set('x-invoice-name',encodeURIComponent(meta.name??'Nota sintética')).set('x-product-id',meta.productId??'').set('x-confirm-inactive',String(meta.confirmInactive??false)).send(bytes);
const edit=(id,body)=>agent.post('/api/invoices/'+id).set('Origin',origin).set('x-csrf-token',csrf).send(body);
before(async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL);assert.ok(url.pathname.endsWith('_test'));assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.PUBLIC_ORIGIN=origin;process.env.SESSION_SECRET='synthetic-invoices-secret-over-32-characters';process.env.NODE_ENV='test';
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'graal-invoice-test-'));process.env.INVOICE_STORAGE_DIR=dir;db=new Database();await migrate(db.pool);
 actor=(await db.pool.query("INSERT INTO employees(username,name,password_hash) VALUES('invoices-test','Funcionário Notas',$1) RETURNING id",[await argon.hash('synthetic-password-123')])).rows[0].id;
 [product,inactive]=(await db.pool.query("INSERT INTO products(description,unit,active) VALUES('Memória ÁUDIO NF','unidade',true),('Memória ÁUDIO NF inativa','unidade',false) RETURNING id")).rows.map(r=>r.id);
 app=await createApp();await app.listen(0,'127.0.0.1');http=request(app.getHttpServer());agent=request.agent(app.getHttpServer());
 const c=await agent.get('/api/auth/csrf');const login=await agent.post('/api/auth/login').set('Origin',origin).set('x-csrf-token',c.body.csrf).send({username:'invoices-test',password:'synthetic-password-123'});assert.equal(login.status,201);csrf=login.body.csrf;
});
after(async()=>{if(app)await app.close();if(db)await db.onModuleDestroy();delete process.env.INVOICE_STORAGE_DIR;if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'graal-invoice-test-'));await fs.rm(dir,{recursive:true,force:true});}});
test('PDF avulso, duplicata/reenvio/concorrência e conteúdo privado sem estoque',async()=>{
 const bytes=pdf('avulsa');const before=(await db.pool.query('SELECT count(*)::int n FROM movements')).rows[0].n;
 const r=await upload(bytes);assert.equal(r.status,201);assert.equal(r.body.product,null);assert.equal(r.body.uploadedBy.id,actor);assert.equal(r.body.storageKey,undefined);
 const duplicates=await Promise.all([upload(bytes),upload(bytes)]);for(const d of duplicates){assert.equal(d.status,409);assert.equal(d.body.code,'INVOICE_DUPLICATE');assert.equal(d.body.documentId,r.body.id);}
 const other=await Promise.all([upload(pdf('race')),upload(pdf('race'))]);assert.deepEqual(other.map(x=>x.status).sort(),[201,409]);
 const view=await agent.get('/api/invoices/'+r.body.id+'/file');assert.equal(view.status,200);assert.equal(view.headers['content-type'],'application/pdf');assert.match(view.headers['content-disposition'],/^inline/);assert.equal(view.headers['x-content-type-options'],'nosniff');assert.deepEqual(view.body,bytes);
 const down=await agent.get('/api/invoices/'+r.body.id+'/file?download=true');assert.match(down.headers['content-disposition'],/^attachment/);
 assert.equal((await http.get('/api/invoices/'+r.body.id+'/file')).status,401);assert.equal((await http.get('/api/invoices')).status,401);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM movements')).rows[0].n,before);
});
test('vínculo editável auditado, seleção sem saldo e confirmação de inativo',async()=>{
 const options=await agent.get('/api/invoices/products?q=memoria+audio+nf');assert.equal(options.status,200);assert.ok(options.body.items.some(p=>p.id===inactive&&p.active===false));assert.ok(options.body.items.some(p=>p.id===product));
 assert.equal((await upload(pdf('inactive-no'),{productId:inactive})).status,409);
 const r=await upload(pdf('linked'),{name:'Identificação NF vinculada',productId:product});assert.equal(r.status,201);assert.equal(r.body.product.id,product);
 assert.equal((await agent.get('/api/invoices?productId='+product)).body.items[0].id,r.body.id);
 assert.equal((await edit(r.body.id,{name:'Nome revisado',productId:inactive,confirmInactive:true})).status,201);
 const detached=await edit(r.body.id,{name:'Nome revisado',productId:null});assert.equal(detached.status,201);assert.equal(detached.body.product,null);
 assert.equal((await agent.get('/api/invoices/'+r.body.id+'/file')).status,200);
 const audit=(await db.pool.query("SELECT details FROM audit_log WHERE entity='nota_fiscal' AND entity_id=$1 ORDER BY id",[r.body.id])).rows;assert.equal(audit.length,3);assert.equal(audit[2].details.before.productId,inactive);
 assert.equal((await agent.get('/api/invoices?link=loose&q=nome+revisado')).body.total,1);
});
test('validação PDF, limite, CSRF e metadados não confiáveis',async()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from('<html>fake</html>'),Buffer.from('%PDF-1.4\n%%EOF')])assert.equal((await upload(bytes)).status,400);
 assert.equal((await upload(pdf(),{filename:'fake.html'})).status,400);
 assert.equal((await upload(pdf(),{filename:'../fake.pdf'})).status,400);
 assert.equal((await upload(Buffer.alloc(20*1024*1024+1))).status,413);
 assert.equal((await agent.post('/api/invoices').set('Content-Type','application/pdf').send(pdf())).status,403);
 assert.equal((await upload(pdf(),{productId:'bad'})).status,400);
});


test('falhas de arquivo/metadados limpam temporários e reportam órfão sem apagar válido',async()=>{
 const {InvoiceStorage}=require('../dist/backend/invoices/storage');const {ServiceUnavailableException}=require('@nestjs/common');
 const original=InvoiceStorage.prototype.publish;
 InvoiceStorage.prototype.publish=async()=>{throw new ServiceUnavailableException('Falha sintética de disco');};
 try{assert.equal((await upload(pdf('disk-failure'))).status,503);}finally{InvoiceStorage.prototype.publish=original;}
 assert.equal((await fs.readdir(dir)).filter(n=>n.startsWith('.upload-')).length,0);
 await db.pool.query("CREATE FUNCTION synthetic_fail_invoice_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity='nota_fiscal' THEN RAISE EXCEPTION 'synthetic-private'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_fail_invoice_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_fail_invoice_audit()");
 let failed;try{failed=await upload(pdf('metadata-failure'),{name:'Metadata failure fixture'});}finally{await db.pool.query('DROP TRIGGER synthetic_fail_invoice_audit ON audit_log; DROP FUNCTION synthetic_fail_invoice_audit()');}
 assert.equal(failed.status,500);assert.equal(JSON.stringify(failed.body).includes('synthetic-private'),false);
 assert.equal((await agent.get('/api/invoices?q=metadata+failure+fixture')).body.total,0);
 const {inspectInvoices}=require('../dist/backend/invoice-check');const report=await inspectInvoices(db,new InvoiceStorage());assert.equal(report.orphans.length,1);assert.equal(report.temporaries.length,0);assert.equal(report.issues.length,0);
 const retry=await upload(pdf('metadata-failure'),{name:'Metadata failure fixture'});assert.equal(retry.status,201);
 const metadata=(await db.pool.query('SELECT storage_key FROM invoice_documents WHERE id=$1',[retry.body.id])).rows[0];
 await fs.writeFile(path.join(dir,metadata.storage_key),'synthetic-corrupt');
 assert.equal((await agent.get('/api/invoices/'+retry.body.id+'/file')).status,503);
 const corrupt=await inspectInvoices(db,new InvoiceStorage());assert.ok(corrupt.issues.some(x=>x.id===retry.body.id));assert.equal((await fs.readdir(dir)).includes(metadata.storage_key),true);
});
test('paginação estável e persistência após reiniciar aplicação com mesmo diretório',async()=>{
 const ids=[];for(let i=0;i<3;i++)ids.push((await upload(pdf('page-'+i),{name:'Paginação '+i})).body.id);
 const a=await agent.get('/api/invoices?q=paginacao&limit=2&page=1'),b=await agent.get('/api/invoices?q=paginacao&limit=2&page=2');
 assert.equal(a.body.total,3);assert.equal(a.body.items.length,2);assert.equal(b.body.items.length,1);assert.equal(new Set([...a.body.items,...b.body.items].map(x=>x.id)).size,3);
 await app.close();app=await createApp();await app.listen(0,'127.0.0.1');http=request(app.getHttpServer());agent=request.agent(app.getHttpServer());
 const c=await agent.get('/api/auth/csrf');const login=await agent.post('/api/auth/login').set('Origin',origin).set('x-csrf-token',c.body.csrf).send({username:'invoices-test',password:'synthetic-password-123'});csrf=login.body.csrf;
 assert.equal((await agent.get('/api/invoices/'+ids[0])).body.name,'Paginação 0');assert.equal((await agent.get('/api/invoices/'+ids[0]+'/file')).status,200);
});


test('sessão revogada durante recebimento não confirma upload',async()=>{
 const {InvoiceStorage}=require('../dist/backend/invoices/storage');const original=InvoiceStorage.prototype.stage;
 InvoiceStorage.prototype.stage=async function(...args){const result=await original.apply(this,args);await db.pool.query('UPDATE employees SET session_version=session_version+1 WHERE id=$1',[actor]);return result;};
 try{assert.equal((await upload(pdf('revoked-during-upload'))).status,403);}finally{InvoiceStorage.prototype.stage=original;}
 const c=await agent.get('/api/auth/csrf');const login=await agent.post('/api/auth/login').set('Origin',origin).set('x-csrf-token',c.body.csrf).send({username:'invoices-test',password:'synthetic-password-123'});csrf=login.body.csrf;
});
test('limite incremental sem Content-Length limpa temporário',async()=>{
 const {InvoiceStorage,PDF_LIMIT}=require('../dist/backend/invoices/storage');const {Readable}=require('node:stream');
 await assert.rejects(new InvoiceStorage().stage(Readable.from([Buffer.alloc(PDF_LIMIT),Buffer.from('x')])),e=>e.getStatus()===413);
 assert.equal((await fs.readdir(dir)).some(n=>n.startsWith('.upload-')),false);
});
test('navegador real: notas e regressões de interface',async t=>{
 const edge=process.env.EDGE_BINARY||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'');
 if(!edge||!require('node:fs').existsSync(edge))return t.skip('Edge local indisponível para cenário visual');
 const httpNative=require('node:http');let target;
 const server=httpNative.createServer((req,res)=>{
  if(req.url.startsWith('/api/')){const proxy=httpNative.request(target+req.url,{method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);});proxy.on('error',()=>{res.statusCode=502;res.end();});req.pipe(proxy);return;}
  const rel=new URL(req.url,'http://localhost').pathname;const root=path.resolve('dist/frontend');const file=path.resolve(root,'.'+(rel==='/'?'/index.html':rel));
  if(!file.startsWith(root+path.sep)){res.statusCode=404;res.end();return;}
  const type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html';res.setHeader('Content-Type',type);require('node:fs').createReadStream(file).on('error',()=>{res.statusCode=404;res.end();}).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const web='http://127.0.0.1:'+server.address().port;
 try{
  await app.close();process.env.PUBLIC_ORIGIN=web;app=await createApp();await app.listen(0,'127.0.0.1');target='http://127.0.0.1:'+app.getHttpServer().address().port;
  const file=path.join(dir,'synthetic-browser.pdf');await fs.writeFile(file,pdf('browser-real'));
  const result=await require('../scripts/test-invoices-browser.cjs')({url:web,file,productId:product,edgeBinary:edge});assert.match(result,/OK/);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
