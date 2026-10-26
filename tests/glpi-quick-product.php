<?php
require __DIR__.'/../glpi-plugin/estoquegraal/lib/bootstrap.php';
class FixtureStore implements \EstoqueGraal\IntentStore {public array $rows=[];public function add(array $row):void{$this->rows[$row['key']]=$row;}public function get(string$key):?array{return $this->rows[$key]??null;}public function claim(string$key,array$states):bool{return false;}public function save(string$key,string$state,?array$result):void{}}
function check($value,$message){if(!$value)throw new RuntimeException($message);}
function reject($fn){try{$fn();}catch(\EstoqueGraal\PluginError $e){check($e->status===400,'Status400 esperado');return;}throw new RuntimeException('Entrada inválida aceita');}
$settings=new \EstoqueGraal\Settings(['enabled'=>true,'base_url'=>'https://synthetic.invalid/api/integration/v1','instance_id'=>'synthetic','token'=>'11111111-1111-4111-8111-111111111111.'.str_repeat('a',64),'timeout'=>5,'connect_timeout'=>1]);
$service=new \EstoqueGraal\Operations(new \EstoqueGraal\ApiClient($settings,fn()=>[200,'{}']),$settings,new FixtureStore());
$ctx=['user'=>'7','ticket'=>'42','entity'=>3];$id='22222222-2222-4222-8222-222222222222';
$i=$service->prepare($ctx,'product',['description'=>'Produto rápido','categoryId'=>$id,'subcategoryId'=>$id,'active'=>false]);
check($i['summary']['categoryId']===$id&&$i['summary']['subcategoryId']===$id&&$i['summary']['active']===false,'Quatro campos preservados');
check(!array_key_exists('quantity',$i['summary'])&&$i['summary']['externalUserId']==='7','Sem quantidade e autoria da sessão');
$d=$service->prepare($ctx,'product',['description'=>'Produto padrão']);check($d['summary']['active']===true&&$d['summary']['categoryId']===null&&$d['summary']['subcategoryId']===null,'Padrões iguais ao dashboard');
reject(fn()=>$service->prepare($ctx,'product',['description'=>'x','subcategoryId'=>$id]));reject(fn()=>$service->prepare($ctx,'product',['description'=>'x','active'=>'true']));reject(fn()=>$service->prepare($ctx,'product',['description'=>'x','categoryId'=>'invalida']));reject(fn()=>$service->prepare($ctx,'product',['description'=>str_repeat('á',2001)]));
echo "OK cadastro quatro campos: tipos, UUID, subcategoria, padrões, descrição e ausência de quantidade\n";
