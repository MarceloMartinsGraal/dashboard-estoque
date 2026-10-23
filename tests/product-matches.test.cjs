const {test}=require('node:test');const assert=require('node:assert/strict');
const {comparisonTokens,compareProducts}=require('../dist/backend/product-matches');
test('normalização considera caixa, acentos, ordem, espaços e 8GB/8 GB sem alterar descrição',()=>{
 const a='Memória Kingston 8GB DDR4';const b=' memoria  RAM kingston DDR4 8 GB ';
 assert.deepEqual(comparisonTokens(a),comparisonTokens(b));assert.ok(compareProducts(a,b).similar);
});
test('diferenças técnicas são sinalizadas, nunca equivalência automática',()=>{
 const a='Memória Kingston 8GB DDR4 notebook novo';const b='Memória Kingston 16 GB DDR3 desktop usado';
 const r=compareProducts(a,b);assert.equal(r.technicalDifferences,true);assert.equal(r.exact,false);
 assert.equal(compareProducts('cabo USB','gabinete computador').similar,false);
});
