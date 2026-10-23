<?php
namespace Glpi\Http {class Firewall {const STRATEGY_AUTHENTICATED=1;const STRATEGY_CENTRAL_ACCESS=2;public static function addPluginStrategyForLegacyScripts(...$args){}}}
namespace {
define('READ',1);define('UPDATE',2);define('CREATE',4);
class CommonGLPI {}
class Ticket extends CommonGLPI {public array $fields=['entities_id'=>3];public function getID(){return 42;}public function getFromDB($id){return true;}public function can(...$args){return true;}}
class Session {public static function haveRight(...$args){return true;}public static function getLoginUserID(){return 7;}public static function haveAccessToEntity(...$args){return true;}public static function getNewCSRFToken(){return 'synthetic';}}
class Html {public static function getPrefixedUrl($path){global $CFG_GLPI;return rtrim($CFG_GLPI['root_doc'],'/').$path;}}
class Plugin {public static function registerClass(...$args){}public static function isPluginActive(...$args){return true;}public static function getWebDir(...$args){return '/marketplace/estoquegraal';}}
require dirname(__DIR__).'/setup.php';require dirname(__DIR__).'/inc/ticket.class.php';
function check($value,$message){if(!$value)throw new \RuntimeException($message);}
plugin_init_estoquegraal();
foreach($PLUGIN_HOOKS['add_javascript']['estoquegraal'] as $file)check(is_file(dirname(__DIR__).'/public/'.$file),'Script não exposto em public: '.$file);
check(is_file(dirname(__DIR__).'/public/'.$PLUGIN_HOOKS['add_css']['estoquegraal']),'CSS não exposto');
check(is_file(dirname(__DIR__).'/public/pics/logo.svg'),'Logo não exposta');
foreach(['','/glpi'] as $prefix){$CFG_GLPI=['root_doc'=>$prefix];ob_start();PluginEstoquegraalTicket::displayTabContentForItem(new Ticket());$html=ob_get_clean();check(str_contains($html,'src="'.$prefix.'/plugins/estoquegraal/pics/logo.svg"'),'Logo deve usar rota canônica e prefixo GLPI');check(str_contains($html,'data-endpoint="'.$prefix.'/plugins/estoquegraal/ajax/endpoint.php"'),'Endpoint deve preservar prefixo GLPI');}
echo "OK assets públicos, hooks e renderização raiz/subdiretório, sem dependência marketplace\n";
}
