<?php
// GLPI 11 carrega scripts legados com require dentro de LegacyFileLoadController::__invoke (escopo de função).
namespace {
ini_set('display_errors','0');
define('READ',1);define('UPDATE',2);define('CREATE',4);
class CommonGLPI {}
class Ticket extends CommonGLPI {public array $fields=['entities_id'=>3];public function getID(){return 42;}public function getFromDB($id){return true;}public function can(...$args){return true;}}
class Session {public static function validateCSRF(...$args){return true;}public static function haveRight(...$args){return true;}public static function getLoginUserID(){return 7;}public static function haveAccessToEntity(...$args){return true;}public static function getNewCSRFToken(){return 'synthetic';}}
class Plugin {public static function isPluginActive(...$args){return true;}}
class Toolbox {public static function logInFile(...$args){}}
class PluginEstoquegraalConfig {public static function settings(){return new \EstoqueGraal\Settings(['enabled'=>'1','local_http'=>'1','base_url'=>'http://127.0.0.1:9/api/integration/v1','instance_id'=>'synthetic','token'=>'11111111-1111-4111-8111-111111111111.'.str_repeat('a',64),'timeout'=>'1','connect_timeout'=>'1']);}}
class FakeDB {public array $queries=[];public function request($q){$this->queries[]=$q;return [];}}
function check($value,$message){if(!$value){fwrite(STDERR,"FALHA: $message\n");exit(1);}}
function copyTree(string $from,string $to):void {@mkdir($to,0777,true);foreach(scandir($from)as$n){if($n==='.'||$n==='..')continue;is_dir("$from/$n")?copyTree("$from/$n","$to/$n"):copy("$from/$n","$to/$n");}}
// Estrutura mínima <GLPI>/inc/includes.php + <GLPI>/plugins/estoquegraal.
$root=sys_get_temp_dir().'/eg-endpoint-'.bin2hex(random_bytes(4));
mkdir("$root/inc",0777,true);file_put_contents("$root/inc/includes.php","<?php\n");
copyTree(dirname(__DIR__),"$root/plugins/estoquegraal");
$GLOBALS['DB']=new FakeDB();
$_SERVER['REQUEST_METHOD']='POST';$_SERVER['HTTP_X_REQUESTED_WITH']='XMLHttpRequest';$_SERVER['HTTP_X_GLPI_CSRF_TOKEN']='synthetic';
$_POST=['action'=>'intents','ticketId'=>'42','data'=>'{}'];
$load=static function(string $file){ob_start();require $file;return ob_get_clean();};
$out=json_decode($load("$root/plugins/estoquegraal/ajax/endpoint.php"),true);
check(($out['ok']??false)===true,'Endpoint falhou em escopo de função: '.json_encode($out,JSON_UNESCAPED_UNICODE));
check($out['data']===[]&&count($GLOBALS['DB']->queries)===1,'Consulta de intenções deve usar o $DB global');
echo "OK endpoint em escopo de função (GLPI 11): \$DB global, CSRF e ação intents\n";
}
