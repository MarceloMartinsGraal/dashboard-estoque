'use strict';
// CLI administrativa: stdin/stdout são canais privados do orquestrador, nunca logs.
const {randomUUID,randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const check=(ok,message)=>{if(!ok)throw Error(message);};
async function provision(db,data){
 check(data.operation==='provision','Operação inválida');
 check(/^[A-Za-z0-9._:-]{1,120}$/.test(data.instanceId||''),'Instância inválida');
 check(uuid.test(data.adminId||''),'Responsável inválido');
 check(Number.isInteger(data.validDays)&&data.validDays>=1&&data.validDays<=365,'Validade deve ser de 1 a 365 dias');
 check(Array.isArray(data.links)&&data.links.length<=100,'Vínculos inválidos');
 for(const link of data.links)check(typeof link.externalUserId==='string'&&/^[^\s\x00-\x1f\x7f]{1,200}$/.test(link.externalUserId)&&uuid.test(link.employeeId||''),'Vínculo inválido');
 await db.query('BEGIN');
 try{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['graal-setup:'+data.instanceId]);
  const admin=(await db.query('SELECT id FROM employees WHERE id=$1 AND active AND manages_accounts FOR SHARE',[data.adminId])).rows[0];
  check(admin,'Responsável deve ser ativo e administrar contas');
  let id,secret,token=data.existingToken;
  if(token){
   check(typeof token==='string'&&/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token),'Formato da credencial inválido');
   [id,secret]=token.split('.');check(uuid.test(id),'Cliente inválido');
   const row=(await db.query('SELECT *, expires_at>now() AS valid FROM integration_clients WHERE id=$1 FOR UPDATE',[id])).rows[0];
   const hash=createHash('sha256').update(secret,'ascii').digest('hex');
   check(row&&row.instance_id===data.instanceId&&row.active&&row.valid&&row.token_hash?.length===64&&timingSafeEqual(Buffer.from(hash),Buffer.from(row.token_hash)),'Credencial ausente, inválida, revogada ou expirada; rotação exige procedimento explícito');
   check(['read','products:write','movements:write'].every(s=>row.scopes.includes(s)),'Escopos insuficientes');
  }else{
   const existing=(await db.query('SELECT id FROM integration_clients WHERE instance_id=$1 LIMIT 1',[data.instanceId])).rows;
   check(!existing.length,'Já existe cliente para esta instância; recupere o arquivo de credencial ou faça rotação explícita');
   id=randomUUID();secret=randomBytes(32).toString('hex');token=id+'.'+secret;
   const hash=createHash('sha256').update(secret,'ascii').digest('hex');
   await db.query("INSERT INTO integration_clients(id,instance_id,token_hash,name,scopes,active,expires_at) VALUES($1,$2,$3,'Configuração SSH homologação',ARRAY['read','products:write','movements:write'],true,now()+$4*interval '1 day')",[id,data.instanceId,hash,data.validDays]);
   await db.query("INSERT INTO audit_log(actor_id,action,entity,entity_id,details) VALUES($1,'configurar_integracao','integration_client',$2,$3)",[data.adminId,id,JSON.stringify({instanceId:data.instanceId,validDays:data.validDays,source:'setup_homologacao'})]);
  }
  for(const link of data.links){
   check((await db.query('SELECT id FROM employees WHERE id=$1 AND active FOR SHARE',[link.employeeId])).rows.length,'Funcionário do vínculo inativo ou inexistente');
   const old=(await db.query('SELECT employee_id,active FROM external_employee_links WHERE instance_id=$1 AND external_user_id=$2 FOR UPDATE',[data.instanceId,link.externalUserId])).rows[0];
   check(!old||(old.active&&old.employee_id===link.employeeId),'Vínculo existente difere; alteração exige revisão explícita');
   if(!old){
    await db.query('INSERT INTO external_employee_links(instance_id,external_user_id,employee_id) VALUES($1,$2,$3)',[data.instanceId,link.externalUserId,link.employeeId]);
    await db.query("INSERT INTO audit_log(actor_id,action,entity,entity_id,details) VALUES($1,'vincular_usuario_externo','funcionario',$2,$3)",[data.adminId,link.employeeId,JSON.stringify({instanceId:data.instanceId,externalUserId:link.externalUserId})]);
   }
  }
  await db.query('COMMIT');return {token};
 }catch(e){await db.query('ROLLBACK');throw e;}
}
module.exports={provision};
if(require.main===module)(async()=>{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>65536)throw Error('Entrada grande');}
 const data=JSON.parse(raw);const {Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL});
 let client;
 try{
  client=await pool.connect();
  const result=data.operation==='list-admins'
   ?{items:(await client.query('SELECT id,username FROM employees WHERE active AND manages_accounts ORDER BY username')).rows}
   :await provision(client,data);
  process.stdout.write(JSON.stringify(result)+'\n');
 }finally{client?.release();await pool.end();}
})().catch(()=>{process.stderr.write('Provisionamento recusado; confira responsável, instância, vínculo e credencial existente. Nenhum segredo é exibido.\n');process.exitCode=1;});
