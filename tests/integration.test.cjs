const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomBytes, createHash } = require('node:crypto');
const { Database } = require('../dist/backend/db');
const { migrate } = require('../dist/backend/migrate');
const { createApp } = require('../dist/backend/app');
const { StockService } = require('../dist/backend/stock');
let db, app, http, actor, product, a, b, token, client;
const root = '/api/integration/v1';
const contract=require('./openapi-response.cjs');
async function credential(
  instance = 'glpi-synthetic',
  scopes = ['read', 'products:write', 'movements:write'],
) {
  const secret = randomBytes(32).toString('hex');
  const c = (
    await db.pool.query(
      "INSERT INTO integration_clients(instance_id,name,token_hash,scopes,active,expires_at) VALUES($1,$2,$3,$4,true,now()+interval '1 hour') RETURNING id",
      [
        instance,
        'Cliente sintético',
        createHash('sha256').update(secret).digest('hex'),
        scopes,
      ],
    )
  ).rows[0].id;
  return { id: c, token: c + '.' + secret };
}
const get = (path, t = token) =>
  http.get(root + path).set('Authorization', 'Bearer ' + t).then(r=>contract.response('GET',path,r));
const post = (path, key, body, t = token) =>
  http
    .post(root + path)
    .set('Authorization', 'Bearer ' + t)
    .set('Idempotency-Key', key)
    .send(body).then(r=>contract.response('POST',path,r));
