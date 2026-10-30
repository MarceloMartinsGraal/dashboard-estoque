const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const request=require('supertest'),argon=require('argon2');const {Pool}=require('pg'),{randomBytes,createHash}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path');const {Database}=require('../dist/backend/db'),{migrate}=require('../dist/backend/migrate'),{createApp}=require('../dist/backend/app');
const origin='http://localhost:5173',dbs=[],apps=[];let adminPool;
before(()=>{const u=new URL(process.env.TEST_DATABASE_URL);assert.ok(u.pathname.endsWith('_test'));assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname));adminPool=new Pool({connectionString:u.toString()});process.env.PUBLIC_ORIGIN=origin;process.env.SESSION_SECRET='synthetic-first-access-over-32-characters';process.env.NODE_ENV='test';delete process.env.INTEGRATION_ENABLED;});
after(async()=>{for(const app of apps)await app.close();for(const db of dbs)await db.onModuleDestroy();await adminPool?.end();});
async function database(legacy=false){
 const name='graal_first_'+randomBytes(6).toString('hex')+'_test';await adminPool.query('CREATE DATABASE '+name);
 const u=new URL(process.env.TEST_DATABASE_URL);u.pathname='/'+name;process.env.DATABASE_URL=u.toString();const db=new Database();dbs.push(db);
 if(legacy){await db.pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of (await fs.readdir('backend/migrations')).filter(n=>n.endsWith('.sql')).sort().slice(0,6)){const sql=await fs.readFile(path.join('backend/migrations',file),'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[file,createHash('sha256').update(sql).digest('hex')]);}
 }else await migrate(db.pool);return db;
}
async function application(){const app=await createApp();apps.push(app);return app;}
async function login(agent,password='admin'){const csrf=(await agent.get('/api/auth/csrf')).body.csrf;return agent.post('/api/auth/login').set('Origin',origin).set('x-csrf-token',csrf).send({username:'admin',password});}
const post=(a,csrf,url,body)=>a.post(url).set('Origin',origin).set('x-csrf-token',csrf).send(body);
test('banco vazio: inicializações concorrentes criam uma conta auditada, sem reset no reinício',async()=>{
 const db=await database();const created=await Promise.all([application(),application(),application()]);
 const rows=(await db.pool.query('SELECT * FROM employees')).rows;assert.equal(rows.length,1);const row=rows[0];
 assert.equal(row.username,'admin');assert.equal(row.name,'Administrador inicial');assert.equal(row.manages_accounts,true);assert.equal(row.must_change_password,true);assert.match(row.password_hash,/^\$argon2id\$/);assert.equal(await argon.verify(row.password_hash,'admin'),true);
 const audit=(await db.pool.query("SELECT details FROM audit_log WHERE action='criar_administrador_inicial'")).rows;assert.equal(audit.length,1);assert.equal(/password|hash|senha/i.test(JSON.stringify(audit)),false);
 for(const a of created){await a.close();apps.splice(apps.indexOf(a),1);}await application();assert.equal((await db.pool.query('SELECT password_hash FROM employees')).rows[0].password_hash,row.password_hash);
});
test('migração preserva funcionários ativos/inativos e startup não cria nem redefine contas',async()=>{
 for(const active of [true,false]){const db=await database(true);const p=(await db.pool.query("INSERT INTO employees(username,name,password_hash,active,manages_accounts) VALUES('existente','Existente','synthetic-existing-hash',$1,true) RETURNING id",[active])).rows[0];await migrate(db.pool);await application();const rows=(await db.pool.query('SELECT * FROM employees')).rows;assert.equal(rows.length,1);assert.equal(rows[0].id,p.id);assert.equal(rows[0].password_hash,'synthetic-existing-hash');assert.equal(rows[0].must_change_password,false);}
});
test('primeiro login restringe rotas; troca forte atômica revoga sessões e exige novo login',async()=>{
 const db=await database();const app=await application();await app.listen(0,'127.0.0.1');const http=app.getHttpServer(),a=request.agent(http),b=request.agent(http),anon=request.agent(http);
 const first=await login(a),other=await login(b);assert.equal(first.status,201);assert.equal(first.body.employee.must_change_password,true);assert.equal((await a.get('/api/auth/me')).body.must_change_password,true);
 const signout=request.agent(http),signoutLogged=await login(signout);assert.equal((await post(signout,signoutLogged.body.csrf,'/api/auth/logout',{})).status,201);assert.equal((await signout.get('/api/auth/me')).status,401);
 for(const route of ['/api/catalog','/api/products','/api/history','/api/overview','/api/locations','/api/employees','/api/invoices','/api/imports','/api/audit','/api/invoices/00000000-0000-0000-0000-000000000001/file','/api/products/00000000-0000-0000-0000-000000000001/balances']){const r=await a.get(route);assert.equal(r.status,403,route);assert.equal(r.body.code,'PASSWORD_CHANGE_REQUIRED');}
 for(const route of ['/api/products','/api/movements','/api/employees','/api/invoices'])assert.equal((await post(a,first.body.csrf,route,{})).status,403,route);
 assert.equal((await a.post('/api/auth/change-password').send({password:'long-synthetic-secret',confirmPassword:'long-synthetic-secret'})).status,403);
 const anonymousCsrf=(await anon.get('/api/auth/csrf')).body.csrf;assert.equal((await post(anon,anonymousCsrf,'/api/auth/change-password',{})).status,401);
 for(const body of [{password:'admin',confirmPassword:'admin'},{password:'senha-longa-sintetica',confirmPassword:'divergente'},{password:'senha-longa-sintetica',confirmPassword:'senha-longa-sintetica',must_change_password:false}])assert.equal((await post(a,first.body.csrf,'/api/auth/change-password',body)).status,400);
 const raw=decodeURIComponent(other.headers['set-cookie'][0].split(';')[0].split('=').slice(1).join('='));const sid=raw.slice(2,raw.lastIndexOf('.'));const oldSession=(await db.pool.query('SELECT * FROM sessions WHERE sid=$1',[sid])).rows[0];
 await db.pool.query("CREATE FUNCTION synthetic_fail_first_password_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='trocar_senha_inicial' THEN RAISE EXCEPTION 'synthetic-private-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_fail_first_password_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_fail_first_password_audit()");
 try{assert.equal((await post(a,first.body.csrf,'/api/auth/change-password',{password:'senha-rollback-sintetica',confirmPassword:'senha-rollback-sintetica'})).status,500);}
 finally{await db.pool.query('DROP TRIGGER synthetic_fail_first_password_audit ON audit_log; DROP FUNCTION synthetic_fail_first_password_audit()');}
 const unchanged=(await db.pool.query("SELECT * FROM employees WHERE username='admin'")).rows[0];assert.equal(unchanged.must_change_password,true);assert.equal(await argon.verify(unchanged.password_hash,'admin'),true);
 const changed=await post(a,first.body.csrf,'/api/auth/change-password',{password:'nova-senha-sintetica-123',confirmPassword:'nova-senha-sintetica-123'});assert.equal(changed.status,201);assert.equal(changed.body.loginRequired,true);
 await db.pool.query('INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,$3) ON CONFLICT(sid) DO UPDATE SET sess=EXCLUDED.sess,expire=EXCLUDED.expire',[sid,JSON.stringify(oldSession.sess),oldSession.expire]);
 assert.equal((await a.get('/api/auth/me')).status,401);assert.equal((await b.get('/api/auth/me')).status,401);
 assert.equal((await login(a,'admin')).status,401);const ready=await login(a,'nova-senha-sintetica-123');assert.equal(ready.status,201);assert.equal(ready.body.employee.must_change_password,false);assert.equal((await a.get('/api/products')).status,200);
 const saved=(await db.pool.query("SELECT * FROM employees WHERE username='admin'")).rows[0];assert.equal(await argon.verify(saved.password_hash,'admin'),false);assert.equal(saved.must_change_password,false);assert.ok(Number(saved.session_version)>0);
 await application();assert.equal((await db.pool.query("SELECT password_hash FROM employees WHERE username='admin'")).rows[0].password_hash,saved.password_hash);
 assert.equal((await post(a,ready.body.csrf,'/api/auth/change-password',{password:'outra-senha-sintetica',confirmPassword:'outra-senha-sintetica'})).status,409);
 assert.equal((await post(a,ready.body.csrf,'/api/employees',{id:saved.id,username:'admin',name:saved.name,active:true,managesAccounts:true,must_change_password:false})).status,400);
 const logout=await post(a,ready.body.csrf,'/api/auth/logout',{});assert.equal(logout.status,201);
});
test('provisionamento real recusa responsável pendente e não cria credencial',async()=>{
 const db=await database();await application();const row=(await db.pool.query('SELECT id FROM employees')).rows[0];assert.ok(row);
 const {provision,listAdmins}=require('../scripts/provision-integration.cjs');const c=await db.pool.connect();try{const list=await listAdmins(c);assert.equal(list.requiresFirstAccess,true);assert.deepEqual(list.items,[]);await assert.rejects(()=>provision(c,{operation:'provision',instanceId:'first-access-synthetic',adminId:row.id,validDays:1,links:[]}),/primeiro|pendente|responsável/i);}finally{c.release();}
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM integration_clients')).rows[0].n,0);
});

test('startup rejeita valor inválido antes de acessar banco e exige migração007',async()=>{
 process.env.INTEGRATION_ENABLED='invalid';try{await assert.rejects(()=>createApp(),/INTEGRATION_ENABLED.*true.*false/);}finally{delete process.env.INTEGRATION_ENABLED;}
 const db=await database(true);await assert.rejects(()=>createApp(),/007_initial_access/);assert.equal((await db.pool.query('SELECT count(*)::int n FROM employees')).rows[0].n,0);
});


test('navegador real usa primeiro acesso antes de montar o dashboard',async t=>{
 const edge=process.env.EDGE_BINARY||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'');if(!edge||!require('node:fs').existsSync(edge))return t.skip('Navegador local indisponível');
 await database();const native=require('node:http');let target;
 const server=native.createServer((req,res)=>{if(req.url.startsWith('/api/')){const proxy=native.request(target+req.url,{method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);});proxy.on('error',()=>{res.statusCode=502;res.end();});req.pipe(proxy);return;}
 const rel=new URL(req.url,'http://localhost').pathname,root=path.resolve('dist/frontend'),file=path.resolve(root,'.'+(rel==='/'?'/index.html':rel));if(!file.startsWith(root+path.sep)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');require('node:fs').createReadStream(file).on('error',()=>{res.statusCode=404;res.end();}).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const web='http://127.0.0.1:'+server.address().port;process.env.PUBLIC_ORIGIN=web;
 try{const app=await application();await app.listen(0,'127.0.0.1');target='http://127.0.0.1:'+app.getHttpServer().address().port;assert.match(await require('../scripts/test-first-access-browser.cjs')({url:web,edgeBinary:edge}),/OK/);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));process.env.PUBLIC_ORIGIN=origin;}
});
