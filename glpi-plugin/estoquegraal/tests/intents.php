<?php
// Sem conexão de banco. Opcionalmente usa o construtor SQL oficial11.0.5 recebido por caminho.
namespace Safe {
 function preg_match($p,$s,&$matches=null,$flags=0,$offset=0){return \preg_match($p,$s,$matches,$flags,$offset);}
 function preg_replace(...$args){return \preg_replace(...$args);}
 function preg_split(...$args){return \preg_split(...$args);}
}
namespace {
require dirname(__DIR__).'/lib/bootstrap.php';
if(isset($argv[1],$argv[2])){require $argv[1];require $argv[2];}
class DBConnection {public static function isDbAvailable(){return false;}}
function check($value,$message){if(!$value)throw new \RuntimeException($message);}
class FixtureDB {
 public array $queries=[];public array $rows=[];public string $sql='';public string $failure='';
 public function request($q){
  $this->queries[]=$q;
  if(class_exists('DBmysqlIterator')){$builder=new DBmysqlIterator(null);$builder->buildQuery($q);$this->sql=$builder->getSql();echo 'SQL: '.$this->sql.PHP_EOL;check(str_contains($this->sql,'ORDER BY `id` DESC'),'Construtor oficial deve ordenar por id DESC, não coluna DESC');}
  check($q['ORDERBY']===['id DESC'],'ORDERBY deve ser lista de expressões, não mapa campo=>direção');
  if($this->failure==='throw')throw new \RuntimeException('Falha sintética');
  if($this->failure==='false')return false;
  $result=array_values(array_filter($this->rows,function($r)use($q){foreach($q['WHERE']as$k=>$v){if(is_array($v)?!in_array($r[$k],$v,true):$r[$k]!==$v)return false;}return true;}));
  usort($result,fn($a,$b)=>$b['id']<=>$a['id']);return array_slice($result,0,$q['LIMIT']);
 }
}
$db=new FixtureDB();$store=new \EstoqueGraal\GlpiIntentStore($db);$ctx=['user'=>'7','ticket'=>'42','entity'=>3];
check($store->recent($ctx,'synthetic')===[],'Lista vazia deve ser array vazio');
$base=['id'=>1,'intent_key'=>'eg.'.str_repeat('a',32),'users_id'=>7,'tickets_id'=>42,'entities_id'=>3,'instance_id'=>'synthetic','state'=>'unknown','operation'=>'movement'];
$db->rows=[$base,[...$base,'id'=>2,'users_id'=>8],[...$base,'id'=>3,'tickets_id'=>43],[...$base,'id'=>4,'entities_id'=>4],[...$base,'id'=>5,'instance_id'=>'other'],[...$base,'id'=>6,'state'=>'done']];
check($store->recent($ctx,'synthetic')===[['key'=>$base['intent_key'],'state'=>'unknown','operation'=>'movement']],'Isolar usuário/chamado/entidade/instância e excluir concluídas');
foreach(['prepared','sending','unknown','rejected']as$i=>$state)$db->rows[]=[...$base,'id'=>10+$i,'state'=>$state];
check(count($store->recent($ctx,'synthetic'))===5,'Incluir os quatro estados pendentes');
for($i=20;$i<45;$i++)$db->rows[]=[...$base,'id'=>$i,'intent_key'=>'eg.'.str_pad(dechex($i),32,'0',STR_PAD_LEFT)];$latest=$store->recent($ctx,'synthetic');check(count($latest)===20,'Limitar últimas20');check($latest[0]['key']==='eg.'.str_pad(dechex(44),32,'0',STR_PAD_LEFT),'Mais recente primeiro');
foreach(['throw','false']as$failure){$db->failure=$failure;$thrown=false;try{$store->recent($ctx,'synthetic');}catch(\Throwable){$thrown=true;}check($thrown,'Falha real não deve virar lista vazia');}
echo "OK intents: lista vazia, registros, estados, isolamento, limite e falhas preservadas".PHP_EOL;
}
