<?php
// Testes sintéticos sem inicializar qualquer instalação GLPI.
require dirname(__DIR__) . '/lib/bootstrap.php';
use EstoqueGraal\ApiClient;
use EstoqueGraal\PluginError;
use EstoqueGraal\Settings;
function expect(bool $v,string $message='Falha'):void {if(!$v) throw new RuntimeException($message);}
function rejects(callable $f,int $status):void {try{$f();}catch(PluginError $e){expect($e->status===$status,'Status esperado '.$status.', recebido '.$e->status);return;}throw new RuntimeException('Era esperada rejeição');}
$token='11111111-1111-4111-8111-111111111111.'.str_repeat('a',64);
$config=['base_url'=>'https://dashboard.invalid/api/integration/v1','instance_id'=>'glpi-synthetic','token'=>$token,'timeout'=>5,'connect_timeout'=>2,'enabled'=>true,'local_http'=>false];
$tests=[];
$tests['configuração bloqueia destinos/segredos inválidos e HTTP fora de loopback']=function()use($config){
 foreach(['http://dashboard.invalid/api/integration/v1','https://user:pass@dashboard.invalid/api/integration/v1','https://dashboard.invalid/api/integration/v1?x=1','file:///api/integration/v1','https://dashboard.invalid/other']as$url)rejects(fn()=>new Settings([...$config,'base_url'=>$url]),400);
 new Settings([...$config,'base_url'=>'http://127.0.0.1:9999/api/integration/v1','local_http'=>true]);
 rejects(fn()=>new Settings([...$config,'token'=>'secret']),400);
 rejects(fn()=>new Settings([...$config,'enabled'=>false]),503);
};
$tests['cliente monta requisição correta, pagina e nunca aceita endpoint arbitrário']=function()use($config,$token){
 $seen=[];$transport=function($method,$url,$headers,$body)use(&$seen){$seen[]=[$method,$url,$headers,$body];return [200,'{"items":[],"total":0,"page":2,"limit":20}'];};
 $c=new ApiClient(new Settings($config),$transport);$c->get('/products',['q'=>'memória','page'=>2,'limit'=>20]);
 expect($seen[0][0]==='GET');expect(str_contains($seen[0][1],'q=mem%C3%B3ria'));expect(in_array('Authorization: Bearer '.$token,$seen[0][2],true));
 rejects(fn()=>$c->get('https://attacker.invalid/'),400);
 rejects(fn()=>$c->get('/products?token=leak'),400);
};
$tests['erros não refletem credencial nem resposta HTML da API']=function()use($config,$token){
 foreach([400,401,403,409,503]as$status){$c=new ApiClient(new Settings($config),fn()=>[$status,'<script>'.$token.'</script>']);try{$c->get('/products');}catch(PluginError$e){expect(!str_contains($e->getMessage(),$token));expect(!str_contains($e->getMessage(),'<script>'));expect($e->status===$status);}}
 $c=new ApiClient(new Settings($config),fn()=>[200,'not-json']);rejects(fn()=>$c->get('/products'),502);
};

final class MemoryStore implements \EstoqueGraal\IntentStore {
 public array $rows=[];
 public function add(array $row):void{$this->rows[$row['key']]=$row;}
 public function get(string $key):?array{return $this->rows[$key]??null;}
 public function claim(string$key,array$states):bool{if(!isset($this->rows[$key])||!in_array($this->rows[$key]['state'],$states,true))return false;$this->rows[$key]['state']='sending';return true;}
 public function save(string$key,string$state,?array$result):void{if($this->rows[$key]['state']!=='done'){$this->rows[$key]['state']=$state;$this->rows[$key]['result']=$result;}}
}
$ctx=['user'=>'7','ticket'=>'000042','entity'=>3];$pid='22222222-2222-4222-8222-222222222222';
$movement=['productId'=>$pid,'kind'=>'saida','quantity'=>'2','locationId'=>'00000000-0000-0000-0000-000000000001','eventDate'=>'2026-01-03','reason'=>'chamado','observation'=>'Sintético'];
$result=['id'=>'33333333-3333-4333-8333-333333333333','productId'=>$pid,'kind'=>'saida','quantity'=>'2.000','externalReference'=>['instanceId'=>'glpi-synthetic','ticketId'=>'000042','externalUserId'=>'7']];
$tests['intenção fixa autoria/chamado no servidor, bloqueia alteração de identidade e chave por novo gesto']=function()use($config,$ctx,$movement,$result){
 $store=new MemoryStore();$seen=[];$api=new ApiClient(new Settings($config),function($m,$u,$h,$b)use(&$seen,$result){$seen[]=[$m,$u,$h,json_decode($b??'{}',true)];return[201,json_encode($result)];});
 $service=new \EstoqueGraal\Operations($api,new Settings($config),$store);
 rejects(fn()=>$service->prepare($ctx,'movement',[...$movement,'externalUserId'=>'999']),400);
 $intent=$service->prepare($ctx,'movement',$movement);expect($intent['key']!==$service->prepare($ctx,'movement',$movement)['key']);
 $a=$service->execute($ctx,$intent['key']);$b=$service->execute($ctx,$intent['key']);expect($a===$b);expect(count($seen)===1);expect($seen[0][3]['externalUserId']==='7');expect($seen[0][3]['ticketId']==='000042');
 rejects(fn()=>$service->execute([...$ctx,'user'=>'9'],$intent['key']),403);
 rejects(fn()=>$service->execute([...$ctx,'ticket'=>'999'],$intent['key']),403);
};
$tests['timeout depois de gravar recupera resultado sem reenviar POST; desconhecido conserva chave']=function()use($config,$ctx,$movement,$result){
 $posts=0;$store=new MemoryStore();$api=new ApiClient(new Settings($config),function($m,$u,$h,$b)use(&$posts,$result){if($m==='POST'){$posts++;throw new \RuntimeException('Timeout');}return[200,json_encode(['instanceId'=>'glpi-synthetic','operation'=>'movement','result'=>$result])];});
 $service=new \EstoqueGraal\Operations($api,new Settings($config),$store);$intent=$service->prepare($ctx,'movement',$movement);expect($service->execute($ctx,$intent['key'])['state']==='done');expect($posts===1);
 $api=new ApiClient(new Settings($config),function($m)use(&$posts){if($m==='POST'){$posts++;throw new \RuntimeException('Timeout');}return[404,'{}'];});
 $service=new \EstoqueGraal\Operations($api,new Settings($config),$store);$intent=$service->prepare($ctx,'movement',$movement);expect($service->execute($ctx,$intent['key'])['state']==='unknown');expect($service->recover($ctx,$intent['key'])['key']===$intent['key']);
 expect($posts===2);
};
$tests['intenção em envio por clique concorrente só consulta resultado; rejeição não altera payload']=function()use($config,$ctx,$movement){
 $store=new MemoryStore();$posts=0;$api=new ApiClient(new Settings($config),function($m)use(&$posts){if($m==='POST'){$posts++;return[409,'{}'];}return[404,'{}'];});$s=new \EstoqueGraal\Operations($api,new Settings($config),$store);
 $i=$s->prepare($ctx,'movement',$movement);$store->claim($i['key'],['prepared']);expect($s->execute($ctx,$i['key'])['state']==='unknown');expect($posts===0);
 $i=$s->prepare($ctx,'movement',$movement);expect($s->execute($ctx,$i['key'])['state']==='rejected');expect($store->get($i['key'])['payload']['quantity']==='2');
};
$tests['cadastro concluído não é repetido quando entrada separada falha']=function()use($config,$ctx,$movement){
 $store=new MemoryStore();$creates=0;$api=new ApiClient(new Settings($config),function($m,$u)use(&$creates){if(str_ends_with($u,'/products')){$creates++;return[201,'{"id":"22222222-2222-4222-8222-222222222222"}'];}return[409,'{}'];});$s=new \EstoqueGraal\Operations($api,new Settings($config),$store);
 $i=$s->prepare($ctx,'product',['description'=>'Memória sintética']);expect($s->execute($ctx,$i['key'])['state']==='done');
 $j=$s->prepare($ctx,'movement',[...$movement,'kind'=>'entrada']);expect($s->execute($ctx,$j['key'])['state']==='rejected');expect($s->execute($ctx,$i['key'])['state']==='done');expect($creates===1);
};

