const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const {migrate}=require('../dist/backend/migrate');
const {reconcileInstance}=require('../scripts/provision-integration.cjs');
let pool,admin;
before(async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL);assert(url.pathname.endsWith('_test'));assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});await migrate(pool);
 admin=(await pool.query("INSERT INTO employees(username,name,password_hash,manages_accounts) VALUES($1,'Sintético','fixture',true) RETURNING id",['reconcile-'+randomUUID()])).rows[0].id;
});
after(async()=>{await pool?.end();});
async function credential(instance){const secret=randomBytes(32).toString('hex');const row=(await pool.query("INSERT INTO integration_clients(instance_id,name,token_hash,scopes,active,expires_at) VALUES($1,'Sintético',$2,ARRAY['read','products:write','movements:write'],true,now()+interval '1 hour') RETURNING id",[instance,createHash('sha256').update(secret).digest('hex')])).rows[0];return row.id+'.'+secret;}
async function run(data){const c=await pool.connect();try{return await reconcileInstance(c,{operation:'reconcile-instance',adminId:admin,links:[],...data});}finally{c.release();}}
function names(){const n=randomUUID();return {sourceInstance:'new-'+n,targetInstance:'old-'+n,uncertain:false,pending:false};}
test('reconcilia cliente novo sem operações preservando UUID/token e vínculos antigos',async()=>{
 const data=names(),token=await credential(data.sourceInstance);
 await pool.query('INSERT INTO external_employee_links(instance_id,external_user_id,employee_id) VALUES($1,$2,$3)',[data.sourceInstance,'2',admin]);
 const result=await run({...data,sourceToken:token});assert.equal(result.token,token);
 assert.equal((await pool.query('SELECT instance_id FROM integration_clients WHERE id=$1',[token.split('.')[0]])).rows[0].instance_id,data.targetInstance);
 assert.equal((await pool.query('SELECT instance_id FROM external_employee_links WHERE external_user_id=$1 AND instance_id=ANY($2::text[])',['2',[data.sourceInstance,data.targetInstance]])).rowCount,2);
 assert.equal((await run({...data,sourceToken:token})).token,token);
});
test('recupera credencial existente do GLPI sem renomear clientes nem gerar segredo',async()=>{
 const data=names(),sourceToken=await credential(data.sourceInstance),targetToken=await credential(data.targetInstance);
 const result=await run({...data,sourceToken,targetToken,uncertain:true});assert.equal(result.token,targetToken);
 assert.equal((await pool.query('SELECT instance_id FROM integration_clients WHERE id=$1',[sourceToken.split('.')[0]])).rows[0].instance_id,data.sourceInstance);
});
test('destino ocupado sem sua credencial válida não é fundido nem sobrescrito',async()=>{
 const data=names(),sourceToken=await credential(data.sourceInstance);await credential(data.targetInstance);
 await assert.rejects(run({...data,sourceToken}),/destino|credencial/i);
 assert.equal((await pool.query('SELECT instance_id FROM integration_clients WHERE id=$1',[sourceToken.split('.')[0]])).rows[0].instance_id,data.sourceInstance);
});
test('incerteza local bloqueia mover cliente novo para backend sem identidade histórica',async()=>{
 const data=names(),sourceToken=await credential(data.sourceInstance);
 await assert.rejects(run({...data,sourceToken,uncertain:true}),/incert|desconhecid/i);
 assert.equal((await pool.query('SELECT instance_id FROM integration_clients WHERE id=$1',[sourceToken.split('.')[0]])).rows[0].instance_id,data.sourceInstance);
});
test('conflito de vínculo e responsável pendente não alteram cliente',async()=>{
 const data=names(),sourceToken=await credential(data.sourceInstance);
 await pool.query('INSERT INTO external_employee_links(instance_id,external_user_id,employee_id,active) VALUES($1,$2,$3,false)',[data.targetInstance,'2',admin]);
 await assert.rejects(run({...data,sourceToken,links:[{externalUserId:'2',employeeId:admin}]}),/vínculo/i);
 await pool.query('UPDATE employees SET must_change_password=true WHERE id=$1',[admin]);
 try{await assert.rejects(run({...data,sourceToken}),/responsável/i);}finally{await pool.query('UPDATE employees SET must_change_password=false WHERE id=$1',[admin]);}
 assert.equal((await pool.query('SELECT instance_id FROM integration_clients WHERE id=$1',[sourceToken.split('.')[0]])).rows[0].instance_id,data.sourceInstance);
});

