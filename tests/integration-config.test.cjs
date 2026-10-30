const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {IntegrationGuard}=require('../dist/backend/integration');
const req={path:'/api/integration/v1/products',headers:{}};const ctx={switchToHttp:()=>({getRequest:()=>req}),getHandler:()=>()=>{}};
test('integração ausente/true exige autenticação; false bloqueia; inválido é configuração inválida',async()=>{
 const original=process.env.INTEGRATION_ENABLED;const guard=new IntegrationGuard({});try{
  for(const flag of [undefined,'true','false','TRUE','','0','yes']){
   if(flag===undefined)delete process.env.INTEGRATION_ENABLED;else process.env.INTEGRATION_ENABLED=flag;
   try{await guard.canActivate(ctx);assert.fail('Não pode autorizar sem credencial');}catch(e){if(flag===undefined||flag==='true')assert.equal(e.getStatus?.(),401);else if(flag==='false')assert.equal(e.getStatus?.(),503);else assert.match(e.message,/INTEGRATION_ENABLED.*true.*false/);}
  }
 }finally{if(original===undefined)delete process.env.INTEGRATION_ENABLED;else process.env.INTEGRATION_ENABLED=original;}
});
function expression(file){const source=fs.readFileSync(file,'utf8');const api=source.split(/^  api:\s*$/m)[1]?.split(/^  [A-Za-z_]+:\s*$/m)[0];assert.ok(api,'Serviço API existe em '+file);let body=api;const anchor=/environment:\s*\*(\S+)/.exec(api);if(anchor){const start=source.indexOf('environment: &'+anchor[1]);assert.ok(start>=0);body=source.slice(start).split(/^  [A-Za-z_]+:\s*$/m)[0];}const value=/INTEGRATION_ENABLED:\s*([^\r\n]+)/.exec(body)?.[1].trim();assert.ok(value,'Configuração deve chegar à API em '+file);return value.replace(/^['"]|['"]$/g,'');}
function render(expr,value){const variable=/^\$\{INTEGRATION_ENABLED(:?)-([^}]+)\}$/.exec(expr);if(!variable)return expr;return value===undefined||(variable[1]===':'&&value==='')?variable[2]:value;}
test('manifestos Compose preservam decisão explícita e passam valor inválido ao backend',()=>{
 for(const file of ['compose.yaml','compose.dev.yaml','compose.homologacao.yaml','compose.dev.integration.yaml']){const expr=expression(file);for(const value of [undefined,'true','false','','invalid'])assert.equal(render(expr,value),value===undefined?'true':value,file+' flag='+String(value));}
});
