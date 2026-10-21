const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const argon = require('argon2');
const { Database } = require('../dist/backend/db');
const { migrate } = require('../dist/backend/migrate');
const { createApp } = require('../dist/backend/app');
let db, app, agent, other, employee, csrf;
const origin = 'http://localhost:5173';
before(async () => {
  assert.ok(process.env.TEST_DATABASE_URL);
  assert.ok(new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.SESSION_SECRET =
    'synthetic-test-secret-with-at-least-32-characters';
  process.env.PUBLIC_ORIGIN = origin;
  process.env.NODE_ENV = 'test';
  db = new Database();
  await migrate(db.pool);
  employee = (
    await db.pool.query(
      'INSERT INTO employees(username,name,password_hash,manages_accounts) VALUES($1,$2,$3,true) RETURNING id',
      [
        'http-test',
        'Funcionário teste',
        await argon.hash('synthetic-test-password', { type: argon.argon2id }),
      ],
    )
  ).rows[0].id;
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  agent = request.agent(app.getHttpServer());
  other = request.agent(app.getHttpServer());
});
after(async () => {
  if (app) await app.close();
  if (db) await db.onModuleDestroy();
});
async function token(a) {
  return (await a.get('/api/auth/csrf')).body.csrf;
}
async function login(a, password = 'synthetic-test-password') {
  const csrf = await token(a);
  return a
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('x-csrf-token', csrf)
    .send({ username: 'http-test', password });
}
test('sem login não acessa catálogo, histórico ou importação', async () => {
  for (const p of ['/api/products', '/api/history', '/api/imports'])
    assert.equal((await other.get(p)).status, 401);
});
test('login rejeita CSRF e campos extras', async () => {
  assert.equal(
    (
      await other
        .post('/api/auth/login')
        .send({ username: 'http-test', password: 'synthetic-test-password' })
    ).status,
    403,
  );
  const csrf = await token(other);
  assert.equal(
    (
      await other
        .post('/api/auth/login')
        .set('Origin', origin)
        .set('x-csrf-token', csrf)
        .send({
          username: 'http-test',
          password: 'synthetic-test-password',
          admin: true,
        })
    ).status,
    400,
  );
});
test('login renova sessão e token, cookie é HttpOnly e logout revoga', async () => {
  const old = await token(agent);
  const r = await login(agent);
  assert.equal(r.status, 201);
  assert.notEqual(r.body.csrf, old);
  assert.match(r.headers['set-cookie'].join(';'), /HttpOnly/i);
  assert.equal(
    (await agent.get('/api/auth/me')).body.name,
    'Funcionário teste',
  );
  assert.equal(
    (
      await agent
        .post('/api/auth/logout')
        .set('Origin', origin)
        .set('x-csrf-token', old)
        .send({})
    ).status,
    403,
  );
  assert.equal(
    (
      await agent
        .post('/api/auth/logout')
        .set('Origin', origin)
        .set('x-csrf-token', r.body.csrf)
        .send({})
    ).status,
    201,
  );
  assert.equal((await agent.get('/api/products')).status, 401);
});
test('inativar funcionário invalida acesso de sessões existentes', async () => {
  assert.equal((await login(agent)).status, 201);
  await db.pool.query('UPDATE employees SET active=false WHERE id=$1', [
    employee,
  ]);
  assert.equal((await agent.get('/api/products')).status, 401);
  await db.pool.query('UPDATE employees SET active=true WHERE id=$1', [
    employee,
  ]);
});
test('falhas de login têm resposta genérica e limitação persistida', async () => {
  for (let i = 0; i < 6; i++) {
    const r = await login(other, 'senha-incorreta');
    assert.equal(r.status, i < 5 ? 401 : 429);
    if (i < 5) assert.equal(r.body.message, 'Credenciais inválidas');
  }
  assert.ok(
    Number(
      (await db.pool.query('SELECT count(*) FROM login_attempts')).rows[0]
        .count,
    ) > 0,
  );
});

test('cadastros auditados rejeitam saldo direto, metro e movem saldo pelo armário do cadastro', async () => {
  const a = request.agent(app.getHttpServer());
  await db.pool.query('DELETE FROM login_attempts');
  const logged = await login(a);
  assert.equal(logged.status, 201);
  const csrf = logged.body.csrf;
  const post = (path, body) =>
    a
      .post('/api/' + path)
      .set('Origin', origin)
      .set('x-csrf-token', csrf)
      .send(body);
  const catalog = await a.get('/api/catalog');
  assert.equal(catalog.status, 200);
  const location = await post('locations', {
    code: 'HTTP-A',
    name: 'Armário HTTP',
    active: true,
  });
  assert.equal(location.status, 201);
  const product = await post('products', {
    description: 'Produto HTTP',
    unit: 'unidade',
    active: true,
    categoryId: null,
    subcategoryId: null,
  });
  assert.equal(product.status, 201);
  assert.equal(
    (
      await post('products', {
        description: 'Proibido',
        unit: 'unidade',
        active: true,
        balance: '10',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post('products/' + product.body.id + '/opening', {
        eventDate: '2026-01-01',
        counts: [{ locationId: location.body.id, quantity: '2' }],
        justification: 'Conferência física',
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post('products', {
        id: product.body.id,
        description: 'Produto HTTP',
        unit: 'metro',
        active: true,
        categoryId: null,
        subcategoryId: null,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post('locations', {
        id: location.body.id,
        code: 'HTTP-A',
        name: 'Armário HTTP',
        active: false,
      })
    ).status,
    409,
  );
  const other = await post('locations', {
    code: 'HTTP-B',
    name: 'Armário HTTP B',
    active: true,
  });
  assert.equal(
    (
      await post('products', {
        id: product.body.id,
        description: 'Produto HTTP',
        active: true,
        locationId: other.body.id,
      })
    ).status,
    201,
  );
  const balances = (
    await a.get('/api/products/' + product.body.id + '/balances')
  ).body;
  assert.equal(balances.total, '2.000');
  assert.deepEqual(
    balances.locations
      .filter((l) => l.quantity !== '0.000')
      .map((l) => [l.id, l.quantity]),
    [[other.body.id, '2.000']],
  );
  assert.ok((await a.get('/api/audit')).body.length >= 2);
});

test('token CSRF malformado é rejeitado como 403, sem erro interno', async () => {
  const a = request.agent(app.getHttpServer());
  await token(a);
  const response = await a
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('x-csrf-token', 'é'.repeat(64))
    .send({ username: 'http-test', password: 'irrelevante' });
  assert.equal(response.status, 403);
});

test('responsável revogado enquanto aguarda lock não administra contas', async () => {
  await db.pool.query('DELETE FROM login_attempts');
  await db.pool.query(
    'UPDATE employees SET manages_accounts=true WHERE id=$1',
    [employee],
  );
  const a = request.agent(app.getHttpServer());
  const logged = await login(a);
  assert.equal(logged.status, 201);
  const blocker = await db.pool.connect();
  let pending;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(742106)');
    pending = a
      .post('/api/employees')
      .set('Origin', origin)
      .set('x-csrf-token', logged.body.csrf)
      .send({
        username: 'unauthorized-created',
        name: 'Não deve criar',
        password: 'synthetic-password-only',
        active: true,
        managesAccounts: true,
      })
      .then((r) => r);
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const locks = await db.pool.query(
        "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=742106 AND NOT granted",
      );
      if (locks.rowCount) {
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(waiting, true, 'Requisição deve estar aguardando lock');
    await db.pool.query(
      'UPDATE employees SET manages_accounts=false WHERE id=$1',
      [employee],
    );
    await blocker.query('COMMIT');
    assert.equal((await pending).status, 403);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*) FROM employees WHERE username='unauthorized-created'",
        )
      ).rows[0].count,
      '0',
    );
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await db.pool.query(
      'UPDATE employees SET manages_accounts=true WHERE id=$1',
      [employee],
    );
  }
});

test('sessão salva tardiamente após troca de senha permanece revogada', async () => {
  await db.pool.query('DELETE FROM login_attempts');
  const a = request.agent(app.getHttpServer());
  const logged = await login(a);
  assert.equal(logged.status, 201);
  const raw = decodeURIComponent(
    logged.headers['set-cookie'][0].split(';')[0].split('=').slice(1).join('='),
  );
  const sid = raw.slice(2, raw.lastIndexOf('.'));
  const old = (
    await db.pool.query('SELECT * FROM sessions WHERE sid=$1', [sid])
  ).rows[0];
  assert.ok(old);
  const update = await a
    .post('/api/employees')
    .set('Origin', origin)
    .set('x-csrf-token', logged.body.csrf)
    .send({
      id: employee,
      username: 'http-test',
      name: 'Funcionário teste',
      password: 'new-synthetic-password',
      active: true,
      managesAccounts: true,
    });
  assert.equal(update.status, 201);
  await db.pool.query(
    'INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,$3) ON CONFLICT(sid) DO UPDATE SET sess=EXCLUDED.sess,expire=EXCLUDED.expire',
    [sid, JSON.stringify(old.sess), old.expire],
  );
  assert.equal((await a.get('/api/auth/me')).status, 401);
});

test('cadastro de unidades permite nome mas bloqueia conversão e precisão arbitrária', async () => {
  await db.pool.query('DELETE FROM login_attempts');
  const a = request.agent(app.getHttpServer());
  const logged = await login(a, 'new-synthetic-password');
  assert.equal(logged.status, 201);
  const post = (d) =>
    a
      .post('/api/units')
      .set('Origin', origin)
      .set('x-csrf-token', logged.body.csrf)
      .send(d);
  assert.equal((await post({ code: 'unidade', name: 'Unidade' })).status, 201);
  assert.equal(
    (await post({ code: 'unidade', name: 'Unidade', precision: 6 })).status,
    400,
  );
  assert.equal((await post({ code: 'metro', name: 'Metro' })).status, 400);
  assert.equal((await post({ code: 'caixa', name: 'Caixa' })).status, 400);
});
