<?php
// GLPI 11 carrega scripts legados com require dentro de LegacyFileLoadController::__invoke (escopo de função).
namespace {
ini_set('display_errors','0');
define('READ',1);define('UPDATE',2);define('CREATE',4);
class CommonGLPI {}
class Ticket extends CommonGLPI {public array $fields=['entities_id'=>3];public int $id=42;public function getID(){return $this->id;}public function getFromDB($id){$this->id=$id;return true;}public function can(...$args){return true;}}
class Session {public static int $user=7;public static function validateCSRF(...$args){return true;}public static function haveRight(...$args){return true;}public static function getLoginUserID(){return self::$user;}public static function haveAccessToEntity(...$args){return true;}public static function getNewCSRFToken(){return 'synthetic';}}
class Plugin {public static function isPluginActive(...$args){return true;}}
class Toolbox {public static array $logs=[];public static function logInFile($file,$line){self::$logs[]=json_decode($line,true);}}
class PluginEstoquegraalConfig {public static function settings(){return new \EstoqueGraal\Settings(['enabled'=>'1','local_http'=>'1','base_url'=>'http://127.0.0.1:9/api/integration/v1','instance_id'=>'synthetic','token'=>'11111111-1111-4111-8111-111111111111.'.str_repeat('a',64),'timeout'=>'1','connect_timeout'=>'1']);}}
class FakeDB {public array $queries=[];public function request($q){
 $this->queries[]=$q;
 if(($GLOBALS['diagnosticFailure']??false))throw new RuntimeException('sentinel_secret_must_not_leak');
 if(in_array('--false',$GLOBALS['argv'],true))return false;
 if(!in_array('--existing',$GLOBALS['argv'],true)&&!in_array('--invalid-json',$GLOBALS['argv'],true))return [];
 $row=['id'=>1,'intent_key'=>'eg.'.str_repeat('a',32),'users_id'=>7,'tickets_id'=>42,'entities_id'=>3,'instance_id'=>'synthetic','state'=>'unknown','operation'=>in_array('--invalid-json',$GLOBALS['argv'],true)?"\xB1":'movement'];
 foreach($q['WHERE']as$key=>$value)if(is_array($value)?!in_array($row[$key],$value,true):$row[$key]!==$value)return [];
 return [$row];
}}
function check($value,$message){if(!$value){fwrite(STDERR,"FALHA: $message\n");exit(1);}}
function copyTree(string $from,string $to):void {@mkdir($to,0777,true);foreach(scandir($from)as$n){if($n==='.'||$n==='..')continue;is_dir("$from/$n")?copyTree("$from/$n","$to/$n"):copy("$from/$n","$to/$n");}}
// Estrutura mínima <GLPI>/inc/includes.php + <GLPI>/plugins/estoquegraal.
$root=sys_get_temp_dir().'/eg-endpoint-'.bin2hex(random_bytes(4));
mkdir("$root/inc",0777,true);file_put_contents("$root/inc/includes.php","<?php\n");
copyTree(dirname(__DIR__),"$root/plugins/estoquegraal");
$GLOBALS['DB']=new FakeDB();$GLOBALS['diagnosticFailure']=in_array('--failure',$argv,true);
$_SERVER['REQUEST_METHOD']='POST';$_SERVER['HTTP_X_REQUESTED_WITH']='XMLHttpRequest';$_SERVER['HTTP_X_GLPI_CSRF_TOKEN']='synthetic';
if(in_array('--other-user',$argv,true))Session::$user=8;
$_POST=['action'=>'intents','ticketId'=>in_array('--other-ticket',$argv,true)?'43':'42','data'=>'{}'];
$load=static function(string $file){ob_start();require $file;return ob_get_clean();};
$out=json_decode($load("$root/plugins/estoquegraal/ajax/endpoint.php"),true);
if($GLOBALS['diagnosticFailure']||in_array('--false',$argv,true)||in_array('--invalid-json',$argv,true)){
 check(($out['ok']??true)===false&&$out['status']===500&&$out['action']==='intents','Erro deve preservar status/ação');
 check(preg_match('/^[a-f0-9]{32}$/D',$out['requestId'])===1,'requestId obrigatório');
 $log=end(Toolbox::$logs);check($log['requestId']===$out['requestId'],'Correlacionar requestId');
 $serialize=in_array('--invalid-json',$argv,true);
 check($log['phase']===($serialize?'serialize':'action:intents'),'Fase da exceção correta');
 check($log['exceptionType']===($serialize?'JsonException':(in_array('--false',$argv,true)?'PluginError':'RuntimeException')),'Tipo da exceção correta');
 check(!str_contains(json_encode([$out,Toolbox::$logs]),'sentinel_secret_must_not_leak'),'Não refletir mensagem bruta');
 echo "OK falha intents500 preservada e sanitizada: ".$log['exceptionType']."\n";
}else{
 check(($out['ok']??false)===true,'Endpoint falhou em escopo de função: '.json_encode($out,JSON_UNESCAPED_UNICODE));
 $existing=in_array('--existing',$argv,true)&&!in_array('--other-user',$argv,true)&&!in_array('--other-ticket',$argv,true);
 check($out['data']===($existing?[['key'=>'eg.'.str_repeat('a',32),'state'=>'unknown','operation'=>'movement']]:[]),'Lista/serialização/isolation incorreta');
 check(count($GLOBALS['DB']->queries)===1,'Consulta deve usar DB global');
 check($GLOBALS['DB']->queries[0]['ORDERBY']===['id DESC'],'Ordenação compatível GLPI');
 echo "OK endpoint intents: ".($existing?'registro serializado':'lista vazia/isolation')."\n";
}
}