const movement = (extra = {}) => ({
  productId: product,
  kind: 'entrada',
  quantity: '1',
  eventDate: '2026-01-03',
  locationId: a,
  reason: 'chamado',
  ticketId: '000042',
  externalUserId: '0007',
  observation: 'Memória para chamado sintético',
  ...extra,
});
before(async () => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(url.pathname.endsWith('_test'));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'synthetic-session-secret-over-32-characters';
  process.env.PUBLIC_ORIGIN = 'http://localhost:5173';
  delete process.env.INTEGRATION_ENABLED;
  db = new Database();
  await migrate(db.pool);
  actor = (
    await db.pool.query(
      "INSERT INTO employees(username,name,password_hash) VALUES('integration-user','Responsável sintético','no-login') RETURNING id",
    )
  ).rows[0].id;
  [a, b] = (
    await db.pool.query(
      "INSERT INTO locations(code,name) VALUES('INT-A','Armário teste A'),('INT-B','Armário teste B') RETURNING id",
    )
  ).rows.map((r) => r.id);
  product = (
    await db.pool.query(
      "INSERT INTO products(description,unit,legacy_id,source) VALUES('Memória ÁUDIO','unidade',98765,'synthetic') RETURNING id",
    )
  ).rows[0].id;
  await new StockService(db).opening(
    actor,
    product,
    '2026-01-01',
    [{ locationId: a, quantity: '2' }],
    'Contagem sintética',
  );
  ({ id: client, token } = await credential());
  await db.pool.query(
    'INSERT INTO external_employee_links(instance_id,external_user_id,employee_id) VALUES($1,$2,$3)',
    ['glpi-synthetic', '0007', actor],
  );
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
});
after(async () => {
  delete process.env.INTEGRATION_ENABLED;
  if (app) await app.close();
  if (db) await db.onModuleDestroy();
});
test('integração habilitada por padrão, false explícito, autenticação e CSRF preservados', async () => {
  assert.equal((await get('/products')).status, 200);
  process.env.INTEGRATION_ENABLED='false';
  assert.equal((await get('/products')).status, 503);
  process.env.INTEGRATION_ENABLED = 'true';
  assert.equal((await http.get(root + '/products')).status, 401);
  assert.equal((await get('/products', 'inválido')).status, 401);
  assert.equal(
    (await http.post(root + '/movements').send(movement())).status,
    401,
  );
  assert.equal(
    (
      await http
        .post('/api/products')
        .set('Authorization', 'Bearer ' + token)
        .send({})
    ).status,
    403,
  );
  assert.equal(
    (await http.get('/api/products').set('Authorization', 'Bearer ' + token))
      .status,
    401,
  );
});
test('busca parcial por acentos/nome/identificação, paginação e saldos por localização', async () => {
  const r = await get('/products?q=MEMORIA+audio&limit=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.items[0].id, product);
  assert.equal(r.body.items[0].quantity, '2.000');
  assert.equal(r.body.items[0].unit, 'unidade');
  assert.equal((await get('/products?q=9876')).body.items[0].id, product);
  assert.equal((await get('/products?limit=101')).status, 400);
  const distribution = await get('/products/' + product + '/balances');
  assert.equal(distribution.body.total, '2.000');
  assert.equal(
    distribution.body.locations.find((r) => r.id === a).code,
    'INT-A',
  );
  const locations = [];
  for (let page = 1; ; page++) {
    const r = await get('/locations?limit=100&page=' + page);
    assert.equal(r.status, 200);
    locations.push(...r.body.items);
    if (locations.length >= r.body.total) break;
  }
  assert.ok(locations.some((r) => r.code === 'NAO_INFORMADA'));
  const outgoing = await get(
    '/products/' + product + '/locations?purpose=saida',
  );
  assert.deepEqual(
    outgoing.body.items.map((r) => r.id),
    [a],
  );
});
test('entrada/saída usam funcionário vinculado e referências textuais; repetição retorna resultado original', async () => {
  const body = movement({ quantity: '3', locationId: b });
  const r = await post('/movements', 'entry-1', body);
  assert.equal(r.status, 201);
  assert.equal(r.body.quantity, '3.000');
  const again = await post('/movements', 'entry-1', body);
  assert.equal(again.status, 201);
  assert.deepEqual(again.body, r.body);
  const result = await get('/operations/entry-1');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.result, r.body);
  assert.equal(
    (
      await post(
        '/movements',
        'entry-1',
        movement({ quantity: '4', locationId: b }),
      )
    ).status,
    409,
  );
  const m = (
    await db.pool.query('SELECT * FROM movements WHERE id=$1', [r.body.id])
  ).rows[0];
  assert.equal(m.actor_id, actor);
  assert.equal(m.ticket, '000042');
  assert.equal(
    (
      await post(
        '/movements',
        'exit-1',
        movement({ kind: 'saida', quantity: '2', locationId: b }),
      )
    ).status,
    201,
  );
  const d = await get('/products/' + product + '/balances');
  assert.equal(d.body.total, '3.000');
  assert.equal(d.body.locations.find((x) => x.id === b).quantity, '1.000');
  assert.equal(
    (
      await post(
        '/movements',
        'exit-no-stock',
        movement({ kind: 'saida', quantity: '9', locationId: b }),
      )
    ).status,
    409,
  );
  assert.equal((await get('/operations/exit-no-stock')).status, 404);
  assert.equal(
    (await post('/movements', 'fraction', movement({ quantity: '1.5' })))
      .status,
    400,
  );
});
test('chaves concorrentes iguais geram somente um movimento; chaves diferentes disputam saldo', async () => {
  const body = movement();
  const r = await Promise.all(
    Array.from({ length: 5 }, () =>
      post('/movements', 'concurrent-identical', body),
    ),
  );
  assert.ok(r.every((x) => x.status === 201));
  assert.equal(new Set(r.map((x) => x.body.id)).size, 1);
  const before = (await new StockService(db).balances(product)).total;
  const exits = await Promise.all(
    ['concurrent-exit-a', 'concurrent-exit-b'].map((key) =>
      post('/movements', key, movement({ kind: 'saida', quantity: '3' })),
    ),
  );
  assert.deepEqual(exits.map((x) => x.status).sort(), [201, 409]);
  assert.equal(before, '4.000');
  assert.equal((await new StockService(db).balances(product)).total, '1.000');
});
test('sem vínculo, funcionário/vínculo inativo, escopo restrito e credencial revogada bloqueiam', async () => {
  assert.equal(
    (await post('/movements', 'unlinked', movement({ externalUserId: '7' })))
      .status,
    403,
  );
  await db.pool.query('UPDATE employees SET active=false WHERE id=$1', [actor]);
  assert.equal(
    (await post('/movements', 'inactive-employee', movement())).status,
    403,
  );
  await db.pool.query('UPDATE employees SET active=true WHERE id=$1', [actor]);
  await db.pool.query(
    "UPDATE external_employee_links SET active=false WHERE instance_id='glpi-synthetic'",
  );
  assert.equal(
    (await post('/movements', 'inactive-link', movement())).status,
    403,
  );
  await db.pool.query(
    "UPDATE external_employee_links SET active=true WHERE instance_id='glpi-synthetic'",
  );
  const read = await credential('glpi-synthetic', ['read']);
  assert.equal(
    (await post('/movements', 'scope', movement(), read.token)).status,
    403,
  );
  await db.pool.query(
    'UPDATE integration_clients SET active=false WHERE id=$1',
    [read.id],
  );
  assert.equal((await get('/products', read.token)).status, 401);
  const expired = await credential();
  await db.pool.query(
    "UPDATE integration_clients SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.id],
  );
  assert.equal((await get('/products', expired.token)).status, 401);
});
test('instância isola resultado/histórico; rotação de credencial preserva chave', async () => {
  const other = await credential('glpi-other');
  assert.equal((await get('/operations/entry-1', other.token)).status, 404);
  assert.equal(
    (await get('/tickets/000042/movements', other.token)).body.total,
    0,
  );
  const rotated = await credential();
  assert.equal((await get('/operations/entry-1', rotated.token)).status, 200);
  assert.equal(
    (
      await post(
        '/movements',
        'entry-1',
        movement({ quantity: '3', locationId: b }),
        rotated.token,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await post(
        '/movements',
        'entry-1',
        movement({ quantity: '3', locationId: b, externalUserId: '7' }),
      )
    ).status,
    409,
  );
});
test('cadastro explícito reutiliza validação, não cria quantidade e não aceita campos financeiros', async () => {
  const body = {
    externalUserId: '0007',
    description: 'Produto cadastrado pela integração',
    unit: 'unidade',
    active: true,
  };
  const r = await post('/products', 'create-product', body);
  assert.equal(r.status, 201);
  assert.deepEqual(
    (await post('/products', 'create-product', body)).body,
    r.body,
  );
  assert.equal(
    (await get('/products?q=Produto+cadastrado')).body.items[0].quantity,
    '0.000',
  );
  assert.equal(
    (
      await post(
        '/movements',
        'pending-opening',
        movement({ productId: r.body.id, eventDate: (await get('/products/'+r.body.id+'/balances')).body.openingDate }),
      )
    ).status,
    201,
  );
  assert.equal(
    (await post('/products', 'money', { ...body, price: '1' })).status,
    400,
  );
  assert.equal(
    (await post('/products', 'invalid-unit', { ...body, unit: 'metro' }))
      .status,
    400,
  );
  assert.equal(
    (
      await post('/products', 'orphan-category', {
        ...body,
        subcategoryId: product,
      })
    ).status,
    400,
  );
});
test('histórico por chamado preserva autoria, localizações e vínculo de estorno', async () => {
  const original = (await get('/operations/entry-1')).body.result;
  await new StockService(db).move(actor, {
    productId: product,
    kind: 'entrada',
    quantity: '2',
    eventDate: '2026-01-03',
    locationId: b,
    reason: 'recebimento',
  });
  const reversal = await new StockService(db).reverse(
    actor,
    original.id,
    '2026-01-04',
    'Correção sintética',
  );
  const r = await get('/tickets/000042/movements?limit=2');
  assert.equal(r.status, 200);
  assert.ok(r.body.total >= 5);
  assert.equal(r.body.items.length, 2);
  const all = await get('/tickets/000042/movements?limit=100');
  const undo = all.body.items.find((x) => x.id === reversal.id);
  assert.equal(undo.reversal_of, original.id);
  assert.equal(undo.author, 'Responsável sintético');
  assert.equal(undo.externalReference.instanceId, 'glpi-synthetic');
  assert.equal(undo.externalReference.ticketId, '000042');
  assert.ok(all.body.items.every((x) => x.regime === 'operacional'));
  assert.ok(all.body.items.find((x) => x.id === original.id).reversed_by);
});

test('chaves distintas permitem lançamentos intencionais iguais; falha de saldo não reserva chave', async () => {
  const body = movement({ locationId: b });
  const r = await Promise.all(
    ['intentional-a', 'intentional-b'].map((key) =>
      post('/movements', key, body),
    ),
  );
  assert.ok(r.every((x) => x.status === 201));
  assert.notEqual(r[0].body.id, r[1].body.id);
  const exit = movement({ kind: 'saida', quantity: '9', locationId: b });
  assert.equal(
    (await post('/movements', 'retry-after-stock', exit)).status,
    409,
  );
  await post(
    '/movements',
    'restock-for-retry',
    movement({ quantity: '9', locationId: b }),
  );
  assert.equal(
    (await post('/movements', 'retry-after-stock', exit)).status,
    201,
  );
  const altered = movement({ locationId: b, ticketId: '000043' });
  assert.equal(
    (await post('/movements', 'intentional-a', altered)).status,
    409,
  );
  assert.equal((await post('/movements', 'create-product', body)).status, 409);
  assert.equal((await post('/movements', 'space key', body)).status, 400);
  assert.equal(
    (
      await http
        .post(root + '/movements')
        .set('Authorization', 'Bearer ' + token)
        .send(body)
    ).status,
    400,
  );
});
test('revogação e inativação durante espera de idempotência são reavaliadas na transação', async () => {
  async function waiting(key, body, action, t = token) {
    const c = await db.pool.connect();
    let pending;
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify(['glpi-synthetic', key]),
      ]);
      pending = post('/movements', key, body, t).then((r) => r);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        if (
          (
            await db.pool.query(
              "SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE '%hashtextextended%' AND pid<>pg_backend_pid()",
            )
          ).rowCount
        ) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.ok(waiting, 'Requisição alcançou a espera no banco');
      await action();
      await c.query('COMMIT');
      return await pending;
    } finally {
      await c.query('ROLLBACK');
      c.release();
      if (pending) await pending;
    }
  }
  const revoked = await credential();
  const result = await waiting(
    'revoked-during-wait',
    movement(),
    () =>
      db.pool.query('UPDATE integration_clients SET active=false WHERE id=$1', [
        revoked.id,
      ]),
    revoked.token,
  );
  assert.equal(result.status, 401);
  assert.equal((await get('/operations/revoked-during-wait')).status, 404);
  const inactive = await waiting('inactive-during-wait', movement(), () =>
    db.pool.query('UPDATE employees SET active=false WHERE id=$1', [actor]),
  );
  assert.equal(inactive.status, 403);
  await db.pool.query('UPDATE employees SET active=true WHERE id=$1', [actor]);
  const changed = await credential();
  const changedResult = await waiting(
    'secret-changed-during-wait',
    movement(),
    () =>
      db.pool.query(
        'UPDATE integration_clients SET token_hash=$2 WHERE id=$1',
        [changed.id, '0'.repeat(64)],
      ),
    changed.token,
  );
  assert.equal(changedResult.status, 401);
});
test('cookies e escopos de escrita não autorizam leituras; referências não vazam entre instâncias', async () => {
  const csrf = await http.get('/api/auth/csrf');
  assert.equal(
    (
      await http
        .get(root + '/products')
        .set('Cookie', csrf.headers['set-cookie'] || [])
    ).status,
    401,
  );
  const write = await credential('glpi-synthetic', ['movements:write']);
  assert.equal((await get('/products', write.token)).status, 403);
  const other = await credential('glpi-other');
  assert.equal(
    (await post('/movements', 'other-instance', movement(), other.token))
      .status,
    403,
  );
  const explicit = await get('/products?q=' + product);
  assert.equal(explicit.body.items[0].id, product);
  assert.equal(
    (
      await post('/movements', 'extra-field', {
        ...movement(),
        instanceId: 'glpi-other',
      })
    ).status,
    400,
  );
  const unknown = '00000000-0000-0000-0000-000000000001';
  assert.equal(
    (
      await post(
        '/movements',
        'unknown-location',
        movement({ locationId: unknown }),
      )
    ).status,
    201,
  );
  const availability = await get(
    '/products/' + product + '/locations?purpose=saida',
  );
  assert.ok(
    availability.body.items.some(
      (x) => x.id === unknown && x.code === 'NAO_INFORMADA',
    ),
  );
});

