const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { parseLegacy, ImportService } = require('../dist/backend/imports');
const { Database } = require('../dist/backend/db');
const { migrate } = require('../dist/backend/migrate');
let db, service, actor;
function data() {
  return {
    categorias: [{ nome: 'Rede', produtos: 1 }],
    produtos: [
      {
        id: 341,
        descricao: 'Produto legado original',
        categoria: 'Rede',
        subcategoria: null,
        unidade: 'unidade',
        ativo: true,
      },
    ],
    movimentacoes: [
      {
        id: 1,
        tipo: 'entrada',
        produto_id: 341,
        data: '2020-01-01',
        quantidade: 2,
        valor_unitario: 123.45,
        chamado: null,
        motivo: null,
        observacao: null,
        data_estimada: false,
        origem: 'Entradas!linha 2',
      },
      {
        id: 2,
        tipo: 'saida',
        produto_id: 341,
        data: '2020-01-02',
        quantidade: 3,
        valor_unitario: 99,
        chamado: '00042',
        motivo: 'chamado',
        data_estimada: true,
        origem: 'Saidas!linha 3',
      },
      {
        id: 3,
        tipo: 'entrada',
        produto_id: 341,
        data: '2020-01-03',
        quantidade: 0,
        valor_unitario: 0,
        motivo: null,
        data_estimada: false,
      },
    ],
    revisar: { itens: [] },
  };
}
before(async () => {
  assert.ok(process.env.TEST_DATABASE_URL);
  assert.ok(new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  db = new Database();
  await migrate(db.pool);
  service = new ImportService(db);
  actor = (
    await db.pool.query(
      "INSERT INTO employees(username,name,password_hash) VALUES('import-test','Teste','none') RETURNING id",
    )
  ).rows[0].id;
});
after(async () => {
  if (db) await db.onModuleDestroy();
});
test('prévia separa zeros, financeiros e saldo legado negativo', () => {
  const p = parseLegacy(JSON.stringify(data()));
  assert.equal(p.summary.counts.products, 1);
  assert.equal(p.summary.counts.movements, 3);
  assert.equal(p.summary.counts.zeroEvidence, 1);
  assert.equal(p.summary.balances[0].quantity, '-1.000');
  assert.equal(p.summary.unitTotals.unidade, '-1.000');
  assert.equal(p.payload.movements[0].reason, 'legado_nao_informado');
  assert.equal(p.payload.movements[1].ticket, '00042');
  assert.equal(JSON.stringify(p).includes('valor_unitario'), false);
  assert.equal(JSON.stringify(p).includes('123.45'), false);
});
test('JSON inválido, chaves repetidas, IDs repetidos e referências órfãs são rejeitados', () => {
  assert.throws(() => parseLegacy('{"produtos":[],"produtos":[]}'));
  for (const change of [
    (d) => d.produtos.push({ ...d.produtos[0] }),
    (d) => (d.movimentacoes[0].produto_id = 999),
    (d) => (d.movimentacoes[0].quantidade = -1),
    (d) => (d.movimentacoes[0].data = '2020-02-31'),
    (d) => (d.produtos[0].unidade = 'caixa'),
  ]) {
    const d = data();
    change(d);
    assert.throws(() => parseLegacy(JSON.stringify(d)));
  }
});
test('prévia não importa; confirmação repetida e arquivo reordenado não duplicam nem abrem saldo', async () => {
  const source = JSON.stringify(data());
  const batch = await service.preview(actor, source);
  assert.equal(
    (
      await db.pool.query(
        "SELECT count(*) FROM products WHERE source='graal-estoque'",
      )
    ).rows[0].count,
    '0',
  );
  await assert.rejects(service.confirm(actor, batch.id, false));
  const confirmed = await service.confirm(actor, batch.id, true);
  assert.equal(confirmed.result.products.imported, 1);
  assert.equal(confirmed.result.movements.imported, 3);
  assert.equal(confirmed.result.movements.zeroEvidence, 1);
  const repeated = await service.confirm(actor, batch.id, true);
  assert.equal(repeated.result.movements.imported, 0);
  assert.equal(repeated.result.movements.existing, 3);
  const again = await service.preview(actor, source);
  assert.equal(again.preview.report.movements.existing, 3);
  assert.equal(again.preview.result.movements.imported, 3);
  const reordered = data();
  reordered.movimentacoes.reverse();
  const next = await service.preview(actor, JSON.stringify(reordered));
  const same = await service.confirm(actor, next.id, true);
  assert.equal(same.result.products.existing, 1);
  assert.equal(same.result.movements.existing, 3);
  const product = (
    await db.pool.query(
      "SELECT * FROM products WHERE source='graal-estoque' AND legacy_id=341",
    )
  ).rows[0];
  assert.equal(product.original_description, 'Produto legado original');
  assert.equal(product.opening_date, null);
  assert.equal(
    (
      await db.pool.query(
        'SELECT count(*) FROM legacy_movements WHERE product_id=$1',
        [product.id],
      )
    ).rows[0].count,
    '3',
  );
  assert.equal(
    (
      await db.pool.query(
        'SELECT count(*) FROM movements WHERE product_id=$1',
        [product.id],
      )
    ).rows[0].count,
    '0',
  );
  const rows = (
    await db.pool.query(
      'SELECT * FROM legacy_movements WHERE product_id=$1 ORDER BY legacy_id',
      [product.id],
    )
  ).rows;
  assert.equal(rows[2].zero_evidence, true);
  assert.equal(rows[0].author_label, 'importação legada');
});
test('mesmo ID legado com conteúdo diferente é bloqueado sem sobrescrever', async () => {
  const d = data();
  d.produtos[0].descricao = 'Alteração silenciosa';
  const b = await service.preview(actor, JSON.stringify(d));
  assert.equal(b.preview.report.products.conflicting, 1);
  assert.match(b.preview.report.issues[0].reason, /divergente/);
  await assert.rejects(service.confirm(actor, b.id, true), /legado|conflit/i);
  assert.equal(
    (
      await db.pool.query(
        "SELECT original_description FROM products WHERE source='graal-estoque' AND legacy_id=341",
      )
    ).rows[0].original_description,
    'Produto legado original',
  );
});

test('quantidade JSON com precisão oculta não pode ser arredondada no parse', () => {
  const content = JSON.stringify(data()).replace(
    '"quantidade":2',
    '"quantidade":1.00000000000000001',
  );
  assert.throws(() => parseLegacy(content));
});
test('BOM UTF-8 não altera o conteúdo validado', () => {
  assert.equal(
    parseLegacy('\ufeff' + JSON.stringify(data())).summary.counts.products,
    1,
  );
});

test('metadado financeiro não entra na prévia nem nos campos de data', () => {
  const d = data();
  d.revisar.itens = [
    {
      tipo: 'valor_unitario',
      produto_id: 341,
      origem: 'Entradas!linha 2',
      valor_original: 'R$ 123.45',
      nota: 'Preço de compra',
    },
  ];
  const p = parseLegacy(JSON.stringify(d));
  assert.equal(JSON.stringify(p).includes('R$ 123.45'), false);
  assert.equal(p.payload.movements[0].dateOriginal, null);
});

test('legado confirmado aparece por padrão em entradas e saídas, sem saldo operacional', async () => {
  const { queryHistory } = require('../dist/backend/history');
  const { StockService } = require('../dist/backend/stock');
  const p = (
    await db.pool.query(
      "SELECT id FROM products WHERE source='graal-estoque' AND legacy_id=341",
    )
  ).rows[0].id;
  const entries = await queryHistory(db, { flow: 'entrada', productId: p });
  assert.equal(entries.total, 2);
  assert.ok(entries.items.every((r) => r.regime === 'legado'));
  assert.ok(
    entries.items.some((r) => r.zero_evidence && r.quantity === '0.000'),
  );
  assert.equal(
    (await queryHistory(db, { flow: 'saida', productId: p })).total,
    1,
  );
  assert.equal(
    (
      await queryHistory(db, {
        flow: 'entrada',
        productId: p,
        regime: 'operacional',
      })
    ).total,
    0,
  );
  assert.equal((await new StockService(db).balances(p)).total, '0.000');
});