if(!defined('READ')){define('READ',1);define('UPDATE',2);define('CREATE',4);}
class Session {public static int $user=7;public static int $rights=1;public static bool $entity=true;public static function getLoginUserID(){return self::$user;}public static function haveRight($name,$right){return(self::$rights&$right)===$right;}public static function haveAccessToEntity($id){return self::$entity;}}
class Plugin {public static function isPluginActive($key){return true;}}
class Ticket {public array $fields=['entities_id'=>3];public static bool $visible=true;public function getFromDB($id){return $id===42;}public function can($id,$right){return self::$visible;}public function getID(){return 42;}}
$tests['guard revalida chamado/entidade/permissão e usa identidade de sessão']=function(){
 Session::$rights=READ; $ctx=\EstoqueGraal\Gate::context('42');expect($ctx['user']==='7');expect($ctx['ticket']==='42');
 rejects(fn()=>\EstoqueGraal\Gate::context('42',UPDATE),403);
 Session::$rights=READ|UPDATE;\EstoqueGraal\Gate::context('42',UPDATE);
 Ticket::$visible=false;rejects(fn()=>\EstoqueGraal\Gate::context('42',UPDATE),403);Ticket::$visible=true;
 Session::$entity=false;rejects(fn()=>\EstoqueGraal\Gate::context('42'),403);Session::$entity=true;
 Session::$user=0;rejects(fn()=>\EstoqueGraal\Gate::context('42'),401);Session::$user=7;
};

$tests['HTML está escapado e não contém credencial']=function()use($token){
 $html=\EstoqueGraal\View::ticket('" onload="alert(1)', ['ticket'=>'42'], '"><script>evil</script>',true,true);
 expect(!str_contains($html,'<script>evil'));expect(str_contains($html,'&lt;script&gt;'));expect(!str_contains($html,$token));
};
$tests['alvo declarado é11.0.5 com limite superior exclusivo e extensões no formato oficial']=function(){
 require_once dirname(__DIR__).'/setup.php';$v=plugin_version_estoquegraal();expect($v['requirements']['glpi']===['min'=>'11.0.5','max'=>'11.0.6']);expect(isset($v['requirements']['php']['exts']['curl']['required']));
};
class CommonGLPI {}
class Config {public static function getConfigurationValues($context){return ['token'=>'ciphertext-synthetic','enabled'=>'1'];}}
class GLPIKey {public function decrypt($value){return 'synthetic-plaintext';}}
require_once dirname(__DIR__).'/inc/config.class.php';
$tests['configuração pública omite ciphertext e plaintext; segredo somente no caminho servidor']=function(){
 $public=PluginEstoquegraalConfig::values();expect(!array_key_exists('token',$public));expect($public['token_set']===true);expect(!str_contains(json_encode($public),'synthetic'));
 expect(PluginEstoquegraalConfig::values(true)['token']==='synthetic-plaintext');
};
$failed=0;foreach($tests as$name=>$test){try{$test();echo 'OK '.$name.PHP_EOL;}catch(Throwable$e){$failed++;echo 'FAIL '.$name.': '.$e->getMessage().PHP_EOL;}}
exit($failed?1:0);