test('produto novo da integração inicia vazio; primeira entrada separada é idempotente e não permite segunda abertura', async()=>{
 const body={description:'Novo sem legado '+Date.now(),active:true,externalUserId:'0007'};
 const created=await post('/products','new-zero-base',body);assert.equal(created.status,201);
 const id=created.body.id;const bal=await get('/products/'+id+'/balances');
 assert.ok(bal.body.openingDate);assert.equal(bal.body.total,'0.000');
 assert.equal((await db.pool.query('SELECT id FROM movements WHERE product_id=$1',[id])).rowCount,0);
 assert.equal((await post('/products','new-zero-base',body)).body.id,id);
 const input=movement({productId:id,eventDate:bal.body.openingDate,quantity:'2'});
 const results=await Promise.all([post('/movements','first-new-entry',input),post('/movements','first-new-entry',input)]);
 assert.ok(results.every(r=>r.status===201));assert.equal(results[0].body.id,results[1].body.id);
 assert.equal((await get('/products/'+id+'/balances')).body.total,'2.000');
 await assert.rejects(()=>new StockService(db).opening(actor,id,bal.body.openingDate,[{locationId:a,quantity:'2'}],'Não duplicar'),/Abertura já aprovada/);
 assert.equal((await db.pool.query('SELECT id FROM movements WHERE product_id=$1',[id])).rowCount,1);
 const old=await db.pool.query("INSERT INTO products(description,unit,source,legacy_id) VALUES('Legado pendente','unidade','synthetic-pending',123) RETURNING id");
 assert.equal((await post('/movements','legacy-remains-pending',movement({productId:old.rows[0].id,eventDate:bal.body.openingDate}))).status,409);
 assert.equal((await db.pool.query('SELECT opening_date FROM products WHERE id=$1',[old.rows[0].id])).rows[0].opening_date,null);
});

