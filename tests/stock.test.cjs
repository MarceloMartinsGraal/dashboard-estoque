const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Database } = require('../dist/backend/db');
const { migrate } = require('../dist/backend/migrate');
const { StockService } = require('../dist/backend/stock');
let db, stock, actor, locA, locB;
const day = '2026-01-01';
before(async () => {
  assert.ok(
    process.env.TEST_DATABASE_URL,
    'Defina TEST_DATABASE_URL para banco isolado cujo nome termine em _test',
  );
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(url.pathname.endsWith('_test'), 'Banco deve terminar em _test');
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  db = new Database();
  await migrate(db.pool);
  stock = new StockService(db);
  actor = (
    await db.pool.query(
      "INSERT INTO employees(username,name,password_hash) VALUES('stock-test-'||gen_random_uuid(),'Teste','not-a-password') RETURNING id",
    )
  ).rows[0].id;
  locA = (
    await db.pool.query(
      "INSERT INTO locations(code,name) VALUES(gen_random_uuid()::text,'Armário A') RETURNING id",
    )
  ).rows[0].id;
  locB = (
    await db.pool.query(
      "INSERT INTO locations(code,name) VALUES(gen_random_uuid()::text,'Armário B') RETURNING id",
    )
  ).rows[0].id;
});
after(async () => {
  if (db) await db.onModuleDestroy();
});
async function product(unit = 'unidade') {
  return (
    await db.pool.query(
      "INSERT INTO products(description,unit) VALUES('Sintético',$1) RETURNING id",
      [unit],
    )
  ).rows[0].id;
}
function cmd(id, extra = {}) {
  return {
    productId: id,
    kind: 'saida',
    quantity: '1',
    eventDate: day,
    reason: 'uso_interno',
    locationId: locA,
    ...extra,
  };
}
test('sem contagem aprovada a operação permanece bloqueada', async () => {
  const p = await product();
  await assert.rejects(stock.move(actor, cmd(p)), /abertura/i);
});
test('saídas concorrentes disputam saldo de forma atômica', async () => {
  const p = await product();
  await stock.opening(
    actor,
    p,
    day,
    [{ locationId: locA, quantity: '1' }],
    'Contagem física aprovada',
  );
  const results = await Promise.allSettled([
    stock.move(actor, cmd(p)),
    stock.move(actor, cmd(p)),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal((await stock.balances(p)).total, '0.000');
});
test('realocação conserva global e bloqueia saída em armário sem saldo', async () => {
  const p = await product();
  await stock.opening(
    actor,
    p,
    day,
    [{ locationId: locA, quantity: '3' }],
    'Contagem física',
  );
  await stock.move(
    actor,
    cmd(p, { kind: 'realocacao', destinationId: locB, quantity: '2' }),
  );
  const b = await stock.balances(p);
  assert.equal(b.total, '3.000');
  assert.equal(b.locations.find((x) => x.id === locA).quantity, '1.000');
  await assert.rejects(stock.move(actor, cmd(p, { quantity: '2' })), /saldo/i);
});
test('estorno é vinculado, único e sujeito ao saldo disponível', async () => {
  const p = await product();
  await stock.opening(
    actor,
    p,
    day,
    [{ locationId: locA, quantity: '1' }],
    'Contagem',
  );
  const entry = await stock.move(
    actor,
    cmd(p, { kind: 'entrada', quantity: '2' }),
  );
  await stock.move(actor, cmd(p, { quantity: '3' }));
  await assert.rejects(
    stock.reverse(actor, entry.id, day, 'Correção'),
    /saldo/i,
  );
  const exit = (
    await db.pool.query(
      "SELECT id FROM movements WHERE product_id=$1 AND kind='saida'",
      [p],
    )
  ).rows[0];
  const rev = await stock.reverse(actor, exit.id, day, 'Correção documentada');
  assert.equal(rev.reversal_of, exit.id);
  await assert.rejects(
    stock.reverse(actor, exit.id, day, 'Repetido'),
    /estorn/i,
  );
  assert.equal((await stock.balances(p)).total, '3.000');
});
test('quantidade, motivo, chamado e justificativa são obrigatórios conforme regra', async () => {
  const p = await product();
  await stock.opening(
    actor,
    p,
    day,
    [{ locationId: locA, quantity: '2' }],
    'Contagem',
  );
  for (const extra of [
    { quantity: '0' },
    { quantity: '1.5' },
    { reason: '' },
    { reason: 'chamado' },
    { kind: 'ajuste_saida' },
    { reason: 'outro' },
  ])
    await assert.rejects(stock.move(actor, cmd(p, extra)));
});
test('precisão em metros e estorno de realocação preservam soma', async () => {
  const p = await product('metro');
  await stock.opening(
    actor,
    p,
    day,
    [{ locationId: locA, quantity: '0.3' }],
    'Contagem',
  );
  const m = await stock.move(
    actor,
    cmd(p, { kind: 'realocacao', quantity: '0.1', destinationId: locB }),
  );
  await stock.reverse(actor, m.id, day, 'Armário incorreto');
  assert.equal((await stock.balances(p)).total, '0.300');
  assert.equal(
    (await stock.balances(p)).locations.find((x) => x.id === locA).quantity,
    '0.300',
  );
});
test('retroatividade não pode gerar fechamento negativo', async () => {
  const p = await product();
  await stock.opening(
    actor,
    p,
    day,
    [{ locationId: locA, quantity: '1' }],
    'Contagem',
  );
  await stock.move(
    actor,
    cmd(p, { kind: 'entrada', quantity: '5', eventDate: '2026-01-03' }),
  );
  await assert.rejects(
    stock.move(actor, cmd(p, { quantity: '2', eventDate: '2026-01-02' })),
    /saldo/i,
  );
  assert.equal((await stock.balances(p)).total, '6.000');
});

test('duas aprovações concorrentes não duplicam abertura', async () => {
  const p = await product();
  const results = await Promise.allSettled([
    stock.opening(
      actor,
      p,
      day,
      [{ locationId: locA, quantity: '1' }],
      'Conferência',
    ),
    stock.opening(
      actor,
      p,
      day,
      [{ locationId: locA, quantity: '1' }],
      'Conferência',
    ),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal((await stock.balances(p)).total, '1.000');
});
test('dois estornos simultâneos aplicam o inverso uma única vez', async () => {
  const p = await product();
  await stock.opening(
    actor,
    p,
    day,
    [{ locationId: locA, quantity: '2' }],
    'Conferência',
  );
  const m = await stock.move(actor, cmd(p));
  const results = await Promise.allSettled([
    stock.reverse(actor, m.id, day, 'Correção'),
    stock.reverse(actor, m.id, day, 'Correção'),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal((await stock.balances(p)).total, '2.000');
});
test('ajustes exigem justificativa, preservam histórico e não aceitam saldo negativo', async () => {
  const p = await product();
  await stock.opening(
    actor,
    p,
    day,
    [{ locationId: locA, quantity: '0' }],
    'Conferência de saldo zero',
  );
  await stock.move(
    actor,
    cmd(p, {
      kind: 'ajuste_entrada',
      quantity: '2',
      reason: 'correcao_estoque',
      justification: 'Contagem de conferência',
    }),
  );
  const m = await stock.move(
    actor,
    cmd(p, {
      kind: 'ajuste_saida',
      justification: 'Retirada para conferência',
    }),
  );
  assert.equal((await stock.balances(p)).total, '1.000');
  await assert.rejects(
    db.pool.query('UPDATE movements SET quantity=9000 WHERE id=$1', [m.id]),
    /imutável/,
  );
  await assert.rejects(
    stock.move(
      actor,
      cmd(p, {
        kind: 'ajuste_saida',
        quantity: '2',
        justification: 'Conferência',
      }),
    ),
    /saldo/i,
  );
});

test('estorno não devolve saldo para armário inativado', async () => {
  const p = await product();
  const loc = (
    await db.pool.query(
      "INSERT INTO locations(code,name) VALUES(gen_random_uuid()::text,'Armário temporário') RETURNING id",
    )
  ).rows[0].id;
  await stock.opening(
    actor,
    p,
    day,
    [{ locationId: loc, quantity: '1' }],
    'Conferência',
  );
  const m = await stock.move(actor, cmd(p, { locationId: loc }));
  await db.pool.query('UPDATE locations SET active=false WHERE id=$1', [loc]);
  await assert.rejects(
    stock.reverse(actor, m.id, day, 'Correção'),
    /armário|inativo/i,
  );
  assert.equal((await stock.balances(p)).total, '0.000');
});

test('localização não informada aceita seu identificador PostgreSQL preservado', async () => {
  const p = await product();
  const unknown = '00000000-0000-0000-0000-000000000001';
  await stock.opening(
    actor,
    p,
    day,
    [{ locationId: unknown, quantity: '1' }],
    'Conferência explícita sem localização informada',
  );
  assert.equal(
    (await stock.balances(p)).locations.find((x) => x.id === unknown).quantity,
    '1.000',
  );
});
