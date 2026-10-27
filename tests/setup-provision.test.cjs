const {test}=require('node:test');
const assert=require('node:assert/strict');
const {provision}=require('../scripts/provision-integration.cjs');
const admin='11111111-1111-4111-8111-111111111111';
class DB {
 constructor(){this.calls=[];this.client=null;this.link=null;}
 async query(sql,p=[]){
  this.calls.push([sql,p]);
  if(sql.includes('FROM employees'))return {rows:[{id:admin,active:true,manages_accounts:true}]};
  if(sql.includes('FROM integration_clients WHERE id='))return {rows:this.client?[this.client]:[]};
  if(sql.includes('FROM integration_clients WHERE instance_id='))return {rows:this.client?[this.client]:[]};
  if(sql.startsWith('INSERT INTO integration_clients')){this.client={id:p[0],instance_id:p[1],token_hash:p[2],scopes:['read','products:write','movements:write'],active:true,valid:true};return {rows:[]};}
  if(sql.includes('FROM external_employee_links'))return {rows:this.link?[this.link]:[]};
  if(sql.startsWith('INSERT INTO external_employee_links')){this.link={employee_id:p[2],active:true};return {rows:[]};}
  return {rows:[]};
 }
}
const input=()=>({operation:'provision',instanceId:'glpi-teste',adminId:admin,validDays:30,links:[]});
test('provisiona uma vez e reutiliza token sem mudar saldo',async()=>{
 const db=new DB(),a=await provision(db,input());assert.match(a.token,/^[a-f0-9-]{36}\.[a-f0-9]{64}$/);
 const b=await provision(db,{...input(),existingToken:a.token});assert.equal(b.token,a.token);
 assert.equal(db.calls.filter(([s])=>s.startsWith('INSERT INTO integration_clients')).length,1);
 assert(db.calls.some(([s])=>s.startsWith('INSERT INTO audit_log')));
 assert(!db.calls.some(([s])=>/INSERT INTO (movements|ledger)/.test(s)));
 assert(!db.calls.some(([s])=>s.includes(a.token)));
});
test('cliente existente sem arquivo de token não é duplicado',async()=>{
 const db=new DB();await provision(db,input());await assert.rejects(()=>provision(db,input()),/credencial|cliente/i);
 assert(db.calls.some(([s])=>s==='ROLLBACK'));
});
test('token divergente e validade inválida são recusados',async()=>{
 const db=new DB(),a=await provision(db,input());
 await assert.rejects(()=>provision(db,{...input(),existingToken:a.token.slice(0,-1)+(a.token.endsWith('0')?'1':'0')}));
 await assert.rejects(()=>provision(new DB(),{...input(),validDays:0}));
});
test('vínculo explícito não pode remapear funcionário existente',async()=>{
 const db=new DB(),data={...input(),links:[{externalUserId:'7',employeeId:admin}]};
 const a=await provision(db,data);const b=await provision(db,{...data,existingToken:a.token});assert.equal(a.token,b.token);
 db.link={employee_id:'22222222-2222-4222-8222-222222222222',active:true};
 await assert.rejects(()=>provision(db,{...data,existingToken:a.token}),/vínculo/i);
});