test('possíveis duplicatas: catálogo inteiro, inativos/zero, confirmação auditada, replay e concorrência',async()=>{
 const {ProductService}=require('../dist/backend/products');
 await db.pool.query("INSERT INTO products(description,unit,active) SELECT 'Memória RAM Kingston DDR4 8 GB modelo '||n,'unidade',false FROM generate_series(1,25)n");
 const q='Memória Kingston 8GB DDR4';const r=await get('/product-matches?'+new URLSearchParams({description:q,page:'2',limit:'20'}));
 assert.equal(r.status,200);assert.equal(r.body.total,25);assert.equal(r.body.items.length,5);assert.ok(r.body.items.every(p=>!p.active&&p.quantity==='0.000'));assert.equal(r.body.candidateIds.length,25);
 const body={description:q,active:true,externalUserId:'0007'};
 assert.equal((await post('/products','duplicate-unreviewed',body)).status,409);
 const confirmed={...body,duplicateConfirmation:{candidateIds:r.body.candidateIds,justification:'Modelo novo com part number diferente, conferido pelo operador'}};
 const saved=await post('/products','duplicate-reviewed',confirmed);assert.equal(saved.status,201);
 assert.equal((await post('/products','duplicate-reviewed',confirmed)).body.id,saved.body.id);
 assert.equal((await post('/products','duplicate-stale',confirmed)).status,409);
 assert.equal((await db.pool.query("SELECT id FROM audit_log WHERE action='confirmar_produto_distinto' AND entity_id=$1",[saved.body.id])).rowCount,1);
 const service=new ProductService(db);
 await assert.rejects(()=>service.save(actor,{description:'memoria kingston DDR4 8 GB',active:true}),/Possíveis duplicatas/);
 const different=await get('/product-matches?'+new URLSearchParams({description:'Memória Kingston DDR3 16GB',page:'1',limit:'20'}));
 assert.ok(different.body.items.some(p=>p.technicalDifferences));
 const concurrent={description:'Adaptador Aurora sintético 77X exclusivo',active:true,externalUserId:'0007'};
 const both=await Promise.all([post('/products','dup-race-a',concurrent),post('/products','dup-race-b',concurrent)]);
 assert.deepEqual(both.map(r=>r.status).sort(),[201,409]);
 assert.equal((await post('/products','forged-identity',{...body,id:saved.body.id})).status,400);
 await assert.rejects(()=>db.pool.query("INSERT INTO products(description,unit,source,legacy_id) SELECT description,unit,source,legacy_id FROM products WHERE legacy_id=98765"),e=>e.code==='23505');
 const broken=new ProductService({pool:{query:async()=>{throw new Error('synthetic unavailable')}}});
 await assert.rejects(()=>broken.matches({description:q}),/synthetic unavailable/);
});

