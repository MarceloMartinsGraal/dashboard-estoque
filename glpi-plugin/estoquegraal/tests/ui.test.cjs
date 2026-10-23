const {test}=require('node:test');const assert=require('node:assert/strict');const {quantity,inputQuantity,positive,Latest}=require('../public/js/core.js');
test('quantidades pt-BR preservam decimais e milhar; entrada segue unidade inteira atual',()=>{
 for(const [v,w]of [['2.000','2'],['2.500','2,5'],['2000.000','2.000'],['0.125','0,125'],[null,'—']])assert.equal(quantity(v),w);
 assert.equal(inputQuantity('2.000'),'2000');assert.equal(inputQuantity('2,000'),'2');assert.throws(()=>inputQuantity('2,5'));assert.throws(()=>inputQuantity('2.5'));assert.equal(positive('0.000'),false);
});
test('busca descarta respostas antigas mesmo antes da próxima chamada após debounce',()=>{const latest=new Latest();const old=latest.invalidate();latest.invalidate();assert.equal(latest.current(old),false);const now=latest.invalidate();assert.equal(latest.current(now),true);});