async function recordOperation(db,data,token){
 const product=(await db.query("INSERT INTO products(description,unit) VALUES('Reconciliação sintética','unidade') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO integration_operations(instance_id,idempotency_key,operation,fingerprint,result,client_id,employee_id,external_user_id,product_id) VALUES($1,$2,'product',$3,'{}',$4,$5,'2',$6)",[data.sourceInstance,randomUUID(),'a'.repeat(64),token.split('.')[0],admin,product]);
}
test('cliente com operação mantém identidade e livro de idempotência',async()=>{
 const data=names(),sourceToken=await credential(data.sourceInstance);await recordOperation(pool,data,sourceToken);
 const before=(await pool.query('SELECT * FROM integration_operations WHERE client_id=$1',[sourceToken.split('.')[0]])).rows;
 await assert.rejects(run({...data,sourceToken}),/operações/i);
 assert.deepEqual((await pool.query('SELECT * FROM integration_operations WHERE client_id=$1',[sourceToken.split('.')[0]])).rows,before);
 assert.equal((await pool.query('SELECT instance_id FROM integration_clients WHERE id=$1',[sourceToken.split('.')[0]])).rows[0].instance_id,data.sourceInstance);
});
test('operação concorrente termina antes da decisão; reconciliação não ultrapassa writer',async()=>{
 const data=names(),sourceToken=await credential(data.sourceInstance);const writer=await pool.connect();let pending;
 try{
  await writer.query('BEGIN');await writer.query('SELECT id FROM integration_clients WHERE id=$1 FOR SHARE',[sourceToken.split('.')[0]]);
  let settled=false;pending=run({...data,sourceToken}).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  await new Promise(resolve=>setTimeout(resolve,75));assert.equal(settled,false);
  await recordOperation(writer,data,sourceToken);await writer.query('COMMIT');
  const outcome=await pending;assert.match(outcome.error.message,/operações/i);
  assert.equal((await pool.query('SELECT instance_id FROM integration_clients WHERE id=$1',[sourceToken.split('.')[0]])).rows[0].instance_id,data.sourceInstance);
 }finally{await writer.query('ROLLBACK');writer.release();await pending;}
});

test('vínculo da origem que seria copiado é validado antes do commit',async()=>{
 const data=names(),sourceToken=await credential(data.sourceInstance);
 const other=(await pool.query("INSERT INTO employees(username,name,password_hash) VALUES($1,'Outro','fixture') RETURNING id",['other-'+randomUUID()])).rows[0].id;
 await pool.query('INSERT INTO external_employee_links(instance_id,external_user_id,employee_id) VALUES($1,$2,$3)',[data.sourceInstance,'8',other]);
 await assert.rejects(run({...data,sourceToken,links:[{externalUserId:'8',employeeId:admin}]}),/vínculo/i);
 assert.equal((await pool.query('SELECT instance_id FROM integration_clients WHERE id=$1',[sourceToken.split('.')[0]])).rows[0].instance_id,data.sourceInstance);
});
test('intenções preparadas também impedem trocar backend sem sua idempotência',async()=>{
 const data=names(),sourceToken=await credential(data.sourceInstance);
 await assert.rejects(run({...data,sourceToken,pending:true}),/penden|incert/i);
});
test('credencial histórica válida pode ser recuperada mesmo com origem expirada',async()=>{
 const data=names(),sourceToken=await credential(data.sourceInstance),targetToken=await credential(data.targetInstance);
 await pool.query("UPDATE integration_clients SET expires_at=now()-interval '1 minute' WHERE id=$1",[sourceToken.split('.')[0]]);
 const result=await run({...data,sourceToken,targetToken});assert.equal(result.token,targetToken);
});