test('busca disponível do plugin filtra antes de paginar e não altera dashboard/duplicidade',async()=>{
 process.env.INTEGRATION_ENABLED='true';
 const stock=new StockService(db);const ids=[];
 for(let n=0;n<33;n++)ids.push((await db.pool.query("INSERT INTO products(description,unit,active) VALUES($1,'unidade',true) RETURNING id",['Disponibilidade ÁUDIO '+String(n).padStart(2,'0')])).rows[0].id);
 for(const id of ids.slice(30))await stock.opening(actor,id,'2026-01-01',[{locationId:a,quantity:'2'}],'Contagem teste');
 await db.pool.query('UPDATE products SET active=false WHERE id=$1',[ids[32]]);
 const query='/products?'+new URLSearchParams({q:'disponibilidade audio',availability:'positive',status:'ativo',page:'1',limit:'1'});
 const first=await get(query);assert.equal(first.status,200);assert.equal(first.body.total,2);assert.equal(first.body.items[0].id,ids[30]);assert.equal(first.body.items[0].locations[0].code,'INT-A');
 const second=await get(query.replace('page=1','page=2'));assert.equal(second.body.items[0].id,ids[31]);assert.equal(second.body.total,2);
 const legacy=(await db.pool.query("INSERT INTO products(description,unit) VALUES('Legado exclusivo sem operação','unidade') RETURNING id")).rows[0].id;
 const batch=(await db.pool.query("INSERT INTO import_batches(source,checksum,created_by,payload,preview) VALUES('synthetic-availability','synthetic-availability',$1,'{}','{}') RETURNING id",[actor])).rows[0].id;
 await db.pool.query("INSERT INTO legacy_movements(batch_id,source,legacy_id,product_id,kind,quantity,event_date,reason,date_estimated,zero_evidence) VALUES($1,'synthetic-availability',1,$2,'entrada',5000,'2026-01-01','legado não informado',false,false)",[batch,legacy]);
 const legacySearch=await get('/products?'+new URLSearchParams({q:legacy,availability:'positive',status:'ativo'}));assert.equal(legacySearch.body.total,0);
 assert.equal((await get('/products?'+new URLSearchParams({q:legacy,availability:'all',status:'ativo'}))).body.items[0].quantity,'0.000');
 const all=await get(query.replace('availability=positive','availability=all'));assert.equal(all.body.total,32);assert.equal(all.body.items[0].quantity,'0.000');
 const {ProductService}=require('../dist/backend/products');assert.equal((await new ProductService(db).search({q:'Disponibilidade'})).total,33);
 const duplicates=await get('/product-matches?'+new URLSearchParams({description:'Disponibilidade ÁUDIO 00'}));assert.equal(duplicates.body.total,33);
});
test('cadastro quatro campos usa opções reais e mantém base zero/entrada separada',async()=>{
 process.env.INTEGRATION_ENABLED='true';
 const category=(await db.pool.query("INSERT INTO categories(name) VALUES('Categoria teste rápido') RETURNING id")).rows[0].id;
 const sub=(await db.pool.query("INSERT INTO subcategories(name,category_id) VALUES('Subcategoria teste rápido',$1) RETURNING id",[category])).rows[0].id;
 const options=await get('/product-options');assert.equal(options.status,200);assert.ok(options.body.categories.some(x=>x.id===category));assert.ok(options.body.subcategories.some(x=>x.id===sub&&x.category_id===category));
 const body={description:'Equipamento Boreal Q7 exclusivo',categoryId:category,subcategoryId:sub,active:true,externalUserId:'0007'};
 const created=await post('/products','four-field-product',body);assert.equal(created.status,201);assert.equal((await post('/products','four-field-product',body)).body.id,created.body.id);
 const balances=await get('/products/'+created.body.id+'/balances');assert.equal(balances.body.total,'0.000');assert.ok(balances.body.openingDate);
 const saved=(await db.pool.query('SELECT * FROM products WHERE id=$1',[created.body.id])).rows[0];assert.equal(saved.category_id,category);assert.equal(saved.subcategory_id,sub);assert.equal(saved.unit,'unidade');assert.equal(saved.active,true);
 assert.equal((await db.pool.query('SELECT id FROM movements WHERE product_id=$1',[created.body.id])).rowCount,0);
 const entry=movement({productId:created.body.id,eventDate:balances.body.openingDate,kind:'entrada',quantity:'1'});
 assert.equal((await post('/movements','four-field-first-entry',entry)).status,201);assert.equal((await post('/movements','four-field-first-entry',entry)).status,201);
 assert.equal((await get('/products/'+created.body.id+'/balances')).body.total,'1.000');
 assert.equal((await post('/products','four-field-invalid',{...body,description:'Outro sem categoria',categoryId:null})).status,400);
 assert.equal((await post('/products','four-field-invalid-type',{...body,active:'true'})).status,400);
});


