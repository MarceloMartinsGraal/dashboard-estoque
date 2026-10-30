import * as argon2 from 'argon2';
import { Database,audit } from './db';
// Mesmo lock do bootstrap manual/administração; nunca seleciona só funcionários ativos.
export async function ensureInitialAccount(db:Database){
 return db.transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(742106)');
  const migrated=await c.query("SELECT 1 FROM schema_migrations WHERE name='007_initial_access.sql'");
  if(!migrated.rowCount)throw new Error('Aplique a migração 007_initial_access.sql antes de iniciar a API.');
  if((await c.query('SELECT id FROM employees LIMIT 1')).rowCount)return;
  const hash=await argon2.hash('admin',{type:argon2.argon2id});
  const row=(await c.query("INSERT INTO employees(username,name,password_hash,manages_accounts,must_change_password) VALUES('admin','Administrador inicial',$1,true,true) RETURNING id",[hash])).rows[0];
  await audit(c,row.id,'criar_administrador_inicial','funcionario',row.id,{username:'admin',origin:'empty_database',firstAccess:true});
 });
}
