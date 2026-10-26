<?php
require __DIR__.'/../glpi-plugin/estoquegraal/lib/bootstrap.php';
define('READ',1);define('UPDATE',2);define('CREATE',4);
class Session {public static function validateCSRF(...$a){return true;}public static function haveRight(...$a){return true;}public static function getLoginUserID(){return 7;}public static function haveAccessToEntity(...$a){return true;}public static function getNewCSRFToken(){return 'synthetic';}}
class Plugin {public static function isPluginActive(...$a){return true;}}
class Ticket {public array $fields=['entities_id'=>3];public function getFromDB($id){return $id===42;}public function can(...$a){return true;}public function getID(){return 42;}}
class Toolbox {public static function logInFile(...$a){}}
class PluginEstoquegraalConfig {public static string $url;public static function settings(){return new \EstoqueGraal\Settings(['enabled'=>true,'local_http'=>true,'base_url'=>self::$url,'instance_id'=>'synthetic','token'=>'11111111-1111-4111-8111-111111111111.'.str_repeat('a',64),'timeout'=>3,'connect_timeout'=>1]);}}
function copyFixture($from,$to){mkdir($to,0777,true);foreach(scandir($from)as$n){if($n==='.'||$n==='..')continue;is_dir($from.'/'.$n)?copyFixture($from.'/'.$n,$to.'/'.$n):copy($from.'/'.$n,$to.'/'.$n);}}
function check($ok){if(!$ok)throw new RuntimeException('Contrato do proxy divergente');}
$root=sys_get_temp_dir().'/eg-search-'.bin2hex(random_bytes(5));mkdir($root.'/inc',0777,true);file_put_contents($root.'/inc/includes.php','<?php');$source=__DIR__.'/../glpi-plugin/estoquegraal';copyFixture($source.'/ajax',$root.'/plugins/estoquegraal/ajax');copyFixture($source.'/lib',$root.'/plugins/estoquegraal/lib');
PluginEstoquegraalConfig::$url=$argv[1];$GLOBALS['DB']=new stdClass();$_SERVER['REQUEST_METHOD']='POST';$_SERVER['HTTP_X_REQUESTED_WITH']='XMLHttpRequest';$_SERVER['HTTP_X_GLPI_CSRF_TOKEN']='synthetic';
$call=static function($action,$data)use($root){$_POST=['action'=>$action,'ticketId'=>'42','data'=>json_encode($data)];ob_start();require $root.'/plugins/estoquegraal/ajax/endpoint.php';$out=json_decode(ob_get_clean(),true,512,JSON_THROW_ON_ERROR);check(($out['ok']??false)===true);return $out['data'];};
$call('search',['q'=>'memória']);$call('search',['q'=>'memória','includeWithoutStock'=>true]);$options=$call('product_options',[]);check(isset($options['categories'],$options['subcategories']));$matches=$call('matches',['description'=>'Memória Kingston 8 GB']);check($matches['items'][0]['active']===false&&$matches['items'][0]['quantity']==='0.000');
echo "OK proxy PHP real: padrão ativo/positivo, opção zerados, opções reais e duplicidade ampla\n";