test('contrato de erro conserva revisão de duplicatas e correlaciona resposta com log', async () => {
  process.env.INTEGRATION_ENABLED='true';
  const warnings=[];const original=console.warn;console.warn=(s)=>warnings.push(s);
  let r;
  try {r=await post('/products','error-candidates-contract',{description:'Memória ÁUDIO',unit:'unidade',active:true,externalUserId:'0007'});}
  finally {console.warn=original;}
  assert.equal(r.status,409);
  assert.equal(r.body.code,'PRODUCT_CANDIDATES');
  assert.ok(r.body.candidateIds.includes(product));
  assert.match(r.body.requestId,/^[0-9a-f-]{36}$/);
  assert.equal(r.headers['x-request-id'],r.body.requestId);
  assert.ok(warnings.map(s=>JSON.parse(s)).some(x=>x.requestId===r.body.requestId&&x.status===409));
});

test('busca usa mesmo snapshot para saldo e armários mesmo com commit intercalado', async () => {
  process.env.INTEGRATION_ENABLED='true';
  const {ProductService}=require('../dist/backend/products');
  const id=(await db.pool.query("INSERT INTO products(description,unit) VALUES('Snapshot busca exclusivo','unidade') RETURNING id")).rows[0].id;
  const stock=new StockService(db);await stock.opening(actor,id,'2026-01-01',[{locationId:a,quantity:'2'}],'Teste snapshot');
  const original=ProductService.prototype.search;let injected=false;
  ProductService.prototype.search=async function(...args){
    const result=await original.apply(this,args);
    if(!injected){injected=true;await stock.move(actor,movementForSnapshot(id));}
    return result;
  };
  let r;try {r=await get('/products?'+new URLSearchParams({q:id,availability:'positive',status:'ativo'}));}
  finally {ProductService.prototype.search=original;}
  assert.equal(r.status,200);assert.equal(injected,true);
  const p=r.body.items[0];assert.equal(p.quantity,'2.000');
  assert.equal(p.locations.reduce((sum,x)=>sum+Number(x.quantity),0),Number(p.quantity));
  assert.equal((await get('/products/'+id+'/balances')).body.total,'3.000');
});
function movementForSnapshot(id){return {productId:id,kind:'entrada',quantity:'1',eventDate:'2026-01-03',locationId:a,reason:'uso_interno'};}

