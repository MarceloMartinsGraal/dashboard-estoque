const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseQuantity, formatQuantity } = require('../dist/backend/quantity');
test('formatação preserva milésimos internos', () => {
  assert.equal(formatQuantity(300n), '0.300');
  assert.equal(formatQuantity(-2000n), '-2.000');
});
test('unidades rejeitam frações, zero, negativos e formatos ambíguos', () => {
  for (const value of ['1.5', '0', '-1', '1e3', 'NaN', '1,5', ' 1', '1.0001'])
    assert.throws(() => parseQuantity(value, 'unidade'));
  assert.equal(parseQuantity('2', 'unidade'), 2000n);
});
test('metro foi descontinuado e limites inseguros são rejeitados', () => {
  assert.throws(() => parseQuantity('1', 'metro'));
  assert.throws(() => parseQuantity('99999999999999999999999999', 'unidade'));
});
