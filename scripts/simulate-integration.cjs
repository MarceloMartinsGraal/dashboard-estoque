// Somente fixtures sintéticas em PostgreSQL loopback descartável _test.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { Database } = require('../dist/backend/db');
const { migrate } = require('../dist/backend/migrate');
const { createApp } = require('../dist/backend/app');
(async () => {
  let db, app, client;
  try {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(
      url.pathname.endsWith('_test') &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
      'Exige TEST_DATABASE_URL loopback com banco terminado em _test',
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = randomBytes(32).toString('hex');
    process.env.PUBLIC_ORIGIN = 'http://localhost:5173';
    process.env.INTEGRATION_ENABLED = 'true';
    db = new Database();
    await migrate(db.pool);
    const instance = 'glpi-simulado-' + randomUUID(),
      user = '0007',
      ticket = '000042';
    const actor = (
      await db.pool.query(
        'INSERT INTO employees(username,name,password_hash) VALUES($1,$2,$3) RETURNING id',
        [
          'simulated-' + randomUUID(),
          'Funcionário sintético de demonstração',
          'login-disabled',
        ],
      )
    ).rows[0].id;
    const secret = randomBytes(32).toString('hex');
    client = (
      await db.pool.query(
        "INSERT INTO integration_clients(instance_id,name,token_hash,scopes,active,expires_at) VALUES($1,'Simulação local',$2,ARRAY['read','products:write','movements:write'],true,now()+interval '15 minutes') RETURNING id",
        [instance, createHash('sha256').update(secret).digest('hex')],
      )
    ).rows[0].id;
    await db.pool.query(
      'INSERT INTO external_employee_links(instance_id,external_user_id,employee_id) VALUES($1,$2,$3)',
      [instance, user, actor],
    );
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    const base =
      'http://127.0.0.1:' +
      app.getHttpServer().address().port +
      '/api/integration/v1';
    async function call(path, body, key) {
      const r = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: 'Bearer ' + client + '.' + secret,
          ...(body
            ? { 'Content-Type': 'application/json', 'Idempotency-Key': key }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.ok(r.ok, 'HTTP sintético falhou: ' + r.status);
      return r.json();
    }
    const product = await call(
      '/products',
      {
        description: 'Memória sintética ' + randomUUID(),
        active: true,
        externalUserId: user,
      },
      'product',
    );
    const location = '00000000-0000-0000-0000-000000000001',
      day = (await call('/products/'+product.id+'/balances')).openingDate;
    const body = {
      productId: product.id,
      kind: 'entrada',
      quantity: '2',
      eventDate: day,
      locationId: location,
      reason: 'chamado',
      ticketId: ticket,
      externalUserId: user,
    };
    const entry = await call('/movements', body, 'entry');
    assert.deepEqual(await call('/movements', body, 'entry'), entry);
    const exit = await call(
      '/movements',
      { ...body, kind: 'saida', quantity: '1' },
      'exit',
    );
    assert.deepEqual((await call('/operations/exit')).result, exit);
    const balance = await call('/products/' + product.id + '/balances');
    assert.equal(balance.total, '1.000');
    const history = await call('/tickets/' + ticket + '/movements');
    assert.equal(history.total, 2);
    const search = await call('/products?q=memoria');
    assert.ok(search.items.some((p) => p.id === product.id));
    console.log(
      JSON.stringify(
        {
          status: 'dashboard preparado para integração',
          simulatedOnly: true,
          entry: entry.id,
          exit: exit.id,
          balance: balance.total,
          history: history.total,
        },
        null,
        2,
      ),
    );
  } finally {
    if (db && client)
      await db.pool.query(
        'UPDATE integration_clients SET active=false WHERE id=$1',
        [client],
      );
    if (app) await app.close();
    if (db) await db.onModuleDestroy();
  }
})().catch(() => {
  console.error(
    'Simulação falhou; verifique build e TEST_DATABASE_URL local _test. Nenhuma credencial foi registrada.',
  );
  process.exitCode = 1;
});