test('saldo usa mesmo snapshot para metadados e distribuição durante alteração concorrente', async () => {
  process.env.INTEGRATION_ENABLED='true';
  const id=(await db.pool.query("INSERT INTO products(description,unit) VALUES('Snapshot metadados exclusivo','unidade') RETURNING id")).rows[0].id;
  const stock=new StockService(db);await stock.opening(actor,id,'2026-01-01',[{locationId:a,quantity:'1'}],'Teste snapshot');
  const original=StockService.prototype.balances;let injected=false;
  StockService.prototype.balances=async function(...args){
    const result=await original.apply(this,args);
    if(!injected){injected=true;await db.pool.query("UPDATE locations SET name='Nome concorrente sintético' WHERE id=$1",[a]);}
    return result;
  };
  const name=(await db.pool.query('SELECT name FROM locations WHERE id=$1',[a])).rows[0].name;
  let r;try {r=await get('/products/'+id+'/balances');}
  finally {StockService.prototype.balances=original;await db.pool.query('UPDATE locations SET name=$2 WHERE id=$1',[a,name]);}
  assert.equal(r.status,200);assert.equal(injected,true);
  assert.equal(r.body.locations[0].name,name);
});


test('erros de leitura distinguem dependência indisponível e falha interna sem lista fictícia', async () => {
  process.env.INTEGRATION_ENABLED='true';
  const {ProductService}=require('../dist/backend/products');const original=ProductService.prototype.matches;
  try {
    for(const [dbCode,status,code] of [['ECONNREFUSED',503,'DEPENDENCY_UNAVAILABLE'],['XX000',500,'INTERNAL_ERROR']]){
      ProductService.prototype.matches=async()=>{throw Object.assign(new Error('synthetic-private-sql-token'),{code:dbCode});};
      const r=await get('/product-matches?description=Equipamento');
      assert.equal(r.status,status);assert.equal(r.body.code,code);
      assert.match(r.body.requestId,/^[0-9a-f-]{36}$/);assert.equal(r.headers['x-request-id'],r.body.requestId);
      assert.equal(r.body.items,undefined);assert.equal(JSON.stringify(r.body).includes('synthetic-private'),false);
    }
  } finally {ProductService.prototype.matches=original;}
});

test('snapshot inclui contagem e página mesmo com inativação entre consultas', async () => {
  process.env.INTEGRATION_ENABLED='true';
  const {ProductService}=require('../dist/backend/products');
  const id=(await db.pool.query("INSERT INTO products(description,unit) VALUES('Snapshot página exclusivo','unidade') RETURNING id")).rows[0].id;
  await new StockService(db).opening(actor,id,'2026-01-01',[{locationId:a,quantity:'1'}],'Snapshot página');
  const {Pool}=require('pg');const original=Pool.prototype.connect;let injected=false;
  // Decorar conexões reais: altera por outra conexão após SELECT da página, antes do COUNT.
  Pool.prototype.connect=async function(...args){
    if(args.length)return original.apply(this,args);
    const c=await original.apply(this,args);const query=c.query;
    c.query=async function(...qa){
      const result=await query.apply(this,qa);
      if(!injected&&typeof qa[0]==='string'&&qa[0].startsWith('SELECT p.*')&&qa[1]?.[0]===id){
        injected=true;await db.pool.query('UPDATE products SET active=false WHERE id=$1',[id]);
      }
      return result;
    };
    const release=c.release;c.release=function(...ra){c.query=query;return release.apply(this,ra);};return c;
  };
  let r;try {r=await get('/products?'+new URLSearchParams({q:id,status:'ativo',availability:'positive'}));}
  finally {Pool.prototype.connect=original;}
  assert.equal(r.status,200);assert.equal(injected,true);assert.equal(r.body.items.length,1);assert.equal(r.body.total,1);
  assert.equal((await get('/products?'+new URLSearchParams({q:id,status:'ativo'}))).body.total,0);
});

