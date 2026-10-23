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
  http.get(root + path).set('Authorization', 'Bearer ' + t);
const post = (path, key, body, t = token) =>
  http
    .post(root + path)
    .set('Authorization', 'Bearer ' + t)
    .set('Idempotency-Key', key)
    .send(body);
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
test('integração desabilitada por padrão, autenticação obrigatória e CSRF pessoal preservado', async () => {
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
