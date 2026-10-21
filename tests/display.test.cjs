const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quantity } = require('../frontend/src/format.ts');
test('quantidades pt-BR distinguem decimal do milhar sem arredondar', () => {
  for (const [input, expected] of [
    ['2.000', '2'],
    [2, '2'],
    ['2.5', '2,5'],
    ['2.125', '2,125'],
    ['2000.000', '2.000'],
    ['0.000', '0'],
    [null, '—'],
    [undefined, '—'],
    ['', '—'],
    ['9999999999999999.125', '9.999.999.999.999.999,125'],
    ['-1.000', '-1'],
  ])
    assert.equal(quantity(input), expected);
});

const {
  readHistoryState,
  historySearch,
  historyApiSearch,
} = require('../frontend/src/history-state.ts');
test('URL preserva aba, origem, filtros combinados e página sem parâmetros de navegação na API', () => {
  const state = readHistoryState(
    '?flow=saida&regime=legado&q=cabo+%C3%A1udio&ticket=00042&dateFrom=2020-01-01&page=3',
  );
  assert.equal(state.page, 3);
  assert.equal(state.q, 'cabo áudio');
  assert.deepEqual(readHistoryState('?' + historySearch(state)), state);
  const api = new URLSearchParams(historyApiSearch(state));
  assert.equal(api.get('view'), null);
  assert.equal(api.get('ticket'), '00042');
  assert.equal(api.get('flow'), 'saida');
  assert.equal(api.get('limit'), '50');
});

const { locationSummary } = require('../frontend/src/format.ts');
test('realocação mostra origem e destino pelos deltas, inclusive no estorno', () => {
  const items = [
    { code: 'A', name: 'Primeiro', active: true, delta: '1.000' },
    { code: 'Z', name: 'Último', active: false, delta: '-1.000' },
  ];
  assert.equal(
    locationSummary(items, 'realocacao'),
    'Origem: Z · Último (inativo) → Destino: A · Primeiro',
  );
  assert.equal(
    locationSummary(
      items.map((l) => ({
        ...l,
        delta: l.delta.startsWith('-') ? l.delta.slice(1) : '-' + l.delta,
      })),
      'realocacao',
    ),
    'Origem: A · Primeiro → Destino: Z · Último (inativo)',
  );
  assert.equal(locationSummary(items, 'abertura').includes('→'), false);
});
test('página fracionária digitada na URL é normalizada para inteiro', () => {
  assert.equal(readHistoryState('?page=2.5').page, 2);
});
