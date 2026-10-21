const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseQuantity, formatQuantity } = require('../dist/backend/quantity');
test('metros preservam precisão exata em somas', () => {
  assert.equal(
    parseQuantity('0.1', 'metro') + parseQuantity('0.2', 'metro'),
    300n,
  );
  assert.equal(formatQuantity(300n), '0.300');
});
test('unidades rejeitam frações, zero, negativos e formatos ambíguos', () => {
  for (const value of ['1.5', '0', '-1', '1e3', 'NaN', '1,5', ' 1', '1.0001'])
    assert.throws(() => parseQuantity(value, 'unidade'));
  assert.equal(parseQuantity('2', 'unidade'), 2000n);
});
test('metros rejeitam precisão excedente e limites inseguros', () => {
  for (const value of ['0.0001', '0', '99999999999999999999999999'])
    assert.throws(() => parseQuantity(value, 'metro'));
});
