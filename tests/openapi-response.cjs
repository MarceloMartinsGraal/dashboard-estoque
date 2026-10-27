// Verificador limitado aos recursos usados neste contrato; não substitui um validador OpenAPI geral.
const assert=require('node:assert/strict');
const spec=require('../docs/integracoes/integration-v1.openapi.json');
function check(schema,value,label='$') {
  if(schema.$ref)return check(spec.components.schemas[schema.$ref.split('/').pop()],value,label);
  if(schema.allOf)for(const part of schema.allOf)check(part,value,label);
  if(schema.oneOf){const matches=schema.oneOf.filter(part=>{try{check(part,value,label);return true;}catch{return false;}});assert.equal(matches.length,1,label+' oneOf');}
  if(schema.type){const types=[schema.type].flat();assert.ok(types.some(t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='integer'?Number.isInteger(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):typeof value===t),label+' type');}
  if(schema.const!==undefined)assert.deepEqual(value,schema.const,label+' const');
  if(schema.enum)assert.ok(schema.enum.includes(value),label+' enum');
  if(typeof value==='string'){
    if(schema.pattern)assert.match(value,new RegExp(schema.pattern),label);
    if(schema.minLength)assert.ok([...value].length>=schema.minLength,label+' minLength');
    if(schema.maxLength)assert.ok([...value].length<=schema.maxLength,label+' maxLength');
    if(schema.format==='uuid')assert.match(value,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,label);
    if(schema.format==='date')assert.match(value,/^\d{4}-\d{2}-\d{2}$/,label);
    if(schema.format==='date-time')assert.ok(Number.isFinite(Date.parse(value)),label+' date-time');
  }
  if(Array.isArray(value)){
    if(schema.items)value.forEach((item,i)=>check(schema.items,item,label+'['+i+']'));
    if(schema.minItems)assert.ok(value.length>=schema.minItems,label+' minItems');
    if(schema.maxItems)assert.ok(value.length<=schema.maxItems,label+' maxItems');
  } else if(value!==null&&typeof value==='object'){
    for(const key of schema.required??[])assert.ok(Object.hasOwn(value,key),label+' missing '+key);
    for(const [key,v] of Object.entries(value)){
      if(schema.properties?.[key])check(schema.properties[key],v,label+'.'+key);
      else if(schema.additionalProperties===false)assert.fail(label+' unexpected '+key);
    }
  }
  if(typeof value==='number'){
    if(schema.minimum!==undefined)assert.ok(value>=schema.minimum,label+' minimum');
    if(schema.maximum!==undefined)assert.ok(value<=schema.maximum,label+' maximum');
  }
}
function response(method,path,result){
  const pathname=path.split('?')[0];
  const route=Object.keys(spec.paths).find(p=>new RegExp('^'+p.replace(/\{[^}]+\}/g,'[^/]+')+'$').test(pathname));
  assert.ok(route,'Endpoint sem contrato: '+method+' '+pathname);
  const operation=spec.paths[route][method.toLowerCase()];assert.ok(operation,'Método sem contrato: '+method+' '+route);
  const schema=operation.responses[result.status]?.content?.['application/json']?.schema;
  assert.ok(schema,'Resposta sem contrato: '+method+' '+route+' '+result.status);
  check(schema,result.body,method+' '+route+' '+result.status);
  return result;
}
module.exports={response};
