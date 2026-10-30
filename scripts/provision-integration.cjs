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
  const admin=(await db.query('SELECT id FROM employees WHERE id=$1 AND active AND manages_accounts AND NOT must_change_password FOR SHARE',[data.adminId])).rows[0];
  check(admin,'Responsável deve ser ativo, administrar contas e concluir o primeiro acesso');
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
   check((await db.query('SELECT id FROM employees WHERE id=$1 AND active AND NOT must_change_password FOR SHARE',[link.employeeId])).rows.length,'Funcionário do vínculo inativo, inexistente ou com primeiro acesso pendente');
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
// Manutenção explícita: preserva a identidade histórica do GLPI; nunca move operações.
function credentialMatches(row,token){
 if(typeof token!=='string'||!uuid.test(token.split('.')[0]||'')||!/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token))return false;
 const [id,secret]=token.split('.');const hash=createHash('sha256').update(secret,'ascii').digest('hex');
 return !!(row&&row.id===id&&row.active&&row.valid&&/^[a-f0-9]{64}$/.test(row.token_hash||'')&&timingSafeEqual(Buffer.from(hash),Buffer.from(row.token_hash))&&['read','products:write','movements:write'].every(scope=>row.scopes.includes(scope)));
}
async function reconcileInstance(db,data){
 check(data.operation==='reconcile-instance','Operação inválida');
 check(uuid.test(data.adminId||''),'Responsável inválido');
 for(const name of ['sourceInstance','targetInstance'])check(/^[A-Za-z0-9._:-]{1,120}$/.test(data[name]||''),'Instância inválida');
 check(typeBool(data.uncertain)&&typeBool(data.pending),'Pendências GLPI devem ser explícitas');
 check(Array.isArray(data.links)&&data.links.length<=100,'Vínculos inválidos');
 for(const link of data.links)check(typeof link.externalUserId==='string'&&/^[^\s\x00-\x1f\x7f]{1,200}$/.test(link.externalUserId||'')&&uuid.test(link.employeeId||''),'Vínculo inválido');
 check(typeof data.sourceToken==='string'&&uuid.test(data.sourceToken.split('.')[0]||''),'Credencial de origem inválida');
 await db.query('BEGIN');
 try{
  await db.query("SET LOCAL lock_timeout='5s'");await db.query("SET LOCAL statement_timeout='20s'");
  // EXCLUSIVE precede os locks de linha: aguarda escritores/FOR SHARE existentes,
  // bloqueia novas operações e provisionamentos, permitindo SELECTs simples.
  await db.query('LOCK TABLE integration_clients IN EXCLUSIVE MODE');
  await db.query('LOCK TABLE external_employee_links IN EXCLUSIVE MODE');
  const admin=(await db.query('SELECT id FROM employees WHERE id=$1 AND active AND manages_accounts AND NOT must_change_password FOR SHARE',[data.adminId])).rows[0];
  check(admin,'Responsável deve ser ativo, administrador e sem primeiro acesso pendente');
  const source=(await db.query('SELECT *, expires_at>now() AS valid FROM integration_clients WHERE id=$1 FOR UPDATE',[data.sourceToken.split('.')[0]])).rows[0];
  const targets=(await db.query('SELECT *, expires_at>now() AS valid FROM integration_clients WHERE instance_id=$1 ORDER BY id FOR UPDATE',[data.targetInstance])).rows;
  const target=targets.find(row=>credentialMatches(row,data.targetToken));
  if(!target){
   check(credentialMatches(source,data.sourceToken),'Credencial de origem inválida, revogada ou expirada');
   check(source.instance_id===data.sourceInstance||source.instance_id===data.targetInstance,'Credencial pertence a outra instância; nenhuma fusão será feita');
  }
  const links=(await db.query('SELECT instance_id,external_user_id,employee_id,active FROM external_employee_links WHERE instance_id=ANY($1::text[])',[Array.from(new Set([data.sourceInstance,data.targetInstance]))])).rows;
  const dest=links.filter(row=>row.instance_id===data.targetInstance);
  for(const link of data.links){
   check((await db.query('SELECT id FROM employees WHERE id=$1 AND active AND NOT must_change_password FOR SHARE',[link.employeeId])).rows.length,'Funcionário do vínculo não está apto');
   const old=dest.find(row=>row.external_user_id===link.externalUserId);
   check(!old||(old.active&&old.employee_id===link.employeeId),'Vínculo de destino difere; não será remapeado');
  }
  let mode,token;
  if(target){mode='reused';token=data.targetToken;}
  else if(source?.instance_id===data.targetInstance){mode='already-aligned';token=data.sourceToken;}
  else{
   check(!targets.length,'Já existe cliente no destino, mas a credencial salva no GLPI não é válida; exige recuperação/rotação explícita, não fusão');
   check(!data.uncertain&&!data.pending,'Há operação pendente ou resultado desconhecido/incerto no GLPI; não conecte a outro backend sem recuperar sua idempotência');
   check(!(await db.query('SELECT 1 FROM integration_operations WHERE instance_id=$1 OR client_id=$2 LIMIT 1',[source.instance_id,source.id])).rows.length,'Origem já possui operações; identidade histórica não será renomeada');
   check((await db.query('SELECT id FROM integration_clients WHERE instance_id=$1',[source.instance_id])).rows.length===1,'Origem possui outros clientes; não será fundida');
   for(const old of links.filter(row=>row.instance_id===source.instance_id)){
    const existing=dest.find(row=>row.external_user_id===old.external_user_id);
    check(!existing||(existing.employee_id===old.employee_id&&existing.active===old.active),'Vínculo existente conflita; nenhuma alteração aplicada');
   }
   for(const requested of data.links){
    const copied=links.find(row=>row.instance_id===source.instance_id&&row.external_user_id===requested.externalUserId);
    check(!copied||(copied.active&&copied.employee_id===requested.employeeId),'Vínculo de origem conflita com a escolha; nenhuma alteração aplicada');
   }
   await db.query('UPDATE integration_clients SET instance_id=$1 WHERE id=$2',[data.targetInstance,source.id]);
   // Preserva os vínculos anteriores e copia somente os compatíveis.
   await db.query('INSERT INTO external_employee_links(instance_id,external_user_id,employee_id,active) SELECT $1,external_user_id,employee_id,active FROM external_employee_links WHERE instance_id=$2 ON CONFLICT(instance_id,external_user_id) DO NOTHING',[data.targetInstance,source.instance_id]);
   mode='aligned';token=data.sourceToken;
  }
  if(mode!=='already-aligned')await db.query("INSERT INTO audit_log(actor_id,action,entity,entity_id,details) VALUES($1,'reconciliar_instancia','integration_client',$2,$3)",[data.adminId,source?.id||target.id,JSON.stringify({sourceInstance:data.sourceInstance,targetInstance:data.targetInstance,mode})]);
  await db.query('COMMIT');return {token,instanceId:data.targetInstance,mode};
 }catch(error){
  await db.query('ROLLBACK');
  const reasons=new Map([
   ['Já existe cliente no destino, mas a credencial salva no GLPI não é válida; exige recuperação/rotação explícita, não fusão','target-credential-required'],
   ['Há operação pendente ou resultado desconhecido/incerto no GLPI; não conecte a outro backend sem recuperar sua idempotência','uncertain-history'],
   ['Origem já possui operações; identidade histórica não será renomeada','source-in-use'],
   ['Origem possui outros clientes; não será fundida','source-shared'],
   ['Vínculo de origem conflita com a escolha; nenhuma alteração aplicada','link-conflict'],
   ['Vínculo existente conflita; nenhuma alteração aplicada','link-conflict'],
   ['Vínculo de destino difere; não será remapeado','link-conflict'],
   ['Responsável deve ser ativo, administrador e sem primeiro acesso pendente','admin-required'],
   ['Credencial de origem inválida, revogada ou expirada','source-credential-invalid']
  ]);
  error.reconcileReason=reasons.get(error.message)||'reconcile-refused';throw error;
 }
}
function typeBool(value){return typeof value==='boolean';}
async function listAdmins(db){
 const rows=(await db.query('SELECT id,username,must_change_password FROM employees WHERE active AND manages_accounts ORDER BY username')).rows;
 const items=rows.filter(r=>!r.must_change_password).map(({id,username})=>({id,username}));
 return {items,requiresFirstAccess:!items.length&&rows.some(r=>r.must_change_password)};
}
module.exports={provision,listAdmins,reconcileInstance};
if(require.main===module)(async()=>{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>65536)throw Error('Entrada grande');}
 const data=JSON.parse(raw);const {Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL});
 let client;
 try{
  client=await pool.connect();
  const result=data.operation==='list-admins'
   ?await listAdmins(client)
   :data.operation==='reconcile-instance'?await reconcileInstance(client,data):await provision(client,data);
  process.stdout.write(JSON.stringify(result)+'\n');
 }finally{client?.release();await pool.end();}
})().catch(error=>{if(error.reconcileReason)process.stderr.write('GRAAL_DIAGNOSTIC '+JSON.stringify({phase:'reconcile',reason:error.reconcileReason})+'\n');process.stderr.write('Provisionamento recusado; confira responsável, instância, vínculo e credencial existente. Nenhum segredo é exibido.\n');process.exitCode=1;});