test('falha após lançamento reverte ledger, auditoria e resultado idempotente juntos', async () => {
  process.env.INTEGRATION_ENABLED='true';
  const id=(await db.pool.query("INSERT INTO products(description,unit) VALUES('Rollback integração exclusivo','unidade') RETURNING id")).rows[0].id;
  const stock=new StockService(db);await stock.opening(actor,id,'2026-01-01',[{locationId:a,quantity:'1'}],'Rollback fixture');
  const previous=(await db.pool.query('SELECT count(*)::int n FROM movements WHERE product_id=$1',[id])).rows[0].n;
  await db.pool.query("CREATE FUNCTION synthetic_fail_integration_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='integracao_movement' THEN RAISE EXCEPTION 'synthetic-private-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_fail_integration_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_fail_integration_audit()");
  let r;try {r=await post('/movements','rollback-complete',movement({productId:id}));}
  finally {await db.pool.query('DROP TRIGGER synthetic_fail_integration_audit ON audit_log; DROP FUNCTION synthetic_fail_integration_audit()');}
  assert.equal(r.status,500);assert.equal(JSON.stringify(r.body).includes('synthetic-private'),false);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM movements WHERE product_id=$1',[id])).rows[0].n,previous);
  assert.equal((await get('/products/'+id+'/balances')).body.total,'1.000');assert.equal((await get('/operations/rollback-complete')).status,404);
  assert.equal((await post('/movements','rollback-complete',movement({productId:id}))).status,201);
});

test('resultado em andamento não aparece antes do commit e recuperação usa mesma chave', async () => {
  process.env.INTEGRATION_ENABLED='true';
  const expired=await credential('expired-synthetic');await db.pool.query("UPDATE integration_clients SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
  assert.equal((await get('/products',expired.token)).status,401);
  const id=(await db.pool.query("INSERT INTO products(description,unit) VALUES('Recuperação exclusiva','unidade') RETURNING id")).rows[0].id;
  const stock=new StockService(db);await stock.opening(actor,id,'2026-01-01',[{locationId:a,quantity:'1'}],'Recuperação fixture');
  let unlock,reached;const barrier=new Promise(r=>unlock=r);const entered=new Promise(r=>reached=r);
  const original=StockService.prototype.move;
  StockService.prototype.move=async function(...args){const result=await original.apply(this,args);if(args[1].productId===id){reached();await barrier;}return result;};
  const pending=post('/movements','recover-in-progress',movement({productId:id})).then(r=>r);
  let r;try {await entered;assert.equal((await get('/operations/recover-in-progress')).status,404);}
  finally {unlock();r=await pending;StockService.prototype.move=original;}
  assert.equal(r.status,201);
  const result=await get('/operations/recover-in-progress');assert.equal(result.body.result.id,r.body.id);
  assert.equal((await post('/movements','recover-in-progress',movement({productId:id}))).body.id,r.body.id);
  assert.equal((await get('/products/'+id+'/balances')).body.total,'2.000');
});


test('cliente PHP atual consome backend real: vazio, cadastro zero, entrada, replay e falhas', async (t) => {
  const fs=require('node:fs'),path=require('node:path');const {spawn,spawnSync}=require('node:child_process');
  const php=process.env.PHP_BINARY||(process.platform==='win32'?path.resolve('work/php-runtime/bin/php.exe'):'php');
  if(process.platform==='win32'&&!fs.existsSync(php))return t.skip('PHP local indisponível; use PHP_BINARY/PHP_EXTENSION_DIR');
  const ext=process.env.PHP_EXTENSION_DIR||(process.platform==='win32'?path.resolve('work/php-runtime/bin/ext'):null);
  const phpArgs=ext?['-d','extension_dir='+ext,'-d','extension=curl']:[];
  const support=spawnSync(php,[...phpArgs,'-r',"exit(extension_loaded('curl')?0:2);"],{windowsHide:true,timeout:10000});
  if(support.error?.code==='ENOENT'&&!process.env.PHP_BINARY)return t.skip('PHP não disponível neste ambiente; contrato PHP exige runtime local');
  if(support.status===2)return t.skip('PHP/cURL indisponível neste ambiente');
  assert.equal(support.status,0,'Runtime PHP configurado deve funcionar');
  const invoke=mode=>new Promise((resolve,reject)=>{
    const args=[...phpArgs];
    args.push('tests/glpi-api-contract.php');
    const child=spawn(php,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';
    child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
    child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(new Error('Contrato PHP falhou: '+err+out)));
    child.stdin.end(JSON.stringify({url:'http://127.0.0.1:'+app.getHttpServer().address().port+root,token,locationId:a,mode}));
  });
  process.env.INTEGRATION_ENABLED='true';assert.match(await invoke('normal'),/OK/);
  try {process.env.INTEGRATION_ENABLED='false';assert.match(await invoke('disabled'),/OK/);}
  finally {process.env.INTEGRATION_ENABLED='true';}
});


test('funcionário com troca inicial pendente não opera pela credencial técnica',async()=>{
 process.env.INTEGRATION_ENABLED='true';await db.pool.query('UPDATE employees SET must_change_password=true WHERE id=$1',[actor]);
 try{const r=await post('/movements','pending-first-access-actor',movement());assert.equal(r.status,403);assert.equal((await get('/operations/pending-first-access-actor')).status,404);}
 finally{await db.pool.query('UPDATE employees SET must_change_password=false WHERE id=$1',[actor]);}
});
