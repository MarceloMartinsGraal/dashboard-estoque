const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Database } = require('../dist/backend/db');
const { migrate } = require('../dist/backend/migrate');
const { StockService } = require('../dist/backend/stock');
const { queryHistory } = require('../dist/backend/history');
const { CatalogController } = require('../dist/backend/catalog');
let db, stock, actor, category, subcategory, p, a, b;
const unknown = '00000000-0000-0000-0000-000000000001';
before(async () => {
  assert.ok(new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  db = new Database();
  await migrate(db.pool);
  stock = new StockService(db);
  actor = (
    await db.pool.query(
      "INSERT INTO employees(username,name,password_hash) VALUES('history-test','Funcionário de histórico','synthetic') RETURNING id",
    )
  ).rows[0].id;
  category = (
    await db.pool.query(
      "INSERT INTO categories(name) VALUES('Histórico categoria') RETURNING id",
    )
  ).rows[0].id;
  subcategory = (
    await db.pool.query(
      "INSERT INTO subcategories(category_id,name) VALUES($1,'Histórico subcategoria') RETURNING id",
      [category],
    )
  ).rows[0].id;
  p = (
    await db.pool.query(
      "INSERT INTO products(description,source,legacy_id,unit,category_id,subcategory_id) VALUES('Câmera ÁUDIO','history-fixture',7001,'unidade',$1,$2) RETURNING id",
      [category, subcategory],
    )
  ).rows[0].id;
  [a, b] = (
    await db.pool.query(
      "INSERT INTO locations(code,name) VALUES('H-A','Histórico A'),('H-B','Histórico B') RETURNING id",
    )
  ).rows.map((r) => r.id);
  await stock.opening(
    actor,
    p,
    '2026-01-01',
    [{ locationId: a, quantity: '10' }],
    'Contagem',
  );
  await stock.move(actor, {
    productId: p,
    kind: 'entrada',
    quantity: '2',
    eventDate: '2026-01-04',
    reason: 'chamado',
    ticket: '00042',
    locationId: b,
  });
  const exit = await stock.move(actor, {
    productId: p,
    kind: 'saida',
    quantity: '1',
    eventDate: '2026-01-03',
    reason: 'uso_interno',
    locationId: a,
  });
  await stock.move(actor, {
    productId: p,
    kind: 'realocacao',
    quantity: '1',
    eventDate: '2026-01-05',
    reason: 'uso_interno',
    locationId: a,
    destinationId: b,
  });
  await stock.reverse(actor, exit.id, '2026-01-06', 'Estorno sintético');
  const batch = (
    await db.pool.query(
      "INSERT INTO import_batches(source,checksum,created_by,payload,preview) VALUES('history-fixture','synthetic',$1,'{}','{}') RETURNING id",
      [actor],
    )
  ).rows[0].id;
  await db.pool.query(
    "INSERT INTO legacy_movements(batch_id,source,legacy_id,product_id,kind,quantity,event_date,reason,ticket,origin,observation,date_estimated,date_original,conversion_rule,zero_evidence) VALUES($1,'history-fixture',81,$2,'saida',1000,'2020-01-01','legado_nao_informado','00007','Saidas!linha 8','Evidência preservada',true,'01/01/20','Regra histórica',false)",
    [batch, p],
  );
});
after(async () => {
  if (db) await db.onModuleDestroy();
});
test('histórico separa entradas/saídas, realocação e abertura; estorno tem direção inversa', async () => {
  const entries = await queryHistory(db, { flow: 'entrada', productId: p });
  assert.deepEqual(
    entries.items.map((x) => x.kind),
    ['estorno', 'entrada'],
  );
  assert.equal(entries.total, 2);
  assert.equal(
    (await queryHistory(db, { flow: 'saida', productId: p })).total,
    1,
  );
  assert.equal(
    (await queryHistory(db, { flow: 'realocacao', productId: p })).total,
    1,
  );
  assert.equal(
    (await queryHistory(db, { flow: 'abertura', productId: p })).total,
    1,
  );
});
test('filtros combinam acentos, código, categoria, subcategoria, armário, data, motivo, funcionário e chamado', async () => {
  const r = await queryHistory(db, {
    flow: 'entrada',
    q: 'camera audio',
    categoryId: category,
    subcategoryId: subcategory,
    locationId: b,
    dateFrom: '2026-01-04',
    dateTo: '2026-01-04',
    reason: 'chamado',
    employeeId: actor,
    ticket: '00042',
  });
  assert.equal(r.total, 1);
  assert.equal(r.items[0].ticket, '00042');
  assert.equal(r.items[0].quantity, '2.000');
  assert.equal(
    (
      await queryHistory(db, {
        flow: 'entrada',
        q: '7001',
        locationId: a,
        reason: 'chamado',
      })
    ).total,
    0,
  );
  assert.equal((await queryHistory(db, { flow: 'entrada', q: p })).total, 2);
});
test('paginação ocorre após filtrar e ordena pela data do evento com desempate estável', async () => {
  const one = await queryHistory(db, {
      flow: 'entrada',
      productId: p,
      limit: 1,
      page: 1,
    }),
    two = await queryHistory(db, {
      flow: 'entrada',
      productId: p,
      limit: 1,
      page: 2,
    });
  assert.equal(one.total, 2);
  assert.equal(two.total, 2);
  assert.equal(one.items[0].event_date, '2026-01-06');
  assert.equal(two.items[0].event_date, '2026-01-04');
  assert.notEqual(one.items[0].id, two.items[0].id);
  assert.deepEqual(
    await queryHistory(db, {
      flow: 'entrada',
      productId: p,
      limit: 1,
      page: 2,
    }),
    two,
  );
});
test('legado usa localização não informada, preserva metadados e não inventa funcionário/horário', async () => {
  const r = await queryHistory(db, {
    flow: 'saida',
    regime: 'legado',
    locationId: unknown,
    ticket: '00007',
    productId: p,
  });
  assert.equal(r.total, 1);
  const m = r.items[0];
  assert.equal(m.author, 'importação legada');
  assert.equal(m.recorded_at, null);
  assert.equal(m.origin, 'Saidas!linha 8');
  assert.equal(m.date_original, '01/01/20');
  assert.equal(m.date_estimated, true);
  assert.equal(
    (
      await queryHistory(db, {
        flow: 'saida',
        regime: 'legado',
        employeeId: actor,
        productId: p,
      })
    ).total,
    0,
  );
});
test('datas invertidas e filtros inesperados são rejeitados', async () => {
  await assert.rejects(
    queryHistory(db, { dateFrom: '2026-01-05', dateTo: '2026-01-01' }),
  );
  await assert.rejects(queryHistory(db, { balance: '999' }));
});
test('catálogo oferece todos os armários ativos, inclusive além de cem e sem associação', async () => {
  const ids = (
    await db.pool.query(
      "INSERT INTO locations(code,name) SELECT 'H-MANY-'||n,'Armário '||n FROM generate_series(1,125) n RETURNING id",
    )
  ).rows;
  const c = new CatalogController(db);
  const all = await c.catalog();
  assert.ok(ids.every((x) => all.locations.some((y) => y.id === x.id)));
  const entry = await stock.move(actor, {
    productId: p,
    kind: 'entrada',
    quantity: '1',
    eventDate: '2026-01-07',
    reason: 'recebimento',
    locationId: ids[124].id,
  });
  assert.ok(entry.id);
  assert.equal(
    (await stock.balances(p)).locations.find((x) => x.id === ids[124].id)
      .quantity,
    '1.000',
  );
});
